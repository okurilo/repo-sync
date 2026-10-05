import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { applyPatch, createTwoFilesPatch } from 'diff';
import type { Analysis, Baseline, CodeComparison, CodePreview, Environment, FileEntry, ImportPreview, Operation, PackageType, Profile, RecordData, Settings, Transport } from '../shared/types';
import { baselineBytes, git, readBlobs, readInventory, readTree, resolveSource, safePath, scopeHash, sha256, type GitFile, type ResolvedSource, type Tree } from './infra/git';
import { atomicJSON, SettingsStore } from './infra/settings';
import { decode, encode, exportArtifacts, loadTransport, MAX_BYTES, newPackageId, parseTransport, splitTransport } from './transport';
import { findingLocation, scan, type PrivateFinding } from './security';

export const counts = (records: RecordData[]): Record<Operation, number> => {
  const result = { ADD: 0, MODIFY: 0, DELETE: 0, RENAME: 0, REPLACE: 0 };
  for (const record of records) result[record.operation]++;
  return result;
};
interface ExportSession {
  token: string; profileId: string; environment: Environment; resolved: ResolvedSource;
  tree: Tree; workingChanges: Analysis['workingChanges']; transport: Transport; findings: PrivateFinding[]; target: Baseline; maxBytes: number;
}
interface PreparedFile { path: string; before: Buffer | null; after: Buffer | null; beforeMode: number | null; afterMode: number }
interface ImportSession { token: string; environment: Environment; profileId: string; target: string; transport: Transport; files: PreparedFile[] }
interface BackupEntry { path: string; file: string | null; mode: number | null; beforeSha256: string | null; afterSha256: string | null; touched: boolean }
interface Journal { target: string; entries: BackupEntry[]; createdDirectories: string[]; temporaryFiles: string[]; settingsBefore: Settings; committed: boolean }
interface CodeSession { token: string; environment: Environment; from: string | null; to: string; entries: Analysis['entries']; root?: string; before: Map<string, Buffer | GitFile>; after: Map<string, Buffer | GitFile> }
export class Engine {
  readonly cache: string;
  private codeSession: CodeSession | null = null;
  private readonly comparisons = new Map<string, Omit<CodeSession, 'token' | 'environment'>>();
  private readonly codeBlobs = new Map<string, Buffer>();
  private exportSession: ExportSession | null = null;
  private importSession: ImportSession | null = null;
  private replacement: { token: string; filename: string; before: Buffer; after: Buffer } | null = null;
  private blocked = false;
  constructor(readonly store: SettingsStore) { this.cache = path.join(store.directory, 'git-cache'); }
  invalidate(): void { this.codeSession = null; this.exportSession = null; this.importSession = null; this.replacement = null; }
  private context(id: string): { settings: Settings; profile: Profile; mode: Environment } {
    if (this.blocked) throw new Error('Операции остановлены после незавершённого rollback. Перезапустите RepoSync для recovery.');
    const settings = this.store.get();
    if (!settings.environment) throw new Error('Сначала выберите Internal / Global');
    const profile = settings.profiles.find(p => p.id === id);
    if (!profile) throw new Error('Профиль не найден');
    return { settings, profile, mode: settings.environment };
  }
  invalidateRemote(location: string, branches: string[]): void {
    const source = this.exportSession?.resolved.source;
    if (source?.kind === 'remote' && source.location === location && ((!source.commit && branches.includes(source.branch)) || (source.base && !source.base.commit && branches.includes(source.base.branch)))) { this.exportSession = null; this.replacement = null; }
  }
  async previewComparison(profile: Profile): Promise<CodeComparison> {
    this.codeSession = null;
    const mode = this.store.get().environment; if (!mode) throw new Error('Выберите среду');
    const source = profile.sources[mode]; if (!source) throw new Error('Укажите источник');
    if (profile.includeIgnored.length) return this.previewLegacy(profile);
    const resolved = await resolveSource(source, mode, this.cache);
    let from: string | null = null;
    if (source.base) from = (await resolveSource({ ...source, ...source.base, commit: source.base.commit ?? '', base: undefined }, mode, this.cache)).commit;
    else { const baseline = profile.baselines[mode]; if (baseline?.scope === scopeHash(profile)) { try { await git(resolved.root, ['cat-file', '-e', `${baseline.state}^{commit}`]); from = baseline.state; } catch { return this.previewLegacy(profile); } } }
    const key = JSON.stringify([resolved.root, from, resolved.commit, profile.exclusions]);
    let cached = this.comparisons.get(key);
    if (!cached) {
      const filter = (files: Map<string, GitFile>): Map<string, GitFile> => {
        const selected = new Map([...files].filter(([name]) => !profile.exclusions.some(rule => minimatch(name, rule, { dot: true }))));
        if ([...selected.values()].some(file => file.mode < 0)) throw new Error('Symlink и submodule не поддерживаются в v1. Исключите их перед экспортом.');
        if ([...selected.values()].reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) throw new Error('Included bytes превышают 512 MB');
        return selected;
      };
      const after = filter(await readInventory(resolved.root, resolved.commit)); const before = from ? filter(await readInventory(resolved.root, from)) : new Map<string, GitFile>();
      const entries: Analysis['entries'] = []; const consumed = new Set<string>(); const added = new Map<string, GitFile[]>();
      for (const file of after.values()) if (!before.has(file.path)) { const candidates = added.get(file.oid) ?? []; candidates.push(file); added.set(file.oid, candidates); }
      for (const file of before.values()) if (!after.has(file.path)) { const rename = added.get(file.oid)?.pop(); if (rename) consumed.add(rename.path); entries.push({ path: rename?.path ?? file.path, oldPath: rename ? file.path : undefined, operation: rename ? 'RENAME' : 'DELETE', size: rename?.size ?? 0 }); }
      for (const file of after.values()) { const old = before.get(file.path); if (!consumed.has(file.path) && (!old || old.oid !== file.oid || old.mode !== file.mode)) entries.push({ path: file.path, operation: old ? 'MODIFY' : 'ADD', size: file.size }); }
      cached = { root: resolved.root, from, to: resolved.commit, entries, before, after };
      if (this.comparisons.size >= 8) this.comparisons.delete(this.comparisons.keys().next().value!); this.comparisons.set(key, cached);
    }
    const token = randomUUID(); this.codeSession = { ...cached, token, environment: mode }; return { token, from, to: resolved.commit, entries: cached.entries };
  }
  private async previewLegacy(profile: Profile): Promise<CodeComparison> {
    this.codeSession = null;
    const mode = this.store.get().environment;
    if (!mode) throw new Error('Выберите среду');
    const source = profile.sources[mode];
    if (!source) throw new Error('Укажите источник');
    const resolved = await resolveSource(source, mode, this.cache);
    const tree = await readTree(resolved, profile);
    let before = new Map<string, Buffer>();
    let from: string | null = null;
    let records: RecordData[];
    if (source.base) {
      if (profile.includeIgnored.length) throw new Error('Уберите ignored opt-ins для сравнения коммитов');
      const base = await resolveSource({ ...source, ...source.base, commit: source.base.commit ?? '', base: undefined }, mode, this.cache);
      const oldTree = await readTree(base, profile);
      before = oldTree.bytes; from = base.commit;
      records = buildDiff(oldTree.files, tree, before);
    } else {
      const baseline = profile.baselines[mode];
      if (baseline && baseline.scope === scopeHash(profile)) {
        before = await baselineBytes(resolved.root, baseline.state, baseline.files, baseline.localRepository); from = baseline.state;
        records = buildDiff(baseline.files, tree, before);
      } else records = tree.files.map(file => ({ path: file.path, mode: file.mode, operation: 'ADD', size: file.size, afterSha256: file.sha256, ...encode(tree.bytes.get(file.path)!) }));
    }
    const entries = records.map(r => ({ path: r.path, oldPath: r.oldPath, operation: r.operation, size: r.size }));
    const token = randomUUID();
    this.codeSession = { token, environment: mode, from, to: resolved.commit, entries, before, after: tree.bytes };
    return { token, from, to: resolved.commit, entries };
  }
  async previewCode(token: string, name: string): Promise<CodePreview> {
    const session = this.codeSession;
    if (!session || session.token !== token || session.environment !== this.store.get().environment) throw new Error('Сравнение устарело');
    const entry = session.entries.find(item => item.path === name);
    if (!entry) throw new Error('Файл отсутствует в сравнении');
    const old = session.before.get(entry.oldPath ?? name); const next = session.after.get(name);
    if ([old, next].some(file => file && (Buffer.isBuffer(file) ? file.length : file.size) > 128 * 1024)) return { before: '', after: '', message: 'Файл больше 128 KB: предпросмотр кода недоступен.' };
    const metadata = [old, next].filter((file): file is GitFile => !!file && !Buffer.isBuffer(file));
    if (session.root) {
      const missing = [...new Set(metadata.map(file => file.oid))].filter(oid => !this.codeBlobs.has(`${session.root}:${oid}`));
      for (const [oid, bytes] of await readBlobs(session.root, missing)) { if (this.codeBlobs.size >= 32) this.codeBlobs.delete(this.codeBlobs.keys().next().value!); this.codeBlobs.set(`${session.root}:${oid}`, bytes); }
    }
    if (this.codeSession !== session || session.environment !== this.store.get().environment) throw new Error('Сравнение устарело');
    const bytes = (file: Buffer | GitFile | undefined): Buffer => !file ? Buffer.alloc(0) : Buffer.isBuffer(file) ? file : this.codeBlobs.get(`${session.root}:${file.oid}`)!;
    const before = bytes(old); const after = bytes(next);
    if ([before, after].some(bytes => bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes))) return { before: '', after: '', message: 'Бинарный файл: предпросмотр кода недоступен.' };
    const masked = (bytes: Buffer, filename: string): string => {
      if (!bytes.length) return '';
      let text = bytes.toString('utf8');
      const findings = scan([{ path: filename, mode: 0o644, operation: 'ADD', size: bytes.length, ...encode(bytes) }], false);
      if (findings.some(f => !f.value)) return '[Содержимое чувствительного файла скрыто]';
      const positions = new Set<number>();
      for (const finding of findings) for (let i = finding.offset; i < finding.offset + finding.value.length; i++) positions.add(i);
      text = [...text.split('')].map((char, i) => positions.has(i) && char !== '\n' && char !== '\r' ? '•' : char).join('');
      return text;
    };
    return { before: masked(before, entry.oldPath ?? name), after: masked(after, name) };
  }
  async analyze(id: string, type: PackageType): Promise<Analysis> {
    this.invalidate();
    const { profile, mode } = this.context(id);
    if (profile.pending[mode]) throw new Error('Есть pending package. Подтвердите передачу или отмените pending перед новым экспортом.');
    const source = profile.sources[mode];
    if (!source) throw new Error('Настройте источник для текущей среды');
    const resolved = await resolveSource(source, mode, this.cache);
    const tree = await readTree(resolved, profile);
    if (tree.files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) throw new Error('Included bytes превышают ограничение v1: 512 MB');
    let baseline = profile.baselines[mode];
    const scope = scopeHash(profile);
    let explicitBefore: Map<string, Buffer> | undefined;
    if (type === 'diff' && source.base) {
      if (profile.includeIgnored.length) throw new Error('Для сравнения двух коммитов уберите вручную возвращённые ignored-файлы');
      const baseResolved = await resolveSource({ ...source, ...source.base, commit: source.base.commit ?? '', base: undefined }, mode, this.cache);
      const baseTree = await readTree(baseResolved, profile);
      baseline = { state: baseResolved.commit, files: baseTree.files, scope };
      explicitBefore = baseTree.bytes;
    }
    if (type === 'diff' && (!baseline || baseline.scope !== scope)) throw new Error('Baseline отсутствует или exclusions изменены. Нужен Full Snapshot.');
    let records: RecordData[];
    if (type === 'snapshot') records = tree.files.map(file => ({ path: file.path, mode: file.mode, operation: 'ADD', size: file.size, afterSha256: file.sha256, ...encode(tree.bytes.get(file.path)!) }));
    else {
      if (!baseline) throw new Error('Нужен baseline');
      const before = explicitBefore ?? await baselineBytes(resolved.root, baseline.state, baseline.files, baseline.localRepository);
      records = buildDiff(baseline.files, tree, before);
    }
    const targetState = profile.includeIgnored.length ? `content:${sha256(JSON.stringify(tree.files))}` : resolved.commit;
    const transport: Transport = { protocolVersion: 2, schemaVersion: 2, packageId: newPackageId(), packageType: type,
      sourceState: type === 'diff' ? baseline!.state : null, targetState, scope, files: tree.files, records };
    parseTransport(transport);
    const findings = scan(records, source.kind === 'local');
    const maxBytes = profile.maxPartMB * 1024 * 1024;
    const parts = splitTransport(transport, maxBytes);
    const target: Baseline = { state: targetState, files: tree.files, scope };
    if (profile.includeIgnored.length) target.localRepository = resolved.root;
    this.exportSession = { token: randomUUID(), profileId: id, environment: mode, resolved, tree, workingChanges: { staged: 0, unstaged: 0, untracked: 0 }, transport, findings, target, maxBytes };
    const workingChanges = { staged: 0, unstaged: 0, untracked: 0 };
    if (source.kind === 'local') {
      const status = (await git(resolved.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).toString('utf8').split('\0');
      for (let index = 0; index < status.length; index++) {
        const entry = status[index];
        if (!entry) continue;
        if (entry.startsWith('??')) workingChanges.untracked++;
        else { if (entry[0] !== ' ') workingChanges.staged++; if (entry[1] !== ' ') workingChanges.unstaged++; }
        if (entry[0] === 'R' || entry[0] === 'C') index++;
      }
    }
    this.exportSession.workingChanges = workingChanges;
    return { token: this.exportSession.token, state: targetState, sourceState: transport.sourceState, packageType: type,
      files: tree.files.length, changes: counts(records), excludedGit: tree.excludedGit, excludedCustom: tree.excludedCustom,
      estimatedBytes: parts.reduce((sum, part) => sum + part.length, 0), parts: parts.length,
      findings: findings.map(f => f.public), local: source.kind === 'local', ignored: tree.ignored, workingChanges,
      entries: records.map(r => ({ path: r.path, oldPath: r.oldPath, operation: r.operation, size: r.size })) };
  }
  session(token: string): ExportSession {
    const current = this.exportSession;
    if (!current || current.token !== token || this.store.get().environment !== current.environment) throw new Error('Preview устарел: выполните Compare заново');
    return current;
  }
  async exportPackage(token: string, keep: string[], override: boolean): Promise<string[]> {
    const session = this.session(token);
    const { settings, profile, mode } = this.context(session.profileId);
    if (!settings.outputDirectory) throw new Error('Выберите папку экспорта в Settings');
    const findings = scan(session.transport.records, session.resolved.source.kind === 'local');
    if (findings.some(f => !keep.includes(f.public.id))) throw new Error('Примите решение по каждому finding');
    if (findings.some(f => f.public.severity === 'block') && !override) throw new Error('Экспорт secrets заблокирован: исключите / исправьте данные либо явно подтвердите override');
    // Повторно читаем selected branch и included ignored-файлы перед записью.
    const current = await readTree(session.resolved, profile);
    const head = await git(session.resolved.root, ['rev-parse', '--verify', session.resolved.source.commit || `refs/heads/${session.resolved.source.branch}`]);
    if (head.toString().trim() !== session.resolved.commit || JSON.stringify(current.files) !== JSON.stringify(session.tree.files)) throw new Error('Источник изменился: Compare требуется заново');
    const base = session.resolved.source.base;
    if (session.transport.packageType === 'diff' && base && !base.commit) {
      const baseHead = await git(session.resolved.root, ['rev-parse', '--verify', `refs/heads/${base.branch}`]);
      if (baseHead.toString().trim() !== session.transport.sourceState) throw new Error('Исходная ветка изменилась: Compare требуется заново');
    }
    const artifacts = exportArtifacts(session.transport, session.maxBytes);
    const parts = artifacts.map(file => file.bytes);
    const names = artifacts.map(file => path.join(settings.outputDirectory, file.name));
    const written: string[] = [];
    try {
      for (let index = 0; index < parts.length; index++) {
        const handle = await open(names[index]!, 'wx', 0o600);
        written.push(names[index]!);
        try { await handle.writeFile(parts[index]!); await handle.sync(); } finally { await handle.close(); }
      }
      profile.pending[mode] = { packageId: session.transport.packageId, target: session.target, paths: names };
      await this.store.save(settings);
    } catch (error) { for (const name of written) await rm(name, { force: true }); throw error; }
    this.exportSession = null;
    return names;
  }
  async confirmTransfer(id: string): Promise<Settings> {
    const { settings, profile, mode } = this.context(id);
    const pending = profile.pending[mode];
    if (!pending) throw new Error('Нет pending package');
    profile.baselines[mode] = pending.target;
    delete profile.pending[mode];
    this.invalidate();
    return this.store.save(settings);
  }
  async discardPending(id: string): Promise<Settings> {
    const { settings, profile, mode } = this.context(id);
    delete profile.pending[mode];
    this.invalidate();
    return this.store.save(settings);
  }
  finding(token: string, findingId: string): { session: ExportSession; finding: PrivateFinding } {
    const session = this.session(token);
    const finding = session.findings.find(f => f.public.id === findingId);
    if (!finding) throw new Error('Finding не найден');
    return { session, finding };
  }
  findingURL(token: string, findingId: string): string {
    const { session, finding } = this.finding(token, findingId);
    const source = session.resolved.source.location;
    const record = session.transport.records.find(item => item.path === finding.public.path);
    if (!record) throw new Error('Файл отсутствует в пакете');
    const location = findingLocation(record, finding.payloadLine ?? finding.public.line);
    const revision = location.before ? session.transport.sourceState : session.resolved.commit;
    const match = /^(?:https:\/\/|ssh:\/\/(?:git@)?|git@)(github\.com|gitlab\.com|bitbucket\.org)[:/]([^?#]+)$/.exec(source);
    if (!match || !revision || !/^[a-f0-9]{40,64}$/i.test(revision)) throw new Error('Для этого Git-сервера нет ссылки на файл. Контекст срабатывания доступен в карточке.');
    const host = match[1]; const repository = match[2]!.replace(/\.git$/, '').replace(/\/$/, '');
    const file = (record.oldPath && location.before ? record.oldPath : record.path).split('/').map(encodeURIComponent).join('/');
    const route = host === 'gitlab.com' ? '-/blob' : host === 'bitbucket.org' ? 'src' : 'blob';
    return `https://${host}/${repository}/${route}/${revision}/${file}${host === 'bitbucket.org' ? '#lines-' : '#L'}${location.line}`;
  }
  async excludeFinding(token: string, findingId: string): Promise<{ settings: Settings; analysis: Analysis }> {
    const { session, finding } = this.finding(token, findingId);
    const { settings, profile, mode } = this.context(session.profileId);
    const name = finding.public.path;
    const literal = name.replace(/[\\*?\[\]{}()!+@]/g, '\\$&');
    profile.exclusions = [...new Set([...profile.exclusions, literal])];
    const wasIgnored = profile.includeIgnored.includes(name);
    profile.includeIgnored = profile.includeIgnored.filter(item => item !== name);
    const files = session.transport.files.filter(file => file.path !== name);
    const records = session.transport.records.filter(record => record.path !== name && record.oldPath !== name);
    const scope = scopeHash(profile);
    const previousBaseline = profile.baselines[mode];
    if (!session.resolved.source.base && previousBaseline && previousBaseline.scope === session.transport.scope) {
      profile.baselines[mode] = { ...previousBaseline, scope, files: previousBaseline.files.filter(file => file.path !== name) };
    }
    const targetState = profile.includeIgnored.length || session.transport.targetState.startsWith('content:') ? `content:${sha256(JSON.stringify(files))}` : session.resolved.commit;
    const transport = { ...session.transport, files, records, scope, targetState };
    parseTransport(transport);
    const findings = scan(records, session.resolved.source.kind === 'local');
    const parts = splitTransport(transport, session.maxBytes);
    const saved = await this.store.save(settings);
    const tree = { ...session.tree, files: session.tree.files.filter(file => file.path !== name), bytes: new Map([...session.tree.bytes].filter(([file]) => file !== name)), excludedGit: session.tree.excludedGit + (wasIgnored ? 1 : 0), excludedCustom: session.tree.excludedCustom + (wasIgnored ? 0 : 1) };
    this.exportSession = { ...session, token: randomUUID(), tree, transport, findings, target: { ...session.target, state: targetState, files, scope } };
    this.codeSession = null; this.replacement = null;
    return { settings: saved, analysis: { token: this.exportSession.token, state: targetState, sourceState: transport.sourceState, packageType: transport.packageType, files: files.length, changes: counts(records), excludedGit: tree.excludedGit, excludedCustom: tree.excludedCustom, estimatedBytes: parts.reduce((sum, part) => sum + part.length, 0), parts: parts.length, findings: findings.map(item => item.public), local: session.resolved.source.kind === 'local', ignored: tree.ignored, workingChanges: session.workingChanges, entries: records.map(record => ({ path: record.path, oldPath: record.oldPath, operation: record.operation, size: record.size })) } };
  }
  async redactFinding(token: string, findingId: string): Promise<Analysis> {
    const { session, finding } = this.finding(token, findingId);
    if (!finding.value || !finding.public.canRedact) throw new Error('Замена доступна только для значения в целевом файле');
    const name = finding.public.path;
    const record = session.transport.records.find(item => item.path === name);
    if (!record) throw new Error('Файл отсутствует в пакете');
    const original = session.tree.bytes.get(name);
    if (!original) throw new Error('Целевой файл отсутствует');
    // После первой замены REPLACE уже содержит полные целевые bytes.
    const before = record.operation === 'MODIFY' ? original : decode(record);
    const text = before.toString('utf8');
    if (!Buffer.from(text).equals(before) || before.includes(0)) throw new Error('Для бинарного файла замена недоступна');
    const location = findingLocation(record, finding.payloadLine ?? finding.public.line);
    const lineStart = text.split('\n').slice(0, location.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
    const payload = decode(record).toString('utf8');
    const payloadStart = payload.lastIndexOf('\n', finding.offset - 1) + 1;
    const column = finding.offset - payloadStart - (record.operation === 'MODIFY' ? 1 : 0);
    const start = lineStart + column;
    if (start < 0 || text.slice(start, start + finding.value.length) !== finding.value) throw new Error('Совпадение устарело: повторите Compare');
    const bytes = Buffer.from(text.slice(0, start) + '***' + text.slice(start + finding.value.length));
    const files = session.transport.files.map(file => file.path === name ? { ...file, size: bytes.length, sha256: sha256(bytes) } : file);
    const records = session.transport.records.map(item => item !== record ? item : { ...item, operation: item.operation === 'ADD' ? 'ADD' as const : 'REPLACE' as const, size: bytes.length, afterSha256: sha256(bytes), ...encode(bytes) });
    const targetState = `content:${sha256(JSON.stringify(files))}`;
    const transport = { ...session.transport, files, records, targetState }; parseTransport(transport);
    const findings = scan(records, session.resolved.source.kind === 'local');
    const parts = splitTransport(transport, session.maxBytes);
    const next = { ...session, token: randomUUID(), transport, findings, target: { state: targetState, files, scope: transport.scope } };
    this.exportSession = next; this.replacement = null;
    return { token: next.token, state: targetState, sourceState: transport.sourceState, packageType: transport.packageType, files: files.length, changes: counts(records), excludedGit: session.tree.excludedGit, excludedCustom: session.tree.excludedCustom, estimatedBytes: parts.reduce((sum, part) => sum + part.length, 0), parts: parts.length, findings: findings.map(item => item.public), local: session.resolved.source.kind === 'local', ignored: session.tree.ignored, workingChanges: session.workingChanges, entries: records.map(item => ({ path: item.path, oldPath: item.oldPath, operation: item.operation, size: item.size })) };
  }
  async previewReplacement(token: string, findingId: string): Promise<{ token: string; path: string; line: number; preview: string; replacement: string }> {
    const { session, finding } = this.finding(token, findingId);
    if (!finding.public.canReplace || session.resolved.source.kind !== 'local' || !finding.value) throw new Error('Автоматическая замена недоступна');
    const filename = await safePath(session.resolved.root, finding.public.path);
    const before = await optionalRead(filename);
    if (before === null) throw new Error('Локальный файл отсутствует');
    const needle = Buffer.from(finding.value);
    const start = before.indexOf(needle);
    if (start < 0 || before.indexOf(needle, start + 1) >= 0) throw new Error('Span отсутствует или неоднозначен в локальном файле: исправьте вручную');
    const after = Buffer.concat([before.subarray(0, start), Buffer.from(finding.public.replacement), before.subarray(start + needle.length)]);
    const replacementToken = randomUUID();
    this.replacement = { token: replacementToken, filename, before, after };
    return { token: replacementToken, path: finding.public.path, line: before.subarray(0, start).toString('utf8').split('\n').length,
      preview: finding.public.preview, replacement: finding.public.replacement };
  }
  async applyReplacement(token: string): Promise<void> {
    const replacement = this.replacement;
    if (!replacement || replacement.token !== token) throw new Error('Preview замены устарел');
    const stat = await lstat(replacement.filename);
    if (!stat.isFile() || stat.isSymbolicLink() || !(await readFile(replacement.filename)).equals(replacement.before)) throw new Error('Файл изменился: повторите preview');
    const temporary = path.join(path.dirname(replacement.filename), `.reposync-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, replacement.after, { flag: 'wx', mode: stat.mode & 0o777 });
      await rename(temporary, replacement.filename);
    } finally { await rm(temporary, { force: true }); }
    this.invalidate();
  }
  private async importBaseline(root: string, transport: Transport, profile: Profile, mode: Environment): Promise<Baseline | undefined> {
    const saved = profile.baselines[mode];
    if (transport.packageType !== 'diff' || (saved?.state === transport.sourceState && saved.scope === transport.scope)) return saved;
    if (!transport.sourceState || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(transport.sourceState)
      || profile.includeIgnored.length || scopeHash(profile) !== transport.scope) throw new Error('Исходное состояние Diff недоступно или exclusions не совпадают');
    try {
      await git(root, ['cat-file', '-e', `${transport.sourceState}^{commit}`]);
    } catch { throw new Error('В принимающем Git нет исходного коммита Diff. Сначала импортируйте его Full Snapshot.'); }
    const tree = await readTree({ root, commit: transport.sourceState, source: { kind: 'local', location: root, branch: 'HEAD' } }, profile);
    return { state: transport.sourceState, files: tree.files, scope: transport.scope };
  }
  async preflight(filename: string, target: string, profileId: string): Promise<ImportPreview> {
    this.invalidate();
    const { profile, mode } = this.context(profileId);
    if (profile.pending[mode]) throw new Error('Сначала завершите pending export');
    const root = await realpath(target);
    const top = (await git(root, ['rev-parse', '--show-toplevel'])).toString().trim();
    if (await realpath(top) !== root) throw new Error('Target должен быть корнем Git repository');
    const transport = await loadTransport(filename);
    const baseline = await this.importBaseline(root, transport, profile, mode);
    if (transport.packageType === 'diff' && (!baseline || baseline.state !== transport.sourceState || baseline.scope !== transport.scope)) throw new Error('Source state / baseline не совпадает с профилем');
    const files = await prepare(root, transport, baseline);
    this.importSession = { token: randomUUID(), profileId, environment: mode, target: root, transport, files };
    return { token: this.importSession.token, packageId: transport.packageId, sourceState: transport.sourceState,
      targetState: transport.targetState, packageType: transport.packageType, changes: counts(transport.records), files: transport.files.length,
      entries: transport.records.map(r => ({ path: r.path, oldPath: r.oldPath, operation: r.operation, size: r.size })) };
  }
  async applyImport(token: string): Promise<Settings> {
    const session = this.importSession;
    if (!session || session.token !== token) throw new Error('Import preview устарел');
    const { settings, profile, mode } = this.context(session.profileId);
    if (mode !== session.environment) throw new Error('Режим изменился: повторите preflight');
    const baseline = await this.importBaseline(session.target, session.transport, profile, mode);
    const files = await prepare(session.target, session.transport, baseline);
    if (files.some((file, i) => !sameBuffer(file.before, session.files[i]?.before ?? null) || file.beforeMode !== session.files[i]?.beforeMode)) throw new Error('Target изменился после preview');
    const directory = path.join(this.store.directory, 'backups', randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const journal: Journal = { target: session.target, entries: [], createdDirectories: [], temporaryFiles: [], settingsBefore: this.store.get(), committed: false };
    for (const [index, file] of files.entries()) {
      const backup = file.before === null ? null : `${index}.bin`;
      if (backup) await writeFile(path.join(directory, backup), file.before!, { mode: 0o600, flag: 'wx' });
      journal.entries.push({ path: file.path, file: backup, mode: file.beforeMode,
        beforeSha256: file.before === null ? null : sha256(file.before), afterSha256: file.after === null ? null : sha256(file.after), touched: false });
    }
    const journalPath = path.join(directory, 'journal.json');
    await atomicJSON(journalPath, journal);
    try {
      for (const [index, file] of files.entries()) {
        const filename = await safePath(session.target, file.path);
        if (!sameBuffer(await optionalRead(filename), file.before)) throw new Error('Target изменён другим процессом во время Apply');
        journal.entries[index]!.touched = true;
        await atomicJSON(journalPath, journal);
        if (file.after === null) await rm(filename);
        else {
          const relativeDirectory = path.posix.dirname(file.path);
          let partial = '';
          for (const segment of relativeDirectory === '.' ? [] : relativeDirectory.split('/')) {
            partial = partial ? `${partial}/${segment}` : segment;
            const next = await safePath(session.target, partial);
            try { await lstat(next); } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              journal.createdDirectories.push(partial);
              await atomicJSON(journalPath, journal);
              await mkdir(next);
            }
          }
          const temporary = path.join(path.dirname(filename), `.reposync-${randomUUID()}.tmp`);
          journal.temporaryFiles.push(path.relative(session.target, temporary).split(path.sep).join('/'));
          await atomicJSON(journalPath, journal);
          try { await writeFile(temporary, file.after, { flag: 'wx', mode: file.afterMode }); await rename(temporary, filename); }
          finally { await rm(temporary, { force: true }); }
          await chmod(filename, file.afterMode);
        }
      }
      await verifyInventory(session.target, session.transport.files);
      for (const file of files) if (!sameBuffer(await optionalRead(await safePath(session.target, file.path)), file.after)) throw new Error('Проверка результата операции не пройдена');
      profile.baselines[mode] = { state: session.transport.targetState, files: session.transport.files, scope: session.transport.scope, localRepository: session.target };
      settings.lastRepositories = [session.target, ...settings.lastRepositories.filter(p => p !== session.target)].slice(0, 10);
      await this.store.save(settings);
      journal.committed = true;
      await atomicJSON(journalPath, journal);
      this.invalidate();
      return this.store.get();
    } catch (error) {
      try {
        await restore(directory, journal);
        await this.store.save(journal.settingsBefore);
        await rm(journalPath);
      } catch { this.blocked = true; this.invalidate(); throw new Error(`Rollback не завершён. Backup сохранён в ${directory}. Не изменяйте target до восстановления.`); }
      this.invalidate();
      throw error;
    }
  }
  async recover(): Promise<void> {
    const directory = path.join(this.store.directory, 'backups');
    let names: string[];
    try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const name of names) {
      const folder = path.join(directory, name);
      let journal: Journal;
      try { journal = JSON.parse(await readFile(path.join(folder, 'journal.json'), 'utf8')) as Journal; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw new Error(`Повреждён recovery journal: ${folder}`); }
      if (!journal.committed) {
        await restore(folder, journal);
        await this.store.save(journal.settingsBefore);
        await rm(path.join(folder, 'journal.json'));
      }
    }
  }
}
function sameBuffer(a: Buffer | null, b: Buffer | null): boolean { return a === null || b === null ? a === b : a.equals(b); }
function buildDiff(previous: FileEntry[], tree: Tree, before: Map<string, Buffer>): RecordData[] {
  const old = new Map(previous.map(f => [f.path, f]));
  const current = new Map(tree.files.map(f => [f.path, f]));
  const removed = previous.filter(f => !current.has(f.path));
  const added = tree.files.filter(f => !old.has(f.path));
  const consumed = new Set<string>();
  const renamedCandidates = new Map<string, FileEntry[]>();
  for (const file of added) {
    const candidates = renamedCandidates.get(file.sha256) ?? [];
    candidates.push(file); renamedCandidates.set(file.sha256, candidates);
  }
  const records: RecordData[] = [];
  for (const file of removed) {
    const rename = renamedCandidates.get(file.sha256)?.pop();
    if (rename) {
      consumed.add(rename.path);
      records.push({ path: rename.path, oldPath: file.path, operation: 'RENAME', size: rename.size, mode: rename.mode, beforeSha256: file.sha256, afterSha256: rename.sha256, encoding: 'RAW', payload: '' });
    } else records.push({ path: file.path, operation: 'DELETE', size: 0, mode: file.mode, beforeSha256: file.sha256, encoding: 'RAW', payload: '' });
  }
  for (const file of tree.files) {
    if (consumed.has(file.path)) continue;
    const previous = old.get(file.path);
    const bytes = tree.bytes.get(file.path)!;
    if (!previous) records.push({ path: file.path, operation: 'ADD', size: file.size, mode: file.mode, afterSha256: file.sha256, ...encode(bytes) });
    else if (previous.sha256 !== file.sha256 || previous.mode !== file.mode) {
      const prior = before.get(file.path)!;
      const oldText = prior.toString('utf8');
      const newText = bytes.toString('utf8');
      const text = !prior.includes(0) && !bytes.includes(0) && Buffer.from(oldText).equals(prior) && Buffer.from(newText).equals(bytes);
      const patch = text ? createTwoFilesPatch(`a/${file.path}`, `b/${file.path}`, oldText, newText, '', '', { context: 3 }) : '';
      if (text && applyPatch(oldText, patch, { fuzzFactor: 0, autoConvertLineEndings: false }) !== newText) throw new Error('Не удалось построить byte-exact patch');
      records.push({ path: file.path, operation: text ? 'MODIFY' : 'REPLACE', size: file.size, mode: file.mode,
        beforeSha256: previous.sha256, afterSha256: file.sha256, ...encode(text ? Buffer.from(patch) : bytes) });
    }
  }
  return records;
}
async function optionalRead(filename: string): Promise<Buffer | null> {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Target path не является обычным файлом');
    if (stat.size > MAX_BYTES) throw new Error('Target file превышает ограничение v1: 512 MB');
    return await readFile(filename);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function verifyInventory(root: string, files: FileEntry[]): Promise<void> {
  for (const file of files) {
    const filename = await safePath(root, file.path);
    const bytes = await optionalRead(filename);
    if (!bytes || bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error('Target inventory не соответствует ожидаемым hashes');
    const mode = (await lstat(filename)).mode;
    if (process.platform !== 'win32' && Boolean(mode & 0o111) !== Boolean(file.mode & 0o111)) throw new Error('Executable mode не соответствует inventory');
  }
}
async function prepare(root: string, transport: Transport, baseline?: Baseline): Promise<PreparedFile[]> {
  if (transport.packageType === 'diff') {
    if (!baseline || baseline.state !== transport.sourceState || baseline.scope !== transport.scope) throw new Error('Baseline несовместим');
    await verifyInventory(root, baseline.files);
    const inventory = new Map(baseline.files.map(file => [file.path, file]));
    const targetInventory = new Map(transport.files.map(file => [file.path, file]));
    for (const record of transport.records) {
      const oldName = record.oldPath ?? record.path;
      const prior = inventory.get(oldName);
      if (record.operation === 'ADD' ? !!prior : !prior || prior.sha256 !== record.beforeSha256) throw new Error('Операция не соответствует baseline inventory');
      inventory.delete(oldName);
      if (record.operation !== 'DELETE') inventory.set(record.path, targetInventory.get(record.path)!);
    }
    if (JSON.stringify([...inventory.values()].sort((a,b) => a.path.localeCompare(b.path))) !== JSON.stringify([...transport.files].sort((a,b) => a.path.localeCompare(b.path)))) throw new Error('Target inventory не является результатом Diff');
  }
  const prepared: PreparedFile[] = [];
  let decodedBytes = 0;
  for (const record of transport.records) {
    const oldName = record.oldPath ?? record.path;
    const oldFilename = await safePath(root, oldName);
    const old = await optionalRead(oldFilename);
    const mode = old === null ? null : (await lstat(oldFilename)).mode & 0o777;
    if (record.operation === 'ADD') {
      if (old !== null && sha256(old) !== record.afterSha256) throw new Error('ADD не может перезаписать неожиданный файл');
    } else if (old === null || sha256(old) !== record.beforeSha256) throw new Error('Before SHA256 не совпадает');
    let after: Buffer | null;
    if (record.operation === 'DELETE') after = null;
    else if (record.operation === 'RENAME') {
      if (await optionalRead(await safePath(root, record.path)) !== null) throw new Error('RENAME destination уже существует');
      after = old;
      prepared.push({ path: oldName, before: old, after: null, beforeMode: mode, afterMode: record.mode });
    } else {
      const payload = decode(record);
      decodedBytes += payload.length;
      if (decodedBytes > MAX_BYTES) throw new Error('Decoded payload превышает 512 MB');
      if (record.operation === 'MODIFY') {
        if (old === null || !Buffer.from(old.toString('utf8')).equals(old) || !Buffer.from(payload.toString('utf8')).equals(payload)) throw new Error('Patch требует UTF-8 text');
        let patched: string | false;
        try { patched = applyPatch(old.toString('utf8'), payload.toString('utf8'), { fuzzFactor: 0, autoConvertLineEndings: false }); }
        catch { throw new Error('Unified patch не применим: неверный формат'); }
        if (patched === false) throw new Error('Unified patch не применим');
        after = Buffer.from(patched);
      } else after = payload;
    }
    if (after !== null && (after.length !== record.size || sha256(after) !== record.afterSha256)) throw new Error('After SHA256 / size не совпадает');
    prepared.push({ path: record.path, before: record.operation === 'RENAME' ? null : old, after, beforeMode: record.operation === 'RENAME' ? null : mode, afterMode: record.mode });
  }
  return prepared;
}
async function restore(directory: string, journal: Journal): Promise<void> {
  for (const entry of [...journal.entries].reverse().filter(entry => entry.touched)) {
    const filename = await safePath(journal.target, entry.path);
    const current = await optionalRead(filename);
    const currentHash = current === null ? null : sha256(current);
    if (currentHash !== entry.beforeSha256 && currentHash !== entry.afterSha256) throw new Error('Файл изменён внешним процессом: автоматический rollback остановлен');
    if (currentHash === entry.beforeSha256) { if (current !== null && entry.mode !== null) await chmod(filename, entry.mode); continue; }
    if (entry.file === null) await rm(filename, { force: true });
    else {
      await mkdir(path.dirname(filename), { recursive: true });
      const bytes = await readFile(path.join(directory, entry.file));
      await writeFile(filename, bytes, { mode: entry.mode ?? 0o644 });
      await chmod(filename, entry.mode ?? 0o644);
      if (sha256(await readFile(filename)) !== sha256(bytes)) throw new Error('Rollback integrity failed');
    }
  }
  for (const name of journal.temporaryFiles) await rm(await safePath(journal.target, name), { force: true });
  for (const name of [...journal.createdDirectories].reverse()) {
    try { await rmdir(await safePath(journal.target, name)); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
}
