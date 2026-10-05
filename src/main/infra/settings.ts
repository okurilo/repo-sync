import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Baseline, Environment, Profile, Settings, Source } from '../../shared/types';
import { integer, MAX_BYTES, object, parseFile, string } from '../transport';
import { validatePath, validateSource } from './git';

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
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Некорректный profile ID');
  const name = string(raw.name, 100).trim();
  if (!name) throw new Error('Введите имя профиля');
  if (!Array.isArray(raw.exclusions) || !Array.isArray(raw.includeIgnored) || raw.exclusions.length > 200 || raw.includeIgnored.length > 1000) throw new Error('Некорректные exclusions');
  const exclusions = raw.exclusions.map((rule: unknown) => string(rule, 512)).filter(Boolean);
  const includeIgnored = raw.includeIgnored.map((name: unknown) => { const result = string(name); validatePath(result); return result; });
  if (new Set(includeIgnored).size !== includeIgnored.length) throw new Error('Ignored paths не должны повторяться');
  const result: Profile = { id, name, sources: {}, baselines: existing?.baselines ?? {}, pending: existing?.pending ?? {}, exclusions, includeIgnored,
    maxPartMB: integer(raw.maxPartMB, 1, 512) };
  for (const mode of ['internal', 'global'] as const) {
    if (sources[mode] !== undefined) result.sources[mode] = parseSource(sources[mode], mode);
  }
  if (!Object.keys(result.sources).length) throw new Error('Укажите источник');
  return result;
}
function parseBaseline(value: unknown): Baseline {
  const raw = object(value);
  const state = string(raw.state, 128);
  const scope = string(raw.scope, 64);
  if (!/^[a-zA-Z0-9:-]+$/.test(state) || !/^[a-f0-9]{64}$/.test(scope)) throw new Error('Некорректный baseline state');
  if (!Array.isArray(raw.files) || raw.files.length > 100_000) throw new Error('Некорректный baseline inventory');
  const files = raw.files.map(parseFile);
  if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length || files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) throw new Error('Некорректный baseline inventory');
  const result: Baseline = { state, scope, files };
  if (raw.localRepository !== undefined) {
    result.localRepository = string(raw.localRepository);
    if (!path.isAbsolute(result.localRepository)) throw new Error('Некорректный local baseline repository');
  }
  return result;
}
export class SettingsStore {
  private value: Settings = { schemaVersion: 3, environment: null, profiles: [], outputDirectory: '', lastRepositories: [] };
  readonly filename: string;
  constructor(readonly directory: string) { this.filename = path.join(directory, 'settings.json'); }
  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const raw = object(JSON.parse(await readFile(this.filename, 'utf8')) as unknown);
      if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3) || !Array.isArray(raw.profiles) || raw.profiles.length > 100) throw new Error('Настройки повреждены или версия не поддерживается');
      const profiles = raw.profiles.map((value: unknown): Profile => {
        const saved = object(value);
        const profile = parseProfile(saved);
        const baselines = object(saved.baselines);
        const pending = object(saved.pending);
        for (const mode of ['internal', 'global'] as const) {
          if (baselines[mode] !== undefined) profile.baselines[mode] = parseBaseline(baselines[mode]);
          if (pending[mode] !== undefined) {
            const item = object(pending[mode]);
            if (!Array.isArray(item.paths) || item.paths.length > 10_000) throw new Error('Некорректные pending paths');
            profile.pending[mode] = { packageId: string(item.packageId, 36), target: parseBaseline(item.target), paths: item.paths.map((v: unknown) => string(v)) };
          }
        }
        return profile;
      });
      if (new Set(profiles.map(p => p.id)).size !== profiles.length || !Array.isArray(raw.lastRepositories) || raw.lastRepositories.length > 10) throw new Error('Некорректные профили/история');
      const mode = raw.environment === null ? null : environment(raw.environment);
      // v1 не имел selected commit; отсутствие поля мигрирует в branch HEAD без изменения state.
      this.value = { schemaVersion: 3, profiles, environment: mode, outputDirectory: string(raw.outputDirectory), lastRepositories: raw.lastRepositories.map((p: unknown) => string(p)) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Не удалось прочитать настройки RepoSync. Сохраните settings.json для восстановления.');
    }
  }
  get(): Settings { return structuredClone(this.value); }
  async save(value: Settings): Promise<Settings> {
    await atomicJSON(this.filename, value);
    this.value = structuredClone(value);
    return this.get();
  }
}
