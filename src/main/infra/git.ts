import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import type { BranchContext, CommitOption, Environment, FileEntry, Profile, RemoteUpdate, Source } from '../../shared/types';

export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const runningGit = new Set<() => void>();
export const stopGit = (): void => { for (const stop of runningGit) stop(); };
export const validatePath = (name: string): void => {
  if (!name || name !== name.normalize('NFC') || name.includes('\\') || /[<>:"|?*\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(name) || path.posix.isAbsolute(name)
    || name.split('/').some(p => !p || p === '.' || p === '..' || /^(?:\.git(?:~\d+)?|git~\d+)$/i.test(p)
      || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw new Error('Небезопасный или несовместимый путь в репозитории');
  }
};
export async function safePath(root: string, name: string): Promise<string> {
  validatePath(name);
  const base = await realpath(root);
  const expected = path.resolve(root);
  if ((process.platform === 'win32' ? base.toLowerCase() !== expected.toLowerCase() : base !== expected)) throw new Error('Корневая папка репозитория изменилась или заменена символической ссылкой. Проверьте путь.');
  let current = base;
  for (const segment of name.split('/')) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Путь содержит символическую ссылку. Операция остановлена.');
      if (!stat.isDirectory() && current !== path.join(base, ...name.split('/'))) throw new Error('Родительская папка заменена файлом. Проверьте структуру репозитория.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}
export async function git(cwd: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'http.followRedirects=false', ...args], {
      cwd, shell: false, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    const killTree = (): void => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill('SIGKILL'));
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const fail = (message: string): void => { if (!failed) { failed = true; killTree(); reject(new Error(message)); } };
    const stop = (): void => fail('Операция Git отменена при закрытии приложения.');
    runningGit.add(stop);
    const timer = setTimeout(() => fail('Git не ответил за 120 секунд. Проверьте источник и подключение, затем повторите операцию.'), 120_000);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024 * 1024) fail('Объём данных от Git превышает 512 МБ.');
      else chunks.push(chunk);
    });
    // stderr может содержать URL с credentials и другие приватные данные: не сохраняем и не отображаем.
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); runningGit.delete(stop); reject(new Error('Не удалось запустить Git. Проверьте его установку и доступность в PATH.')); });
    child.on('close', code => {
      clearTimeout(timer);
      runningGit.delete(stop);
      if (!failed) code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`Git завершился с кодом ${code}. Проверьте адрес репозитория, ветку и авторизацию в системных Git-инструментах.`));
    });
    child.stdin.on('error', () => { /* процесс может закрыть stdin раньше */ });
    child.stdin.end(input);
  });
}
export const validateSource = (source: Source, environment: Environment): void => {
  if (source.kind !== 'local' && source.kind !== 'remote') throw new Error('Неизвестный тип источника');
  if (!source.location || !source.branch || source.branch.startsWith('-') || /[\x00-\x20~^:?*\[\\]/.test(source.branch)
    || source.branch.includes('..') || source.branch.includes('@{')) throw new Error('Некорректная ветка или источник');
  if (source.commit && !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(source.commit)) throw new Error('Укажите полный SHA коммита из Git.');
  if (source.base) validateSource({ ...source, ...source.base, base: undefined }, environment);
  if (source.kind === 'remote') {
    if (environment !== 'global') throw new Error('Локальный источник не может быть удалённым Git-репозиторием.');
    if (!/^(https:\/\/|ssh:\/\/|git@[A-Za-z0-9.-]+:)/.test(source.location)) throw new Error('Укажите адрес Git-репозитория по HTTPS или SSH.');
    if (source.location.startsWith('https://') || source.location.startsWith('ssh://')) {
      const url = new URL(source.location);
      if (url.password || (url.protocol === 'https:' && url.username) || url.search || url.hash) throw new Error('Адрес Git не должен содержать пароль, имя пользователя HTTPS или параметры запроса. Настройте авторизацию системными Git-инструментами.');
    }
    if (/[\x00-\x20]/.test(source.location)) throw new Error('Некорректный адрес Git-репозитория.');
  }
};
export interface ResolvedSource { root: string; commit: string; source: Source }
const fetches = new Map<string, Promise<void>>();
const queues = new Map<string, Promise<void>>();
const histories = new Map<string, CommitOption[]>();
const remoteRoot = (source: Source, cache: string): string => path.join(cache, sha256(source.location));
async function fetchBranch(source: Source, cache: string, allowed: () => boolean = () => true): Promise<void> {
  const root = remoteRoot(source, cache); const key = `${root}:${source.branch}`;
  const existing = fetches.get(key); if (existing) return existing;
  const task = (queues.get(root) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    if (!allowed()) throw new Error('Настройки источника изменились или проверка отменена. Повторите операцию при необходимости.');
    await mkdir(root, { recursive: true, mode: 0o700 });
    try { await lstat(path.join(root, 'HEAD')); } catch { await git(root, ['init', '--bare']); }
    if (!allowed()) throw new Error('Настройки источника изменились или проверка отменена. Повторите операцию при необходимости.');
    await git(root, ['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'fetch', '--no-tags', '--no-recurse-submodules', '--', source.location, `+refs/heads/${source.branch}:refs/heads/${source.branch}`]);
  });
  fetches.set(key, task); queues.set(root, task);
  try { await task; } finally { fetches.delete(key); if (queues.get(root) === task) queues.delete(root); }
}
export async function resolveSource(source: Source, environment: Environment, cache: string): Promise<ResolvedSource> {
  validateSource(source, environment);
  let root = source.location; const ref = `refs/heads/${source.branch}`;
  if (source.kind === 'remote') {
    root = remoteRoot(source, cache);
    try { await git(root, ['cat-file', '-e', `${source.commit || ref}^{commit}`]); }
    catch { await fetchBranch(source, cache); }
  } else root = await realpath((await git(root, ['rev-parse', '--show-toplevel'])).toString('utf8').trim());
  const commit = (await git(root, ['rev-parse', '--verify', `${source.commit || ref}^{commit}`])).toString('utf8').trim();
  if (source.kind === 'remote' && source.commit) await git(root, ['update-ref', `refs/reposync/pins/${commit}`, commit]);
  return { root, commit, source };
}
async function remoteHeads(source: Source, cache: string): Promise<Map<string, string>> {
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const output = (await git(cache, ['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'ls-remote', '--heads', '--', source.location])).toString('utf8');
  const heads = new Map<string, string>();
  for (const row of output.split('\n').filter(Boolean)) { const [oid, ref] = row.split('\t'); if (!oid || !/^[a-f0-9]{40,64}$/.test(oid) || !ref?.startsWith('refs/heads/')) throw new Error('Не удалось прочитать список веток удалённого репозитория.'); heads.set(ref.slice(11), oid); }
  const file = path.join(cache, `${sha256(source.location)}.branches.json`); const temporary = `${file}.${process.hrtime.bigint()}.tmp`;
  try { await writeFile(temporary, JSON.stringify([...heads.keys()]), { mode: 0o600 }); await rename(temporary, file); } finally { await rm(temporary, { force: true }); }
  return heads;
}
export async function listBranches(source: Source, environment: Environment, cache: string): Promise<string[]> {
  validateSource(source, environment);
  if (source.kind === 'local') return (await git(source.location, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).toString('utf8').trim().split('\n').filter(Boolean);
  try { const saved: unknown = JSON.parse(await readFile(path.join(cache, `${sha256(source.location)}.branches.json`), 'utf8')); if (Array.isArray(saved) && saved.every((name: unknown) => typeof name === 'string')) return saved as string[]; } catch { /* cache miss */ }
  return [...(await remoteHeads(source, cache)).keys()];
}
export async function branchContext(source: Source, environment: Environment, cache: string): Promise<BranchContext> {
  validateSource(source, environment);
  let defaultBranch: string | undefined;
  if (source.kind === 'remote') {
    await mkdir(cache, { recursive: true, mode: 0o700 });
    const output = (await git(cache, ['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'ls-remote', '--symref', '--', source.location, 'HEAD'])).toString('utf8');
    defaultBranch = /^ref: refs\/heads\/(.+)	HEAD$/m.exec(output)?.[1];
  } else {
    try { defaultBranch = (await git(source.location, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])).toString().trim().replace(/^refs\/remotes\/origin\//, ''); }
    catch (error) { if (!(error instanceof Error) || !error.message.startsWith('Git завершился с кодом 1.')) throw error; }
  }
  const branches = source.kind === 'remote' ? [...(await remoteHeads(source, cache)).keys()] : await listBranches(source, environment, cache);
  return { branches, defaultBranch: defaultBranch && branches.includes(defaultBranch) ? defaultBranch : undefined };
}
export async function listCommits(source: Source, environment: Environment, cache: string): Promise<CommitOption[]> {
  const resolved = await resolveSource({ ...source, commit: '' }, environment, cache); const key = `${resolved.root}:${resolved.commit}`;
  const cached = histories.get(key); if (cached) return cached;
  const output = (await git(resolved.root, ['log', '--format=%H%x09%cs%x09%s', resolved.commit, '--'])).toString('utf8');
  const commits = output.trim().split('\n').filter(Boolean).map(line => { const [sha, date, ...subject] = line.split('\t'); if (!sha || !date) throw new Error('Не удалось прочитать историю коммитов.'); return { sha, date, subject: subject.join('\t') }; });
  if (histories.size >= 8) histories.delete(histories.keys().next().value!); histories.set(key, commits); return commits;
}
const refreshes = new Map<string, Promise<RemoteUpdate>>();
export async function refreshSource(source: Source, environment: Environment, cache: string, allowed: () => boolean = () => true): Promise<RemoteUpdate> {
  validateSource(source, environment);
  if (source.kind !== 'remote') throw new Error('Фоновая проверка доступна только для удалённого репозитория.');
  const key = `${cache}:${source.location}:${source.branch}:${source.base?.branch ?? ''}`; const existing = refreshes.get(key); if (existing) return existing;
  const task = (async (): Promise<RemoteUpdate> => {
    if (!allowed()) throw new Error('Настройки источника изменились или проверка отменена. Повторите операцию при необходимости.');
    const heads = await remoteHeads(source, cache); const changedBranches: string[] = [];
    for (const branch of new Set([source.branch, ...(source.base ? [source.base.branch] : [])])) {
      if (!allowed()) throw new Error('Настройки источника изменились или проверка отменена. Повторите операцию при необходимости.');
      let current = ''; try { current = (await git(remoteRoot(source, cache), ['rev-parse', '--verify', `refs/heads/${branch}`])).toString().trim(); } catch { /* cache miss */ }
      if (current !== heads.get(branch)) {
        if (heads.has(branch)) await fetchBranch({ ...source, branch }, cache, allowed);
        else if (current) await git(remoteRoot(source, cache), ['update-ref', '-d', `refs/heads/${branch}`]);
        changedBranches.push(branch);
      }
    }
    if (!allowed()) throw new Error('Настройки источника изменились или проверка отменена. Повторите операцию при необходимости.');
    return { changedBranches, branches: [...heads.keys()], commits: heads.has(source.branch) ? await listCommits(source, environment, cache) : [], baseCommits: source.base && heads.has(source.base.branch) ? await listCommits({ ...source, ...source.base, base: undefined }, environment, cache) : [] };
  })(); refreshes.set(key, task); try { return await task; } finally { refreshes.delete(key); }
}
export interface GitFile { path: string; oid: string; size: number; mode: number; sha256?: string }
const inventories = new Map<string, Map<string, GitFile>>();
export async function readInventory(root: string, commit: string): Promise<Map<string, GitFile>> {
  const key = `${root}:${commit}`; const saved = inventories.get(key); if (saved) return saved;
  const raw = await git(root, ['ls-tree', '-rlz', '--full-tree', commit]); const text = raw.toString('utf8');
  if (!Buffer.from(text).equals(raw)) throw new Error('Пути файлов в Git должны быть в кодировке UTF-8.');
  const files = new Map<string, GitFile>();
  for (const row of text.split('\0').filter(Boolean)) { const tab = row.indexOf('\t'); const name = row.slice(tab + 1); validatePath(name); const [mode, type, oid, size] = row.slice(0, tab).split(/\s+/); if (!oid) throw new Error('Не удалось прочитать состав файлов в Git.'); files.set(name, { path: name, oid, size: Number(size), mode: type === 'blob' && (mode === '100644' || mode === '100755') ? (mode === '100755' ? 0o755 : 0o644) : -1 }); }
  if (inventories.size >= 8) inventories.delete(inventories.keys().next().value!); inventories.set(key, files); return files;
}
export async function readBlobs(root: string, oids: string[]): Promise<Map<string, Buffer>> {
  if (!oids.length) return new Map();
  const raw = await git(root, ['cat-file', '--batch'], Buffer.from(`${oids.join('\n')}\n`)); const result = new Map<string, Buffer>(); let offset = 0;
  for (const expected of oids) { const newline = raw.indexOf(10, offset); const [oid, type, sizeText] = raw.subarray(offset, newline).toString().split(' '); const size = Number(sizeText); if (newline < 0 || oid !== expected || type !== 'blob' || !Number.isSafeInteger(size) || size < 0 || newline + size + 2 > raw.length || raw[newline + size + 1] !== 10) throw new Error('Git вернул некорректные данные файлов.'); result.set(expected, raw.subarray(newline + 1, newline + 1 + size)); offset = newline + size + 2; }
  if (offset !== raw.length) throw new Error('Git вернул лишние данные файлов.');
  return result;
}
export interface Tree { files: FileEntry[]; bytes: Map<string, Buffer>; excludedGit: number; excludedCustom: number; ignored: string[] }
export const scopeHash = (profile: Profile): string => sha256(JSON.stringify({ exclusions: profile.exclusions, includeIgnored: [...profile.includeIgnored].sort() }));
export async function readTree(resolved: ResolvedSource, profile: Profile): Promise<Tree> {
  const { root, commit, source } = resolved;
  const treeBytes = await git(root, ['ls-tree', '-rlz', '--full-tree', commit]);
  const treeText = treeBytes.toString('utf8');
  if (!Buffer.from(treeText).equals(treeBytes)) throw new Error('Пути файлов в Git должны быть в кодировке UTF-8.');
  const entries = treeText.split('\0').filter(Boolean);
  const files: FileEntry[] = [];
  const bytes = new Map<string, Buffer>();
  let excludedCustom = 0;
  let excludedGit = 0;
  let ignored: string[] = [];
  const tracked = new Set<string>();
  let totalBytes = 0;
  const included = entries.filter(entry => { const name = entry.slice(entry.indexOf('\t') + 1); return !profile.exclusions.some(rule => minimatch(name, rule, { dot: true })); });
  let includedSize = 0;
  for (const entry of included) { const tab = entry.indexOf('\t'); validatePath(entry.slice(tab + 1)); const [mode, type, , size] = entry.slice(0, tab).split(/\s+/); if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) throw new Error('Символические ссылки и подмодули Git не поддерживаются. Исключите их из синхронизации.'); includedSize += Number(size); if (!Number.isSafeInteger(includedSize) || includedSize > 512 * 1024 * 1024) throw new Error('Размер выбранных файлов превышает 512 МБ. Исключите часть файлов.'); }
  const contents = await readBlobs(root, included.map(entry => entry.slice(0, entry.indexOf('\t')).split(/\s+/)[2]!).filter(Boolean));
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    const name = entry.slice(tab + 1);
    const [mode, type, oid, sizeText] = entry.slice(0, tab).split(/\s+/);
    validatePath(name);
    tracked.add(name);
    if (profile.exclusions.some(rule => minimatch(name, rule, { dot: true }))) { excludedCustom++; continue; }
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755') || !oid) throw new Error('Символические ссылки и подмодули Git не поддерживаются. Исключите их из синхронизации.');
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0 || totalBytes + size > 512 * 1024 * 1024) throw new Error('Размер выбранных файлов превышает 512 МБ. Исключите часть файлов.');
    const content = contents.get(oid);
    if (!content) throw new Error('Не удалось прочитать содержимое файла из Git.');
    totalBytes += content.length;
    if (totalBytes > 512 * 1024 * 1024) throw new Error('Размер выбранных файлов превышает 512 МБ. Исключите часть файлов.');
    files.push({ path: name, sha256: sha256(content), size: content.length, mode: mode === '100755' ? 0o755 : 0o644 });
    bytes.set(name, content);
  }
  if (source.kind === 'local') {
    ignored = (await git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])).toString('utf8').split('\0').filter(Boolean);
    excludedGit = ignored.length;
    for (const name of profile.includeIgnored) {
      validatePath(name);
      if (tracked.has(name) || !ignored.includes(name)) throw new Error('Можно вернуть только существующий файл, исключённый Git.');
      const filename = await safePath(root, name);
      const stat = await lstat(filename);
      if (!stat.isFile()) throw new Error('Путь файла, исключённого Git, не указывает на обычный файл.');
      if (totalBytes + stat.size > 512 * 1024 * 1024) throw new Error('Размер выбранных файлов превышает 512 МБ. Исключите часть файлов.');
      const content = await readFile(filename);
      totalBytes += content.length;
      if (totalBytes > 512 * 1024 * 1024) throw new Error('Размер выбранных файлов превышает 512 МБ. Исключите часть файлов.');
      files.push({ path: name, sha256: sha256(content), size: content.length, mode: (stat.mode & 0o111) ? 0o755 : 0o644 });
      bytes.set(name, content);
      excludedGit--;
    }
  } else if (profile.includeIgnored.length) throw new Error('Удалённый репозиторий не содержит файлов, исключённых Git.');
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, bytes, excludedGit, excludedCustom, ignored };
}
export async function baselineBytes(root: string, state: string, files: FileEntry[], localRepository?: string): Promise<Map<string, Buffer>> {
  let useLocal = false;
  if (localRepository) {
    try { await git(root, ['cat-file', '-e', `${state}^{commit}`]); }
    catch { useLocal = true; }
  }
  const result = new Map<string, Buffer>();
  const inventory = useLocal ? new Map<string, GitFile>() : await readInventory(root, state);
  const blobs = useLocal ? new Map<string, Buffer>() : await readBlobs(root, files.map(file => { const entry = inventory.get(file.path); if (!entry) throw new Error('Файл исходного состояния отсутствует в Git.'); return entry.oid; }));
  for (const file of files) {
    let bytes: Buffer;
    if (useLocal) {
      const filename = await safePath(localRepository!, file.path);
      const stat = await lstat(filename);
      if (!stat.isFile() || stat.size !== file.size) throw new Error('Файлы исходного состояния изменились. Требуется первичная синхронизация.');
      bytes = await readFile(filename);
    } else bytes = blobs.get(inventory.get(file.path)!.oid)!;
    if (sha256(bytes) !== file.sha256) throw new Error('Файлы исходного состояния изменились. Для сравнения нужны сохранённые исходные данные. Требуется первичная синхронизация.');
    result.set(file.path, bytes);
  }
  return result;
}
