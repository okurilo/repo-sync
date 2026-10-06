import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { randomUUID } from 'node:crypto';
import type { Baseline, Environment, Profile, Settings, Source } from '../../shared/types';
import { integer, MAX_BYTES, object, parseFile, string } from '../transport';
import { scopeHash, validatePath, validateSource } from './git';

export async function atomicJSON(filename: string, value: unknown): Promise<void> {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, filename);
  } finally { await rm(temporary, { force: true }); }
}
export function environment(value: unknown): Environment {
  if (value !== 'internal' && value !== 'global') throw new Error('Неизвестный режим среды');
  return value;
}
export function parseSource(value: unknown, mode: Environment): Source {
  const raw = object(value);
  if (raw.kind !== 'local' && raw.kind !== 'remote') throw new Error('Неизвестный источник');
  const result: Source = { kind: raw.kind, location: string(raw.location), branch: string(raw.branch, 255) };
  if (raw.commit !== undefined) result.commit = string(raw.commit, 64);
  if (raw.base !== undefined) {
    const base = object(raw.base);
    result.base = { branch: string(base.branch, 255) };
    if (base.commit !== undefined) result.base.commit = string(base.commit, 64);
  }
  validateSource(result, mode);
  if (result.kind === 'local' && !path.isAbsolute(result.location)) throw new Error('Выберите абсолютный путь репозитория');
  return result;
}
export function parseProfile(value: unknown, existing?: Profile): Profile {
  const raw = object(value);
  const sources = object(raw.sources);
  const id = string(raw.id, 36);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Некорректный идентификатор профиля синхронизации.');
  const name = string(raw.name, 100).trim();
  if (!name) throw new Error('Введите название репозитория.');
  if (!Array.isArray(raw.exclusions) || !Array.isArray(raw.includeIgnored) || raw.exclusions.length > 200 || raw.includeIgnored.length > 1000) throw new Error('Некорректный список исключений.');
  const exclusions = raw.exclusions.map((rule: unknown) => string(rule, 512)).filter(Boolean);
  if (raw.includeIgnored.length) throw new Error('В синхронизацию входят только файлы, сохранённые в коммите.');
  const includeIgnored = raw.includeIgnored.map((name: unknown) => { const result = string(name); validatePath(result); return result; });
  if (new Set(includeIgnored).size !== includeIgnored.length) throw new Error('Пути файлов, исключённых Git, не должны повторяться.');
  if (raw.role !== 'internal' && raw.role !== 'external') throw new Error('Выберите тип репозитория: внутренний или внешний.');
  if (raw.transportMode !== 'compact' && raw.transportMode !== 'readable') throw new Error('Выберите формат пакета.');
  const result: Profile = { id, name, role: raw.role, transportMode: raw.transportMode, sources: {}, baseline: existing?.baseline, pending: existing?.pending, syncedAt: existing?.syncedAt, commitRequired: existing?.commitRequired, exclusions, includeIgnored,
    maxPartMB: integer(raw.maxPartMB, 1, 512) };
  for (const mode of ['internal', 'global'] as const) {
    if (sources[mode] !== undefined) result.sources[mode] = parseSource(sources[mode], mode);
    if (result.sources[mode]) { delete result.sources[mode]!.commit; delete result.sources[mode]!.base; }
  }
  if (result.sources.internal?.kind !== 'local') throw new Error('Укажите локальный репозиторий.');
  if (result.role === 'internal' && result.sources.global?.kind !== 'remote') throw new Error('Укажите внешний Git');
  if (existing && (existing.role !== result.role || JSON.stringify(existing.sources) !== JSON.stringify(result.sources))) { result.baseline = undefined; result.syncedAt = undefined; result.commitRequired = undefined; }
  if (existing?.baseline && result.baseline && JSON.stringify(existing.exclusions) !== JSON.stringify(exclusions) && existing.exclusions.every(rule => exclusions.includes(rule))) {
    result.baseline = { ...result.baseline, scope: scopeHash(result), files: result.baseline.files.filter(file => !exclusions.some(rule => minimatch(file.path, rule, { dot: true }))) };
  }
  return result;
}
function parseBaseline(value: unknown): Baseline {
  const raw = object(value);
  const state = string(raw.state, 128);
  const scope = string(raw.scope, 64);
  if (!/^[a-zA-Z0-9:-]+$/.test(state) || !/^[a-f0-9]{64}$/.test(scope)) throw new Error('Сохранённое состояние синхронизации повреждено.');
  if (!Array.isArray(raw.files) || raw.files.length > 100_000) throw new Error('Сохранённый список файлов синхронизации повреждён.');
  const files = raw.files.map(parseFile);
  if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length || files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) throw new Error('Сохранённый список файлов синхронизации повреждён.');
  const result: Baseline = { state, scope, files };
  if (raw.localRepository !== undefined) {
    result.localRepository = string(raw.localRepository);
    if (!path.isAbsolute(result.localRepository)) throw new Error('Некорректный путь к репозиторию исходного состояния.');
  }
  return result;
}
function parseSettings(raw: Record<string, unknown>): Settings {
      if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3 && raw.schemaVersion !== 4 && raw.schemaVersion !== 5) || !Array.isArray(raw.profiles) || raw.profiles.length > 100) throw new Error('Настройки повреждены или версия не поддерживается');
      const profiles = raw.profiles.map((value: unknown): Profile => {
        const saved = object(value);
        // Legacy profiles are retained for explicit setup; divergent old baselines are
        // never promoted to a common state because that could erase local changes.
        let profile: Profile;
        if ((raw.schemaVersion === 4 || raw.schemaVersion === 5)) {
          if (saved.role !== 'internal' && saved.role !== 'external') throw new Error('Некорректный тип репозитория.');
          if (object(saved.sources).internal === undefined || (saved.role === 'internal' && object(saved.sources).global === undefined)) {
            profile = { id: string(saved.id, 36), name: string(saved.name, 100), role: saved.role === 'internal' ? 'internal' : 'external', transportMode: 'compact', sources: {}, exclusions: Array.isArray(saved.exclusions) ? saved.exclusions.map((v: unknown) => string(v, 512)) : [], includeIgnored: [], maxPartMB: integer(saved.maxPartMB, 1, 512) };
            for (const mode of ['internal', 'global'] as const) if (object(saved.sources)[mode]) profile.sources[mode] = parseSource(object(saved.sources)[mode], mode);
          } else profile = parseProfile(saved);
          if (saved.baseline !== undefined) profile.baseline = parseBaseline(saved.baseline);
          if (saved.syncedAt !== undefined) profile.syncedAt = string(saved.syncedAt, 40);
          if (saved.commitRequired !== undefined) { if (typeof saved.commitRequired !== 'boolean') throw new Error('Повреждены настройки подтверждения коммита.'); profile.commitRequired = saved.commitRequired; }
        } else {
          const sources = object(saved.sources);
          const local = sources.internal ?? (object(sources.global ?? {}).kind === 'local' ? sources.global : undefined);
          const remote = object(sources.global ?? {}).kind === 'remote' ? sources.global : undefined;
          profile = { id: string(saved.id, 36), name: string(saved.name, 100), role: remote ? 'internal' : 'external', transportMode: 'compact',
            sources: {}, exclusions: Array.isArray(saved.exclusions) ? saved.exclusions.map((v: unknown) => string(v, 512)) : [], includeIgnored: [], maxPartMB: integer(saved.maxPartMB, 1, 512) };
          if (local) { profile.sources.internal = parseSource(local, 'internal'); delete profile.sources.internal.commit; delete profile.sources.internal.base; }
          if (remote) { profile.sources.global = parseSource(remote, 'global'); delete profile.sources.global.commit; delete profile.sources.global.base; }
        }
        const pending = (raw.schemaVersion === 4 || raw.schemaVersion === 5) ? saved.pending : object(saved.pending)[raw.environment === 'global' ? 'global' : 'internal'];
        if (pending !== undefined) {
          const item = object(pending);
          if (!Array.isArray(item.paths) || item.paths.length > 10_000) throw new Error('Повреждён список файлов пакета, ожидающего подтверждения.');
          if (item.partial !== undefined && typeof item.partial !== 'boolean') throw new Error('Повреждён признак частичного пакета.');
          profile.pending = { partial: item.partial as boolean | undefined, packageId: string(item.packageId, 36), target: parseBaseline(item.target), paths: item.paths.map((v: unknown) => string(v)) };
        }
        return profile;
      });
      if (new Set(profiles.map(p => p.id)).size !== profiles.length || !Array.isArray(raw.lastRepositories) || raw.lastRepositories.length > 10) throw new Error('Список репозиториев или история повреждены.');
      return { schemaVersion: 5, profiles, outputDirectory: string(raw.outputDirectory), lastRepositories: raw.lastRepositories.map((p: unknown) => string(p)) };
}
export class SettingsStore {
  private value: Settings = { schemaVersion: 5, profiles: [], outputDirectory: '', lastRepositories: [] };
  readonly filename: string;
  constructor(readonly directory: string) { this.filename = path.join(directory, 'settings.json'); }
  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const original = await readFile(this.filename, 'utf8');
      const raw = object(JSON.parse(original) as unknown);
      this.value = parseSettings(raw);
      if (raw.schemaVersion !== 5) {
        try { await writeFile(path.join(this.directory, `settings.v${Number(raw.schemaVersion)}.backup.json`), original, { flag: 'wx', mode: 0o600 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Не удалось прочитать настройки RepoSync. Сохраните settings.json для восстановления.');
    }
  }
  get(): Settings { return structuredClone(this.value); }
  async save(value: Settings): Promise<Settings> {
    const normalized = parseSettings(object(value));
    await atomicJSON(this.filename, normalized);
    this.value = structuredClone(normalized);
    return this.get();
  }
}
