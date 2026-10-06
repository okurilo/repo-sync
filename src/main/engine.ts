import { randomUUID } from 'node:crypto';
import { matchingComparisonFilters } from './comparison';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyPatch, createTwoFilesPatch, parsePatch } from 'diff';
import type { Analysis, Baseline, CodeComparison, CodePreview, Direction, Environment, FileEntry, ImportPreview, IncomingSelection, Operation, PackageType, Profile, RecordData, Settings, Transport } from '../shared/types';
import { git, readTree, refreshSource, resolveSource, safePath, scopeHash, sha256, type ResolvedSource, type Tree } from './infra/git';
import { atomicJSON, SettingsStore } from './infra/settings';
import { decode, encode, exportArtifacts, loadTransport, MAX_BYTES, newPackageId, parseTransport, splitTransport } from './transport';
import { findingLocation, scan, type PrivateFinding } from './security';

export const counts = (records: RecordData[]): Record<Operation, number> => {
  const result = { ADD: 0, MODIFY: 0, DELETE: 0, RENAME: 0, REPLACE: 0 };
  for (const record of records) result[record.operation]++;
  return result;
};
interface ExportSession {
  incomingMode?: IncomingSelection['mode']; sourceBaseline?: Baseline; sourceBytes?: Map<string, Buffer>;
  token: string; profileId: string; environment: Environment; resolved: ResolvedSource;
  tree: Tree; workingChanges: Analysis['workingChanges']; transport: Transport; findings: PrivateFinding[]; target: Baseline; maxBytes: number;
}
interface PreparedFile { path: string; before: Buffer | null; after: Buffer | null; beforeMode: number | null; afterMode: number }
interface ImportSession { token: string; environment: Environment; profileId: string; target: string; transport: Transport; files: PreparedFile[]; baseline?: Baseline; updateCommon: boolean }
interface BackupEntry { path: string; file: string | null; mode: number | null; beforeSha256: string | null; afterSha256: string | null; touched: boolean }
interface Journal { target: string; entries: BackupEntry[]; createdDirectories: string[]; temporaryFiles: string[]; settingsBefore: Settings; committed: boolean }
interface CodeSession { token: string; mask: boolean; from: string | null; to: string; entries: Analysis['entries']; before: Map<string, Buffer>; after: Map<string, Buffer> }
export class Engine {
  readonly cache: string;
  private codeSession: CodeSession | null = null;
  private exportSession: ExportSession | null = null;
  private importSession: ImportSession | null = null;
  private replacement: { token: string; filename: string; root: string; path: string; branch: string; before: Buffer; after: Buffer } | null = null;
  private blocked = false;
  constructor(readonly store: SettingsStore) { this.cache = path.join(store.directory, 'git-cache'); }
  invalidate(): void { this.codeSession = null; this.exportSession = null; this.importSession = null; this.replacement = null; }
  private context(id: string, mode: Environment = 'internal'): { settings: Settings; profile: Profile; mode: Environment } {
    if (this.blocked) throw new Error('Откат не завершён, дальнейшие операции заблокированы. Не изменяйте файлы репозитория. Перезапустите RepoSync для повторного восстановления.');
    const settings = this.store.get();
    const profile = settings.profiles.find(p => p.id === id);
    if (!profile) throw new Error('Профиль не найден');
    return { settings, profile, mode };
  }
  invalidateRemote(location: string, branches: string[]): void {
    const source = this.exportSession?.resolved.source;
    if (source?.kind === 'remote' && source.location === location && ((!source.commit && branches.includes(source.branch)) || (source.base && !source.base.commit && branches.includes(source.base.branch)))) { this.exportSession = null; this.replacement = null; }
  }
  async previewComparison(profile: Profile, direction: Direction): Promise<CodeComparison> {
    const analysis = await this.analyze(profile.id, direction);
    return { token: analysis.token, from: analysis.sourceState, to: analysis.state, entries: analysis.entries, lineChanges: analysis.lineChanges };
  }
  private async saveBaseline(bytes: Map<string, Buffer>): Promise<void> {
    const directory = path.join(this.cache, 'sync-bytes');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const content of bytes.values()) {
      const name = path.join(directory, sha256(content));
      const saved = await optionalRead(name);
      if (saved) { if (!saved.equals(content)) throw new Error('Сохранённые данные синхронизации повреждены. Сохраните папку данных RepoSync для восстановления.'); continue; }
      const temporary = `${name}.${randomUUID()}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try {
        try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, name);
      } finally { await rm(temporary, { force: true }); }
    }
  }
  private async baselineContent(baseline: Baseline): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>();
    for (const file of baseline.files) {
      const bytes = await optionalRead(path.join(this.cache, 'sync-bytes', file.sha256));
      if (!bytes || bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error('Сохранённое состояние синхронизации недоступно. Требуется первичная синхронизация.');
      result.set(file.path, bytes);
    }
    return result;
  }
  private codeFor(token: string, transport: Transport, before: Map<string, Buffer>, after: Map<string, Buffer>, mask: boolean, beforeModes: Map<string, number>): Analysis['entries'] {
    const entries = transport.records.map(record => {
      const old = before.get(record.path); const next = after.get(record.path);
      const ignoredBy = (record.operation === 'MODIFY' || record.operation === 'REPLACE') && beforeModes.get(record.path) === record.mode && old && next ? matchingComparisonFilters(old, next) : [];
      return { path: record.path, oldPath: record.oldPath, operation: record.operation, size: record.size, ignoredBy };
    });
    this.codeSession = { token, mask, from: transport.sourceState, to: transport.targetState, entries, before, after };
    return entries;
  }
  async previewCode(token: string, name: string): Promise<CodePreview> {
    const session = this.codeSession;
    if (!session || session.token !== token) throw new Error('Сравнение устарело. Запустите синхронизацию заново.');
    const entry = session.entries.find(item => item.path === name);
    if (!entry) throw new Error('Файл отсутствует в сравнении');
    const old = session.before.get(entry.oldPath ?? name); const next = session.after.get(name);
    if ([old, next].some(file => file && file.length > 128 * 1024)) return { before: '', after: '', message: 'Файл больше 128 КБ. Просмотр кода недоступен.' };
    const before = old ?? Buffer.alloc(0); const after = next ?? Buffer.alloc(0);
    if ([before, after].some(bytes => bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes))) return { before: '', after: '', message: 'Бинарный файл. Просмотр кода недоступен.' };
    if (!session.mask) return { before: before.toString('utf8'), after: after.toString('utf8') };
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
  async analyze(id: string, direction: Direction, selection?: IncomingSelection): Promise<Analysis> {
    const incoming = direction === 'incoming' ? parseIncomingSelection(selection) : undefined;
    this.invalidate();
    const mode: Environment = direction === 'incoming' ? 'global' : 'internal';
    const { profile } = this.context(id, mode);
    if (profile.role !== 'internal') throw new Error('Эта операция доступна только для внутреннего репозитория.');
    if (!profile.sources.internal) throw new Error('Укажите локальный репозиторий в настройках.');
    if (profile.commitRequired && direction === 'outgoing' && (await git(profile.sources.internal.location, ['status', '--porcelain=v1'])).length) throw new Error('Перед подготовкой пакета создайте коммит с применёнными изменениями.');
    if (profile.pending) throw new Error('Предыдущий пакет ожидает подтверждения. Подтвердите его применение или отмените ожидание перед новой синхронизацией.');
    let source = profile.sources[mode];
    if (!source) throw new Error('Укажите источник изменений в настройках репозитория.');
    if (source.kind === 'remote') await refreshSource(source, 'global', this.cache);
    const branch = incoming ? await resolveSource({ ...source, commit: undefined, base: undefined }, mode, this.cache) : undefined;
    if (incoming) source = { ...source, commit: incoming.commit, base: undefined };
    const resolved = await resolveSource(source, mode, this.cache);
    if (branch) await selectedAncestor(resolved.root, resolved.commit, branch.commit);
    const tree = await readTree(resolved, profile);
    if (tree.files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) throw new Error('Размер выбранных файлов превышает 512 МБ. Исключите часть файлов.');
    const scope = scopeHash(profile);
    let baseline = profile.baseline;
    let initialBytes: Map<string, Buffer> | undefined;
    if (incoming) {
      baseline = undefined;
      if (incoming.mode !== 'zero') {
        let initial: Tree; let state: string;
        if (incoming.mode === 'repositories') {
          const local = await resolveSource(profile.sources.internal, 'internal', this.cache);
          initial = await readTree(local, profile); state = local.commit;
        } else {
          state = incoming.from ?? '';
          if (incoming.mode === 'commit') {
            state = (await git(resolved.root, ['rev-list', '--parents', '-n', '1', resolved.commit])).toString().trim().split(' ')[1] ?? '';
            if (!state) throw new Error('У корневого коммита нет родителя. Для полного переноса выберите «От нулевого состояния».');
          }
          await selectedAncestor(resolved.root, state, resolved.commit);
          initial = await readTree({ ...resolved, commit: state }, profile);
        }
        baseline = { state, files: initial.files, scope }; initialBytes = initial.bytes;
      }
    }
    if (baseline && baseline.scope !== scope) throw new Error('Исключения изменились после синхронизации. Верните прежний список или создайте отдельный профиль для первичной синхронизации.');
    const type: PackageType = baseline ? 'diff' : 'snapshot';
    const before = initialBytes ?? (baseline ? await this.baselineContent(baseline) : new Map<string, Buffer>());
    let records: RecordData[];
    if (type === 'snapshot') records = tree.files.map(file => ({ path: file.path, mode: file.mode, operation: 'ADD', size: file.size, afterSha256: file.sha256, ...encode(tree.bytes.get(file.path)!) }));
    else {
      if (!baseline) throw new Error('Общее состояние синхронизации отсутствует. Требуется первичная синхронизация.');
      records = buildDiff(baseline.files, tree, before);
    }
    const targetState = profile.includeIgnored.length ? `content:${sha256(JSON.stringify(tree.files))}` : resolved.commit;
    const transport: Transport = { protocolVersion: 3, schemaVersion: 3, packageId: newPackageId(), packageType: type,
      sourceState: type === 'diff' ? baseline!.state : null, targetState, scope, files: tree.files, records };
    parseTransport(transport);
    const findings = direction === 'outgoing' ? scan(records, source.kind === 'local') : [];
    const maxBytes = profile.maxPartMB * 1024 * 1024;
    const parts = splitTransport(transport, maxBytes, profile.transportMode);
    const target: Baseline = { state: targetState, files: tree.files, scope };
    if (profile.includeIgnored.length) target.localRepository = resolved.root;
    this.exportSession = { incomingMode: incoming?.mode, sourceBaseline: incoming ? baseline : undefined, sourceBytes: incoming ? before : undefined, token: randomUUID(), profileId: id, environment: mode, resolved, tree, workingChanges: { staged: 0, unstaged: 0, untracked: 0 }, transport, findings, target, maxBytes };
    const workingChanges = await workingStatus(profile.sources.internal.location);
    this.exportSession.workingChanges = workingChanges;
    const entries = this.codeFor(this.exportSession.token, transport, before, tree.bytes, direction === 'outgoing', new Map(baseline?.files.map(file => [file.path, file.mode]) ?? []));
    return { incomingMode: incoming?.mode, token: this.exportSession.token, state: targetState, sourceState: transport.sourceState, packageType: type,
      files: tree.files.length, changes: counts(records), excludedGit: tree.excludedGit, excludedCustom: tree.excludedCustom,
      estimatedBytes: parts.reduce((sum, part) => sum + part.length, 0), parts: parts.length,
      findings: findings.map(f => f.public), lineChanges: textChanges(transport, before), local: source.kind === 'local', ignored: tree.ignored, workingChanges,
      entries };
  }
  session(token: string): ExportSession {
    const current = this.exportSession;
    if (!current || current.token !== token) throw new Error('Просмотр устарел. Запустите синхронизацию заново.');
    return current;
  }
  async exportPackage(token: string, keep: string[], override: boolean): Promise<string[]> {
    const session = this.session(token);
    const { settings, profile, mode } = this.context(session.profileId, session.environment);
    if (mode !== 'internal') throw new Error('Входящие изменения нельзя сохранить как исходящий пакет.');
    if (!settings.outputDirectory) throw new Error('Выберите папку для пакетов в настройках.');
    const findings = scan(session.transport.records, session.resolved.source.kind === 'local');
    if (findings.some(f => !keep.includes(f.public.id))) throw new Error('Рассмотрите каждое найденное совпадение.');
    if (findings.some(f => f.public.severity === 'block') && !override) throw new Error('В пакете остались возможные данные доступа. Исключите файл, замените данные в исходнике или явно разрешите их включение в пакет.');
    // Повторно читаем selected branch и included ignored-файлы перед записью.
    const current = await readTree(session.resolved, profile);
    const head = await git(session.resolved.root, ['rev-parse', '--verify', session.resolved.source.commit || `refs/heads/${session.resolved.source.branch}`]);
    if (head.toString().trim() !== session.resolved.commit || JSON.stringify(current.files) !== JSON.stringify(session.tree.files)) throw new Error('Источник изменился. Запустите синхронизацию заново.');
    const base = session.resolved.source.base;
    if (session.transport.packageType === 'diff' && base && !base.commit) {
      const baseHead = await git(session.resolved.root, ['rev-parse', '--verify', `refs/heads/${base.branch}`]);
      if (baseHead.toString().trim() !== session.transport.sourceState) throw new Error('Исходная ветка изменилась. Запустите синхронизацию заново.');
    }
    const artifacts = exportArtifacts(session.transport, session.maxBytes, profile.transportMode);
    const parts = artifacts.map(file => file.bytes);
    const names = artifacts.map(file => path.join(settings.outputDirectory, file.name));
    const written: string[] = [];
    try {
      for (let index = 0; index < parts.length; index++) {
        const handle = await open(names[index]!, 'wx', 0o600);
        written.push(names[index]!);
        try { await handle.writeFile(parts[index]!); await handle.sync(); } finally { await handle.close(); }
      }
      await this.saveBaseline(session.tree.bytes);
      profile.pending = { packageId: session.transport.packageId, target: session.target, paths: names };
      await this.store.save(settings);
    } catch (error) { for (const name of written) await rm(name, { force: true }); throw error; }
    this.exportSession = null;
    return names;
  }
  async confirmTransfer(id: string): Promise<Settings> {
    const { settings, profile } = this.context(id);
    const pending = profile.pending;
    if (!pending) throw new Error('Нет пакета, ожидающего подтверждения.');
    await this.baselineContent(pending.target);
    profile.baseline = pending.target;
    profile.syncedAt = new Date().toISOString();
    profile.commitRequired = false;
    delete profile.pending;
    this.invalidate();
    return this.store.save(settings);
  }
  async discardPending(id: string): Promise<Settings> {
    const { settings, profile } = this.context(id);
    delete profile.pending;
    this.invalidate();
    return this.store.save(settings);
  }
  finding(token: string, findingId: string): { session: ExportSession; finding: PrivateFinding } {
    const session = this.session(token);
    const finding = session.findings.find(f => f.public.id === findingId);
    if (!finding) throw new Error('Совпадение больше недоступно. Повторите проверку данных.');
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
    const { settings, profile, mode } = this.context(session.profileId, session.environment);
    const name = finding.public.path;
    const literal = name.replace(/[\\*?\[\]{}()!+@]/g, '\\$&');
    profile.exclusions = [...new Set([...profile.exclusions, literal])];
    const wasIgnored = profile.includeIgnored.includes(name);
    profile.includeIgnored = profile.includeIgnored.filter(item => item !== name);
    const files = session.transport.files.filter(file => file.path !== name);
    const records = session.transport.records.filter(record => record.path !== name && record.oldPath !== name);
    const scope = scopeHash(profile);
    const previousBaseline = profile.baseline;
    if (!session.resolved.source.base && previousBaseline && previousBaseline.scope === session.transport.scope) {
      profile.baseline = { ...previousBaseline, scope, files: previousBaseline.files.filter(file => file.path !== name) };
    }
    const targetState = profile.includeIgnored.length || session.transport.targetState.startsWith('content:') ? `content:${sha256(JSON.stringify(files))}` : session.resolved.commit;
    const transport = { ...session.transport, files, records, scope, targetState };
    parseTransport(transport);
    const findings = scan(records, session.resolved.source.kind === 'local');
    const parts = splitTransport(transport, session.maxBytes, profile.transportMode);
    const before = profile.baseline ? await this.baselineContent(profile.baseline) : new Map<string, Buffer>();
    const saved = await this.store.save(settings);
    const tree = { ...session.tree, files: session.tree.files.filter(file => file.path !== name), bytes: new Map([...session.tree.bytes].filter(([file]) => file !== name)), excludedGit: session.tree.excludedGit + (wasIgnored ? 1 : 0), excludedCustom: session.tree.excludedCustom + (wasIgnored ? 0 : 1) };
    this.exportSession = { ...session, token: randomUUID(), tree, transport, findings, target: { ...session.target, state: targetState, files, scope } };
    const entries = this.codeFor(this.exportSession.token, transport, before, tree.bytes, mode === 'internal', new Map(profile.baseline?.files.map(file => [file.path, file.mode]) ?? [])); this.replacement = null;
    return { settings: saved, analysis: { token: this.exportSession.token, state: targetState, sourceState: transport.sourceState, packageType: transport.packageType, files: files.length, changes: counts(records), excludedGit: tree.excludedGit, excludedCustom: tree.excludedCustom, estimatedBytes: parts.reduce((sum, part) => sum + part.length, 0), parts: parts.length, findings: findings.map(item => item.public), lineChanges: textChanges(transport, before), local: session.resolved.source.kind === 'local', ignored: tree.ignored, workingChanges: session.workingChanges, entries } };
  }
  async previewReplacement(token: string, findingId: string): Promise<{ token: string; path: string; line: number; preview: string; replacement: string }> {
    const { session, finding } = this.finding(token, findingId);
    if (!finding.public.canReplace || session.resolved.source.kind !== 'local' || !finding.value) throw new Error('Автоматическая замена недоступна');
    if ((await git(session.resolved.root, ['symbolic-ref', '--short', 'HEAD'])).toString().trim() !== session.resolved.source.branch) throw new Error('Для замены переключите локальный репозиторий на ветку, указанную в настройках.');
    const filename = await safePath(session.resolved.root, finding.public.path);
    const before = await optionalRead(filename);
    if (before === null) throw new Error('Локальный файл отсутствует');
    const needle = Buffer.from(finding.value);
    const start = before.indexOf(needle);
    if (start < 0 || before.indexOf(needle, start + 1) >= 0) throw new Error('Не удалось однозначно найти значение в локальном файле. Выполните замену вручную.');
    const after = Buffer.concat([before.subarray(0, start), Buffer.from(finding.public.replacement), before.subarray(start + needle.length)]);
    const replacementToken = randomUUID();
    this.replacement = { token: replacementToken, filename, root: session.resolved.root, path: finding.public.path, branch: session.resolved.source.branch, before, after };
    return { token: replacementToken, path: finding.public.path, line: before.subarray(0, start).toString('utf8').split('\n').length,
      preview: finding.public.preview, replacement: finding.public.replacement };
  }
  async applyReplacement(token: string): Promise<void> {
    const replacement = this.replacement;
    if (!replacement || replacement.token !== token) throw new Error('Просмотр замены устарел. Выберите замену ещё раз.');
    await safePath(replacement.root, replacement.path);
    if ((await git(replacement.root, ['symbolic-ref', '--short', 'HEAD'])).toString().trim() !== replacement.branch) throw new Error('Ветка изменилась после просмотра замены. Выберите замену ещё раз.');
    const stat = await lstat(replacement.filename);
    if (!stat.isFile() || stat.isSymbolicLink() || !(await readFile(replacement.filename)).equals(replacement.before)) throw new Error('Файл изменился. Выберите замену ещё раз.');
    const temporary = path.join(path.dirname(replacement.filename), `.reposync-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, replacement.after, { flag: 'wx', mode: stat.mode & 0o777 });
      await rename(temporary, replacement.filename);
    } finally { await rm(temporary, { force: true }); }
    this.invalidate();
  }
  private async importBaseline(root: string, transport: Transport, profile: Profile): Promise<Baseline | undefined> {
    if (scopeHash(profile) !== transport.scope) throw new Error('Исключения не совпадают с пакетом. Проверьте список исключений на обоих компьютерах.');
    if (transport.packageType === 'snapshot') {
      if (profile.baseline) throw new Error('Первичный пакет нельзя применить к уже синхронизированному профилю. Проверьте выбранный пакет и профиль.');
      return undefined;
    }
    const saved = profile.baseline;
    if (saved?.state === transport.sourceState && saved.scope === transport.scope) return saved;
    if (saved) throw new Error('Пакет создан для другого состояния синхронизации. Проверьте порядок применения пакетов и выбранный профиль.');
    if (!transport.sourceState || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(transport.sourceState)) throw new Error('Исходное состояние синхронизации недоступно. Требуется первичная синхронизация.');
    let tree: Tree;
    try { tree = await readTree({ root, commit: transport.sourceState, source: { kind: 'local', location: root, branch: 'HEAD' } }, profile); }
    catch { throw new Error('Исходное состояние синхронизации не найдено. Сначала выполните первичную синхронизацию.'); }
    await this.saveBaseline(tree.bytes);
    return { state: transport.sourceState, files: tree.files, scope: transport.scope };
  }
  async prepareIncoming(token: string): Promise<ImportPreview> {
    const session = this.session(token);
    if (session.environment !== 'global') throw new Error('Для применения нужно сравнение входящих изменений.');
    const { profile } = this.context(session.profileId);
    const source = session.resolved.source;
    await refreshSource(source, 'global', this.cache);
    const latest = await resolveSource(source, 'global', this.cache);
    if (latest.commit !== session.resolved.commit) throw new Error('Внешняя ветка изменилась. Запустите синхронизацию заново.');
    if (session.incomingMode === 'repositories') {
      const local = await resolveSource(profile.sources.internal!, 'internal', this.cache);
      if (local.commit !== session.transport.sourceState) throw new Error('Локальная ветка изменилась. Обновите сравнение перед применением.');
    }
    return this.prepareTransport(session.transport, profile.sources.internal!.location, profile.id, session);
  }
  async preflight(filename: string, target: string, profileId: string): Promise<ImportPreview> {
    const { profile } = this.context(profileId);
    if (profile.role !== 'external') throw new Error('Для применения пакета выберите внешний репозиторий.');
    return this.prepareTransport(await loadTransport(filename), target, profileId);
  }
  private async prepareTransport(transport: Transport, target: string, profileId: string, incoming?: ExportSession): Promise<ImportPreview> {
    this.invalidate();
    const { profile } = this.context(profileId);
    if (profile.pending) throw new Error('Сначала подтвердите применение созданного пакета или отмените ожидание.');
    const root = await realpath(target);
    const configured = profile.sources.internal;
    if (!configured || root !== await realpath(configured.location)) throw new Error('Выбранная папка не совпадает с локальным репозиторием в настройках. Проверьте путь.');
    const top = (await git(root, ['rev-parse', '--show-toplevel'])).toString().trim();
    if (await realpath(top) !== root) throw new Error('Выберите корневую папку Git-репозитория.');
    const branch = (await git(root, ['symbolic-ref', '--short', 'HEAD'])).toString().trim();
    if (branch !== configured.branch) throw new Error('Переключите локальный репозиторий на ветку, указанную в настройках.');
    const baseline = incoming ? incoming.sourceBaseline : await this.importBaseline(root, transport, profile);
    const before = incoming?.sourceBytes ?? (baseline ? await this.baselineContent(baseline) : new Map<string, Buffer>());
    if (baseline) await this.saveBaseline(before);
    const files = await prepare(root, transport, baseline, before);
    const canonical = materialize(transport, before);
    await this.saveBaseline(canonical);
    const token = randomUUID();
    this.importSession = { token, profileId, environment: 'internal', target: root, transport, files, baseline, updateCommon: !incoming || incoming.incomingMode === 'repositories' || incoming.incomingMode === 'zero' };
    const localBefore = new Map<string, Buffer>(); const localAfter = new Map<string, Buffer>();
    for (const file of files) { if (file.before) localBefore.set(file.path, file.before); if (file.after) localAfter.set(file.path, file.after); }
    const entries = this.codeFor(token, transport, localBefore, localAfter, false, new Map(files.filter(file => file.beforeMode !== null).map(file => [file.path, file.beforeMode!])));
    // For renames, the old name has a separate delete operation in the prepared set.
    return { incomingMode: incoming?.incomingMode, token, workingChanges: await workingStatus(root), packageId: transport.packageId, sourceState: transport.sourceState, targetState: transport.targetState,
      packageType: transport.packageType, changes: counts(transport.records), files: transport.files.length, lineChanges: textChanges(transport, before),
      entries };
  }
  async applyImport(token: string): Promise<Settings> {
    const session = this.importSession;
    if (!session || session.token !== token) throw new Error('Просмотр пакета устарел. Выберите пакет заново.');
    const { settings, profile } = this.context(session.profileId, session.environment);
    const configured = profile.sources.internal;
    if (!configured || await realpath(configured.location) !== await realpath(session.target) || (await git(session.target, ['symbolic-ref', '--short', 'HEAD'])).toString().trim() !== configured.branch) throw new Error('Локальный репозиторий или ветка изменились. Запустите синхронизацию заново.');
    const baseline = session.baseline;
    const files = await prepare(session.target, session.transport, baseline, baseline ? await this.baselineContent(baseline) : new Map());
    if (files.some((file, i) => !sameBuffer(file.before, session.files[i]?.before ?? null) || file.beforeMode !== session.files[i]?.beforeMode)) throw new Error('Локальные файлы изменились после просмотра. Запустите синхронизацию заново.');
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
        const observed = await optionalRead(filename);
        if (!sameBuffer(observed, file.before) || (observed !== null && (await lstat(filename)).mode % 512 !== file.beforeMode)) throw new Error('Локальные файлы изменены другим процессом во время применения. Операция остановлена.');
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
      for (const file of files) {
        const filename = await safePath(session.target, file.path);
        if (!sameBuffer(await optionalRead(filename), file.after) || (file.after !== null && process.platform !== 'win32' && ((await lstat(filename)).mode & 0o777) !== file.afterMode)) throw new Error('Результат записи не прошёл проверку. Операция остановлена.');
      }
      if (session.updateCommon) profile.baseline = { state: session.transport.targetState, files: session.transport.files, scope: session.transport.scope };
      profile.syncedAt = new Date().toISOString();
      if (files.length) profile.commitRequired = true;
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
      } catch { this.blocked = true; this.invalidate(); throw new Error(`Откат не завершён. Резервная копия сохранена в ${directory}. Не изменяйте файлы репозитория до восстановления.`); }
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
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw new Error(`Журнал восстановления повреждён: ${folder}. Сохраните журнал и резервные копии для ручного восстановления.`); }
      if (!journal.committed) {
        await restore(folder, journal);
        await this.store.save(journal.settingsBefore);
        await rm(path.join(folder, 'journal.json'));
      }
    }
  }
}
export function parseIncomingSelection(value: unknown): IncomingSelection {
  if (value === undefined) return { mode: 'commit' };
  if (!value || typeof value !== 'object' || !('mode' in value) || typeof value.mode !== 'string' || !['commit', 'range', 'repositories', 'zero'].includes(value.mode)) throw new Error('Выберите режим входящего сравнения.');
  const input = value as Record<string, unknown>;
  for (const key of ['commit', 'from']) if (input[key] !== undefined && (typeof input[key] !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(input[key]))) throw new Error('Выберите полный SHA коммита из истории внешней ветки.');
  if (input.mode === 'range' && (!input.from || !input.commit)) throw new Error('Выберите начало и конец диапазона.');
  if (input.mode !== 'range' && input.from !== undefined) throw new Error('Начальный коммит доступен только для диапазона.');
  if ((input.mode === 'zero' || input.mode === 'repositories') && input.commit !== undefined) throw new Error('Для этого режима используется вершина внешней ветки.');
  return { mode: input.mode as IncomingSelection['mode'], commit: input.commit as string | undefined, from: input.from as string | undefined };
}
async function selectedAncestor(root: string, from: string, to: string): Promise<void> {
  try { await git(root, ['merge-base', '--is-ancestor', from, to]); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('Git завершился с кодом 1.')) throw new Error('Начальный коммит не является предком конечного. Выберите коммиты одной цепочки внешней ветки.');
    throw error;
  }
}
async function workingStatus(root: string): Promise<Analysis['workingChanges']> {
  const result = { staged: 0, unstaged: 0, untracked: 0 };
  const status = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).toString('utf8').split('\0');
  for (let index = 0; index < status.length; index++) {
    const entry = status[index]; if (!entry) continue;
    if (entry.startsWith('??')) result.untracked++;
    else { if (entry[0] !== ' ') result.staged++; if (entry[1] !== ' ') result.unstaged++; }
    if (entry[0] === 'R' || entry[0] === 'C') index++;
  }
  return result;
}
function textChanges(transport: Transport, before: Map<string, Buffer>): { added: number; removed: number } {
  const result = { added: 0, removed: 0 };
  const countLines = (bytes: Buffer | undefined): number => {
    if (!bytes || bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes)) return 0;
    const text = bytes.toString('utf8'); return text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  };
  for (const record of transport.records) {
    if (record.operation === 'RENAME') continue;
    if (record.operation === 'MODIFY') {
      for (const hunk of parsePatch(decode(record).toString('utf8')).flatMap(patch => patch.hunks)) {
        result.added += hunk.lines.filter(line => line.startsWith('+')).length;
        result.removed += hunk.lines.filter(line => line.startsWith('-')).length;
      }
    } else {
      if (record.operation !== 'DELETE') result.added += countLines(decode(record));
      if (record.operation !== 'ADD') result.removed += countLines(before.get(record.path));
    }
  }
  return result;
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
      if (text && applyPatch(oldText, patch, { fuzzFactor: 0, autoConvertLineEndings: false }) !== newText) throw new Error('Не удалось построить изменения с точным сохранением байтов. Пакет не создан.');
      records.push({ path: file.path, operation: text ? 'MODIFY' : 'REPLACE', size: file.size, mode: file.mode,
        beforeSha256: previous.sha256, afterSha256: file.sha256, ...encode(text ? Buffer.from(patch) : bytes) });
    }
  }
  return records;
}
async function optionalRead(filename: string): Promise<Buffer | null> {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Путь назначения не указывает на обычный файл. Проверьте структуру репозитория.');
    if (stat.size > MAX_BYTES) throw new Error('Локальный файл превышает 512 МБ. Исключите его из синхронизации.');
    return await readFile(filename);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function materialize(transport: Transport, before: Map<string, Buffer>): Map<string, Buffer> {
  const result = new Map(before);
  let decodedBytes = 0;
  for (const record of transport.records) {
    const name = record.oldPath ?? record.path; const old = result.get(name);
    if (record.operation === 'ADD' ? !!old : !old || sha256(old) !== record.beforeSha256) throw new Error(`Изменения не соответствуют исходному состоянию файла: ${name}. Проверьте выбранный пакет.`);
    let bytes: Buffer | undefined;
    if (record.operation === 'RENAME') bytes = old;
    else if (record.operation !== 'DELETE') {
      const payload = decode(record); decodedBytes += payload.length;
      if (decodedBytes > MAX_BYTES) throw new Error('Объём восстановленных данных превышает 512 МБ.');
      if (record.operation === 'MODIFY') {
        if (!old || old.includes(0) || !Buffer.from(old.toString('utf8')).equals(old)) throw new Error('Текстовые изменения требуют файла в кодировке UTF-8.');
        const next = applyPatch(old.toString('utf8'), payload.toString('utf8'), { fuzzFactor: 0, autoConvertLineEndings: false });
        if (next === false) throw new Error(`Изменения файла повреждены: ${name}. Получите исходный пакет заново.`); bytes = Buffer.from(next);
      } else bytes = payload;
    }
    result.delete(name);
    if (bytes) {
      if (bytes.length !== record.size || sha256(bytes) !== record.afterSha256) throw new Error(`Контрольная сумма результата не совпадает: ${record.path}. Получите исходный пакет заново.`);
      if (record.path !== name && result.has(record.path)) throw new Error('Путь после переименования занят другим файлом.');
      result.set(record.path, bytes);
    }
  }
  if (result.size !== transport.files.length || transport.files.some(file => { const bytes = result.get(file.path); return !bytes || bytes.length !== file.size || sha256(bytes) !== file.sha256; })) throw new Error('Состав файлов не соответствует результату пакета. Получите исходный пакет заново.');
  return result;
}
async function prepare(root: string, transport: Transport, baseline: Baseline | undefined, before: Map<string, Buffer>): Promise<PreparedFile[]> {
  if (transport.packageType === 'diff' && (!baseline || baseline.state !== transport.sourceState || baseline.scope !== transport.scope)) throw new Error('Общее состояние не соответствует пакету. Проверьте порядок применения пакетов и выбранный профиль.');
  const canonical = materialize(transport, before);
  if (baseline) {
    const metadata = new Map(baseline.files.map(file => [file.path, file]));
    for (const record of transport.records) { metadata.delete(record.oldPath ?? record.path); if (record.operation !== 'DELETE') metadata.set(record.path, transport.files.find(file => file.path === record.path)!); }
    if (metadata.size !== transport.files.length || transport.files.some(file => { const old = metadata.get(file.path); return !old || old.mode !== file.mode || old.sha256 !== file.sha256 || old.size !== file.size; })) throw new Error('Права доступа к файлам не соответствуют результату пакета. Получите исходный пакет заново.');
  }
  const inventory = new Map(baseline?.files.map(file => [file.path, file]) ?? []);
  const prepared: PreparedFile[] = [];
  for (const record of transport.records) {
    const name = record.oldPath ?? record.path; const filename = await safePath(root, name);
    const old = await optionalRead(filename); const mode = old === null ? null : (await lstat(filename)).mode & 0o777;
    const prior = inventory.get(name);
    const contentMatches = old !== null && sha256(old) === record.beforeSha256;
    const modeMatches = old !== null && (process.platform === 'win32' || Boolean(mode! & 0o111) === Boolean(prior?.mode && prior.mode & 0o111));
    let after = canonical.get(record.path) ?? null;
    let afterMode = record.mode;
    const conflict = (): never => { throw new Error(`Синхронизация остановлена. Конфликт: ${name}. Репозиторий не изменён.`); };
    if (record.operation === 'ADD') { if (old !== null && (sha256(old) !== record.afterSha256 || (process.platform !== 'win32' && Boolean(mode! & 0o111) !== Boolean(record.mode & 0o111)))) conflict(); }
    else if (old === null) conflict();
    else if (record.operation === 'MODIFY') {
      if (old.includes(0) || !Buffer.from(old.toString('utf8')).equals(old)) conflict();
      // A local edit to mode can coexist with incoming text, but conflicting mode changes cannot.
      if (!modeMatches && prior?.mode !== record.mode) conflict();
      if (prior?.mode === record.mode) afterMode = mode!;
      const payload = decode(record).toString('utf8');
      if (!contentMatches) {
        const lines = old.toString('utf8').split('\n');
        for (const hunk of parsePatch(payload).flatMap(patch => patch.hunks)) {
          const expected = hunk.lines.filter(line => line.startsWith(' ') || line.startsWith('-')).map(line => line.slice(1));
          let matches = 0;
          if (!expected.length) conflict();
          for (let i = 0; i + expected.length <= lines.length; i++) if (expected.every((line, offset) => lines[i + offset] === line)) matches++;
          if (matches !== 1) conflict();
        }
      }
      const next = applyPatch(old.toString('utf8'), payload, { fuzzFactor: 0, autoConvertLineEndings: false });
      if (next === false) throw new Error(`Синхронизация остановлена. Конфликт: ${name}. Репозиторий не изменён.`); after = Buffer.from(next);
    } else if (!contentMatches || !modeMatches) conflict();
    if (record.operation === 'RENAME') {
      if (await optionalRead(await safePath(root, record.path)) !== null) conflict();
      prepared.push({ path: name, before: old, after: null, beforeMode: mode, afterMode });
    }
    prepared.push({ path: record.path, before: record.operation === 'RENAME' ? null : old, after, beforeMode: record.operation === 'RENAME' ? null : mode, afterMode });
  }
  if (prepared.reduce((sum, file) => sum + (file.before?.length ?? 0) + (file.after?.length ?? 0), 0) > MAX_BYTES * 2) throw new Error('Подготовленные файлы превышают защитный лимит');
  return prepared;
}
async function restore(directory: string, journal: Journal): Promise<void> {
  for (const entry of [...journal.entries].reverse().filter(entry => entry.touched)) {
    const filename = await safePath(journal.target, entry.path);
    const current = await optionalRead(filename);
    const currentHash = current === null ? null : sha256(current);
    if (currentHash !== entry.beforeSha256 && currentHash !== entry.afterSha256) throw new Error('Файл изменён другим процессом. Автоматический откат остановлен, чтобы сохранить эти изменения.');
    if (currentHash === entry.beforeSha256) { if (current !== null && entry.mode !== null) await chmod(filename, entry.mode); continue; }
    if (entry.file === null) await rm(filename, { force: true });
    else {
      await mkdir(path.dirname(filename), { recursive: true });
      const bytes = await readFile(path.join(directory, entry.file));
      await writeFile(filename, bytes, { mode: entry.mode ?? 0o644 });
      await chmod(filename, entry.mode ?? 0o644);
      if (sha256(await readFile(filename)) !== sha256(bytes)) throw new Error('Восстановленный файл не прошёл проверку целостности.');
    }
  }
  for (const name of journal.temporaryFiles) await rm(await safePath(journal.target, name), { force: true });
  for (const name of [...journal.createdDirectories].reverse()) {
    try { await rmdir(await safePath(journal.target, name)); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }
}
