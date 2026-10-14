import { brotliDecompressSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Encoding, FileEntry, Operation, RecordData, Transport, TransportMode } from '../shared/types';
import { sha256, validatePath } from './infra/git';

export const MAX_BYTES = 512 * 1024 * 1024;
const MAX_PARTS = 10_000;
const HEADER = '# RepoSync transport v1\n\n```json\n';
const FOOTER = '\n```\n';
interface Part {
  protocolVersion: 1; packageId: string; packageType: string;
  sourceState: string | null; targetState: string; partNumber: number; totalParts: number;
  records: number; packageSha256: string; partSha256: string; totalBytes: number; fragment: string;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректная структура данных: ожидался объект.');
  return value as Record<string, unknown>;
}
export function string(value: unknown, limit = 8192): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Некорректное строковое поле');
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Некорректное числовое поле');
  return value;
}
function digest(value: unknown): string {
  const result = string(value, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error('Некорректная контрольная сумма SHA256.');
  return result;
}
function state(value: unknown): string {
  const result = string(value, 128);
  if (!/^[a-zA-Z0-9:-]+$/.test(result)) throw new Error('Некорректный идентификатор состояния синхронизации.');
  return result;
}
function base64(value: string): Buffer {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Некорректный BASE64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('Некорректный BASE64');
  return bytes;
}
export function encode(bytes: Buffer): { encoding: Encoding; payload: string } {
  const raw = bytes.toString('utf8');
  return Buffer.from(raw).equals(bytes) && !bytes.includes(0)
    ? { encoding: 'RAW', payload: raw }
    : { encoding: 'BASE64', payload: bytes.toString('base64') };
}
export function decode(record: Pick<RecordData, 'encoding' | 'payload'>): Buffer {
  if (record.encoding === 'RAW') return Buffer.from(record.payload, 'utf8');
  const bytes = base64(record.payload);
  if (record.encoding === 'BASE64') return bytes;
  if (record.encoding !== 'BROTLI_BASE64') throw new Error('Кодирование данных не поддерживается.');
  return brotliDecompressSync(bytes, { maxOutputLength: MAX_BYTES });
}
function parsePart(bytes: Buffer): Part {
  const text = bytes.toString('utf8');
  if (!text.startsWith(HEADER) || !text.endsWith(FOOTER)) throw new Error('Файл не похож на пакет RepoSync. Выберите исходную часть .md.');
  const raw = object(JSON.parse(text.slice(HEADER.length, -FOOTER.length)) as unknown);
  if (raw.protocolVersion !== 1) throw new Error('Версия пакета не поддерживается. Проверьте версию RepoSync.');
  const packageId = string(raw.packageId, 36);
  if (!/^[0-9a-f-]{36}$/.test(packageId)) throw new Error('Некорректный идентификатор пакета.');
  if (raw.packageType !== 'snapshot' && raw.packageType !== 'diff') throw new Error('Некорректный тип пакета');
  const part: Part = { protocolVersion: 1, packageId, packageType: raw.packageType,
    sourceState: raw.sourceState === null ? null : state(raw.sourceState), targetState: state(raw.targetState),
    partNumber: integer(raw.partNumber, 1, MAX_PARTS), totalParts: integer(raw.totalParts, 1, MAX_PARTS),
    records: integer(raw.records, 0, 100_000), packageSha256: digest(raw.packageSha256), partSha256: digest(raw.partSha256),
    totalBytes: integer(raw.totalBytes, 1, MAX_BYTES), fragment: string(raw.fragment, MAX_BYTES * 2) };
  if (part.fragment.length > Math.ceil(part.totalBytes / 3) * 4) throw new Error('Фрагмент превышает заявленный размер пакета');
  if (part.partNumber > part.totalParts || sha256(base64(part.fragment)) !== part.partSha256) throw new Error('Часть пакета повреждена. Получите исходный файл заново.');
  return part;
}
export function parseFile(value: unknown): FileEntry {
  const raw = object(value);
  const name = string(raw.path);
  validatePath(name);
  const mode = integer(raw.mode, 0o644, 0o755);
  if (mode !== 0o644 && mode !== 0o755) throw new Error('Некорректные права доступа к файлу в пакете.');
  return { path: name, sha256: digest(raw.sha256), size: integer(raw.size, 0, MAX_BYTES), mode };
}
export function parseTransport(value: unknown): Transport {
  const raw = object(value);
  if (!((raw.protocolVersion === 1 && raw.schemaVersion === 1) || (raw.protocolVersion === 2 && raw.schemaVersion === 2) || (raw.protocolVersion === 3 && raw.schemaVersion === 3) || (raw.protocolVersion === 4 && raw.schemaVersion === 4) || (raw.protocolVersion === 5 && raw.schemaVersion === 5) || (raw.protocolVersion === 6 && raw.schemaVersion === 6))) throw new Error('Версия пакета не поддерживается. Проверьте версию RepoSync.');
  if (raw.packageType !== 'snapshot' && raw.packageType !== 'diff') throw new Error('Тип пакета не поддерживается.');
  if (!Array.isArray(raw.files) || !Array.isArray(raw.records) || raw.files.length > 100_000 || raw.records.length > 100_000) throw new Error('Некорректный список файлов или изменений в пакете.');
  const files = raw.files.map(parseFile);
  const records = raw.records.map((value: unknown): RecordData => {
    const item = object(value);
    const name = string(item.path);
    validatePath(name);
    const operation = string(item.operation) as Operation;
    if (!['ADD', 'MODIFY', 'DELETE', 'RENAME', 'REPLACE'].includes(operation)) throw new Error('Неизвестная операция');
    const encoding = string(item.encoding) as Encoding;
    if (!['RAW', 'BASE64', 'BROTLI_BASE64'].includes(encoding)) throw new Error('Кодирование данных не поддерживается.');
    const record: RecordData = { path: name, operation, size: integer(item.size, 0, MAX_BYTES), mode: integer(item.mode, 0o644, 0o755), encoding,
      payload: string(item.payload, MAX_BYTES * 2) };
    if (item.oldPath !== undefined) { record.oldPath = string(item.oldPath); validatePath(record.oldPath); }
    if (item.beforeMode !== undefined) record.beforeMode = parseFile({ path: name, sha256: item.beforeSha256, size: 0, mode: item.beforeMode }).mode;
    if (Number(raw.protocolVersion) >= 4 && (operation === 'MODIFY' || (operation !== 'ADD' && record.beforeMode === undefined))) throw new Error('Некорректная полная операция.');
    if (item.beforeSha256 !== undefined) record.beforeSha256 = digest(item.beforeSha256);
    if (item.afterSha256 !== undefined) record.afterSha256 = digest(item.afterSha256);
    if ((operation !== 'ADD' && !record.beforeSha256) || (operation !== 'DELETE' && !record.afterSha256)
      || (operation !== 'RENAME' && record.oldPath !== undefined)
      || (operation === 'RENAME' && (!record.oldPath || record.oldPath === name || record.beforeSha256 !== record.afterSha256 || (Number(raw.protocolVersion) < 4 && record.payload !== '')))
      || (operation === 'DELETE' && record.payload !== '') || (operation === 'ADD' && record.beforeSha256)) throw new Error('Описание изменения противоречит данным пакета.');
    if (record.mode !== 0o644 && record.mode !== 0o755) throw new Error('Некорректные права доступа к файлу в пакете.');
    return record;
  });
  const seen = new Set<string>();
  for (const record of records) for (const name of [record.path, ...(record.oldPath ? [record.oldPath] : [])]) {
    if (seen.has(name.toLowerCase())) throw new Error('Повторяющиеся или конфликтующие пути операций');
    seen.add(name.toLowerCase());
  }
  const filePaths = new Set<string>();
  let size = 0;
  for (const file of files) {
    if (filePaths.has(file.path.toLowerCase()) || (file.mode !== 0o644 && file.mode !== 0o755)) throw new Error('Некорректный состав файлов в пакете.');
    filePaths.add(file.path.toLowerCase()); size += file.size;
    if (size > MAX_BYTES) throw new Error('Восстановленное состояние превышает 512 МБ');
  }
  for (const name of filePaths) {
    const segments = name.split('/');
    segments.pop();
    while (segments.length) { if (filePaths.has(segments.join('/'))) throw new Error('Конфликт файла и каталога'); segments.pop(); }
  }
  if (raw.packageType === 'snapshot' && (records.length !== files.length || records.some(r => r.operation !== 'ADD'))) throw new Error('Некорректный пакет первичной синхронизации.');
  if ((raw.packageType === 'snapshot' && raw.sourceState !== null) || (raw.packageType === 'diff' && raw.sourceState === null)) throw new Error('Некорректное исходное состояние синхронизации.');
  const inventory = new Map(files.map(file => [file.path, file]));
  for (const record of records) {
    const file = inventory.get(record.path);
    if (record.operation === 'DELETE' ? !!file : !file || file.sha256 !== record.afterSha256 || file.size !== record.size || file.mode !== record.mode) throw new Error('Изменение не соответствует описанному результату пакета.');
  }
  if (Number(raw.protocolVersion) >= 4 && (raw.packageType !== 'diff' || files.length !== records.filter(record => record.operation !== 'DELETE').length)) throw new Error('Пакет должен описывать только изменённые файлы.');
  return { protocolVersion: raw.protocolVersion, schemaVersion: raw.schemaVersion, packageId: string(raw.packageId, 36), packageType: raw.packageType,
    sourceState: raw.sourceState === null ? null : state(raw.sourceState), targetState: state(raw.targetState),
    scope: digest(raw.scope), files, records };
}
export async function loadTransport(selection: string | string[]): Promise<Transport> {
  const files = typeof selection === 'string' ? [selection] : selection;
  if (!files.length || files.length > MAX_PARTS || new Set(files).size !== files.length) throw new Error('Выберите неповторяющиеся части одного пакета.');
  const filename = files[0]!;
  const selected = files.length > 1 ? files : undefined;
  const firstBytes = await limitedRead(filename);
  if (firstBytes.subarray(0, COMPACT_HEADER.length).equals(Buffer.from(COMPACT_HEADER))) return loadOpenTransport(filename, firstBytes, selected);
  if (firstBytes.subarray(0, NATIVE_HEADER.length).equals(Buffer.from(NATIVE_HEADER))) return loadOpenTransport(filename, firstBytes, selected);
  if (firstBytes.subarray(0, FILE_HEADER.length).equals(Buffer.from(FILE_HEADER))) return loadOpenTransport(filename, firstBytes, selected);
  if (firstBytes.subarray(0, TEXT_HEADER.length).equals(Buffer.from(TEXT_HEADER))) return loadOpenTransport(filename, firstBytes, selected);
  if (firstBytes.subarray(0, OPEN_HEADER.length).equals(Buffer.from(OPEN_HEADER))) return loadOpenTransport(filename, firstBytes, selected);
  const first = parsePart(firstBytes);
  const candidates = selected ?? (await readdir(path.dirname(filename))).filter(name => name.endsWith('.md') && name.includes(first.packageId)).map(name => path.join(path.dirname(filename), name));
  if (!candidates.includes(filename)) candidates.push(filename);
  const parts = new Map<number, Buffer>();
  let assembled = 0;
  for (const candidate of candidates) {
    const part = parsePart(await limitedRead(candidate));
    if (part.packageId !== first.packageId) { if (selected) throw new Error('Выбраны части разных пакетов. Выберите части одного пакета.'); continue; }
    if (part.totalParts !== first.totalParts || part.packageSha256 !== first.packageSha256 || part.totalBytes !== first.totalBytes
      || part.sourceState !== first.sourceState || part.targetState !== first.targetState || part.packageType !== first.packageType || part.records !== first.records) throw new Error('Выбраны части разных пакетов. Соберите все части одного пакета в отдельной папке.');
    if (parts.has(part.partNumber)) throw new Error('Часть пакета повторяется. Проверьте набор файлов.');
    const bytes = base64(part.fragment);
    assembled += bytes.length;
    if (assembled > first.totalBytes) throw new Error('Превышен размер логического пакета');
    parts.set(part.partNumber, bytes);
  }
  if (parts.size !== first.totalParts) throw new Error('Не найдены все части пакета. Выберите все части или соберите их в одной папке с исходными именами.');
  const result = Buffer.concat(Array.from({ length: first.totalParts }, (_, i) => parts.get(i + 1)!));
  if (result.length !== first.totalBytes || sha256(result) !== first.packageSha256) throw new Error('Пакет не прошёл проверку целостности. Получите все исходные части заново.');
  const transport = parseTransport(JSON.parse(result.toString('utf8')) as unknown);
  if (transport.packageId !== first.packageId || transport.sourceState !== first.sourceState || transport.targetState !== first.targetState
    || transport.packageType !== first.packageType || transport.records.length !== first.records) throw new Error('Описание пакета не соответствует его содержимому.');
  return transport;
}
async function limitedRead(filename: string, expectedSize?: number): Promise<Buffer> {
  const { lstat } = await import('node:fs/promises');
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || (expectedSize !== undefined && info.size !== expectedSize)) throw new Error('Файл пакета отсутствует, заменён или имеет неверный размер');
  if (info.size > MAX_BYTES) throw new Error('Размер части превышает допустимый лимит. Проверьте выбранный файл.');
  return readFile(filename);
}
export const newPackageId = (): string => randomUUID();

// v2: readable metadata and literal UTF-8 payloads; native binary attachments.
const OPEN_HEADER = '# RepoSync transport v2\n\n';
const OPEN_BODY = '\n\n---\n';
interface Artifact { name: string; bytes: Buffer }
const binaryName = (id: string, index: number, name: string): string => `${id}.binary${String(index + 1).padStart(3, '0')}${path.posix.extname(name)}`;
const COMPACT_HEADER = '# RepoSync transport v6\n\n';
const NATIVE_HEADER = '# RepoSync transport v5\n\n';
const FILE_HEADER = '# RepoSync transport v4\n\n';
const TEXT_HEADER = '# RepoSync transport v3\n\n';
function textDocument(transport: Transport, mode: TransportMode, attachments: Artifact[]): Buffer {
  const version = transport.protocolVersion >= 6 ? 6 : transport.protocolVersion >= 4 ? 5 : 2;
  const readable = mode === 'readable' || version === 2;
  const bodies: Buffer[] = [];
  const records = transport.records.map((record, index) => {
    const bytes = decode(record); const raw = bytes.toString('utf8');
    const { payload: _payload, encoding: _encoding, ...descriptor } = record;
    if (version === 6 && record.operation === 'DELETE') return descriptor;
    if (!Buffer.from(raw).equals(bytes) || bytes.includes(0)) {
      const name = binaryName(transport.packageId, index, record.path);
      attachments.push({ name, bytes });
      return version === 6 ? { ...descriptor, encoding: 'FILE' } : { ...record, encoding: 'FILE', payload: name, payloadBytes: bytes.length, payloadSha256: sha256(bytes) };
    }
    const payload = bytes;
    if (readable) bodies.push(Buffer.from(`\n## ${record.operation} ${record.path}\n\n`));
    bodies.push(payload);
    if (readable) bodies.push(Buffer.from('\n'));
    return version === 6 ? { ...descriptor, encoding: 'RAW' } : { ...record, encoding: 'RAW', payload: '', payloadBytes: payload.length };
  });
  const { files: _files, unavailablePaths: _unavailable, ...description } = transport;
  const metadata = { ...(version === 6 ? description : transport), protocolVersion: version, schemaVersion: version, readable, records };
  return Buffer.concat([Buffer.from(JSON.stringify(metadata) + OPEN_BODY), ...bodies]);
}
export function exportArtifacts(transport: Transport, maxBytes: number, mode: TransportMode = 'compact'): Artifact[] {
  integer(maxBytes, 4096, MAX_BYTES);
  const attachments: Artifact[] = [];
  const document = textDocument(transport, mode, attachments);
  if (document.length + attachments.reduce((size, file) => size + file.bytes.length, 0) > MAX_BYTES) throw new Error('Пакет превышает 512 МБ');
  const version = transport.protocolVersion >= 6 ? 6 : transport.protocolVersion >= 4 ? 5 : 2;
  const template = { protocolVersion: version, schemaVersion: version, packageId: transport.packageId, partNumber: MAX_PARTS, totalParts: MAX_PARTS, totalBytes: document.length, packageSha256: sha256(document), partSha256: sha256(document) };
  const prefix = (metadata: typeof template): Buffer => Buffer.from((version === 6 ? COMPACT_HEADER : version === 5 ? NATIVE_HEADER : OPEN_HEADER) + JSON.stringify(metadata) + OPEN_BODY);
  const capacity = maxBytes - prefix(template).length;
  if (capacity < 4) throw new Error('Размер части слишком мал для описания пакета. Увеличьте его в настройках.');
  const fragments: Buffer[] = []; let offset = 0;
  while (offset < document.length) {
    let end = Math.min(offset + capacity, document.length);
    while (end < document.length && (document[end]! & 0xc0) === 0x80) end--;
    fragments.push(document.subarray(offset, end)); offset = end;
    if (fragments.length > MAX_PARTS) throw new Error('Пакет содержит слишком много частей. Увеличьте размер части в настройках.');
  }
  return [...fragments.map((fragment, index) => ({ name: `${transport.packageId}.part${String(index + 1).padStart(3, '0')}.md`, bytes: Buffer.concat([prefix({ ...template, partNumber: index + 1, totalParts: fragments.length, partSha256: sha256(fragment) }), fragment]) })), ...attachments];
}
export function splitTransport(transport: Transport, maxBytes: number, mode: TransportMode = 'compact'): Buffer[] { return exportArtifacts(transport, maxBytes, mode).map(file => file.bytes); }
function openPart(bytes: Buffer): { metadata: Record<string, unknown>; body: Buffer } {
  const header = bytes.subarray(0, COMPACT_HEADER.length).equals(Buffer.from(COMPACT_HEADER)) ? COMPACT_HEADER : bytes.subarray(0, NATIVE_HEADER.length).equals(Buffer.from(NATIVE_HEADER)) ? NATIVE_HEADER : bytes.subarray(0, FILE_HEADER.length).equals(Buffer.from(FILE_HEADER)) ? FILE_HEADER : bytes.subarray(0, TEXT_HEADER.length).equals(Buffer.from(TEXT_HEADER)) ? TEXT_HEADER : OPEN_HEADER;
  if (!bytes.subarray(0, header.length).equals(Buffer.from(header))) throw new Error('Файл не похож на пакет RepoSync. Выберите исходную часть .md.');
  const boundary = bytes.indexOf(OPEN_BODY, header.length);
  if (boundary < 0) throw new Error('В пакете отсутствует описание содержимого.');
  const metadata = object(JSON.parse(bytes.subarray(header.length, boundary).toString('utf8')) as unknown);
  if (metadata.protocolVersion !== (header === COMPACT_HEADER ? 6 : header === NATIVE_HEADER ? 5 : header === FILE_HEADER ? 4 : header === TEXT_HEADER ? 3 : 2) || metadata.schemaVersion !== metadata.protocolVersion) throw new Error('Версия пакета не поддерживается. Проверьте версию RepoSync.');
  const body = bytes.subarray(boundary + Buffer.byteLength(OPEN_BODY));
  integer(metadata.partNumber, 1, MAX_PARTS); integer(metadata.totalParts, 1, MAX_PARTS); integer(metadata.totalBytes, 1, MAX_BYTES);
  if (Number(metadata.partNumber) > Number(metadata.totalParts) || sha256(body) !== digest(metadata.partSha256)) throw new Error('Часть пакета повреждена. Получите исходный файл заново.');
  digest(metadata.packageSha256);
  if (!/^[0-9a-f-]{36}$/.test(string(metadata.packageId, 36))) throw new Error('Некорректный идентификатор пакета.');
  return { metadata, body };
}
async function loadOpenTransport(filename: string, bytes: Buffer, selected?: string[]): Promise<Transport> {
  const first = openPart(bytes); const id = string(first.metadata.packageId, 36); const parts = new Map<number, Buffer>(); let assembled = 0;
  const candidates = selected ?? (await readdir(path.dirname(filename))).filter(name => name.startsWith(`${id}.part`) && name.endsWith('.md')).map(name => path.join(path.dirname(filename), name));
  if (!candidates.includes(filename)) candidates.push(filename);
  for (const candidate of candidates) {
    const part = openPart(candidate === filename ? bytes : await limitedRead(candidate));
    for (const key of ['protocolVersion', 'schemaVersion', 'packageId', 'totalParts', 'totalBytes', 'packageSha256']) if (part.metadata[key] !== first.metadata[key]) throw new Error('Выбраны части разных пакетов. Соберите все части одного пакета в отдельной папке.');
    const number = Number(part.metadata.partNumber); if (parts.has(number)) throw new Error('Часть пакета повторяется. Проверьте набор файлов.');
    assembled += part.body.length; if (assembled > Number(first.metadata.totalBytes)) throw new Error('Превышен размер пакета'); parts.set(number, part.body);
  }
  if (parts.size !== Number(first.metadata.totalParts)) throw new Error('Не найдены все части пакета. Выберите все части или соберите их в одной папке с исходными именами.');
  const document = Buffer.concat(Array.from({ length: parts.size }, (_, index) => parts.get(index + 1)!));
  if (document.length !== Number(first.metadata.totalBytes) || sha256(document) !== first.metadata.packageSha256) throw new Error('Пакет не прошёл проверку целостности. Получите все исходные части заново.');
  const boundary = document.indexOf(OPEN_BODY); if (boundary < 0) throw new Error('В пакете отсутствует описание содержимого.');
  const raw = object(JSON.parse(document.subarray(0, boundary).toString('utf8')) as unknown);
  if (raw.protocolVersion !== first.metadata.protocolVersion || raw.schemaVersion !== first.metadata.schemaVersion || raw.packageId !== id || !Array.isArray(raw.records) || raw.records.length > 100_000) throw new Error('Описание пакета повреждено или не соответствует его частям.');
  let wireRecords: unknown[] = raw.records;
  if (raw.protocolVersion === 6) {
    if ('files' in raw) throw new Error('В пакете v6 состав файлов вычисляется из операций.');
    const keys = new Set(['path', 'oldPath', 'operation', 'size', 'mode', 'beforeMode', 'beforeSha256', 'afterSha256', 'encoding']);
    wireRecords = wireRecords.map((value: unknown, index: number) => {
      const record = object(value);
      if (Object.keys(record).some(key => !keys.has(key)) || (record.operation === 'DELETE' ? record.encoding !== undefined : record.encoding !== 'RAW' && record.encoding !== 'FILE')) throw new Error('Некорректное описание операции v6.');
      const name = string(record.path); validatePath(name);
      const size = integer(record.size, 0, MAX_BYTES);
      return { ...record, encoding: record.encoding ?? 'RAW', payloadBytes: record.operation === 'DELETE' ? 0 : size,
        payload: record.encoding === 'FILE' ? binaryName(id, index, name) : '', ...(record.encoding === 'FILE' ? { payloadSha256: digest(record.afterSha256) } : {}) };
    });
    raw.files = wireRecords.map(object).filter(record => record.operation !== 'DELETE').map(record => ({ path: record.path, mode: record.mode, size: record.size, sha256: record.afterSha256 }));
    raw.records = wireRecords;
    // Validate the complete operation set before omitting unavailable attachments.
    parseTransport({ ...raw, records: wireRecords.map(value => ({ ...object(value), encoding: 'RAW', payload: '' })) });
  }
  if (raw.protocolVersion === 3 || Number(raw.protocolVersion) >= 4) {
    if (typeof raw.readable !== 'boolean') throw new Error('Некорректное представление пакета');
    let offset = boundary + Buffer.byteLength(OPEN_BODY); let binaryBytes = 0;
    const records: RecordData[] = []; const unavailablePaths: string[] = [];
    for (let index = 0; index < wireRecords.length; index++) {
      const record = object(wireRecords[index]); const size = integer(record.payloadBytes, 0, MAX_BYTES);
      if (raw.protocolVersion === 6 && record.operation === 'DELETE') { records.push({ ...record, payload: '' } as unknown as RecordData); continue; }
      if (Number(raw.protocolVersion) >= 5 && record.encoding === 'FILE') {
        const name = string(record.path); validatePath(name);
        const attachment = binaryName(id, index, name);
        if (record.payload !== attachment || record.operation === 'DELETE') throw new Error('Некорректное бинарное вложение.');
        binaryBytes += size;
        if (binaryBytes + document.length > MAX_BYTES) throw new Error('Пакет превышает 512 МБ');
        if (digest(record.payloadSha256) !== digest(record.afterSha256)) throw new Error('Бинарное вложение повреждено.');
        let content: Buffer;
        try { content = await limitedRead(path.join(path.dirname(filename), attachment), size); }
        catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
          unavailablePaths.push(name); records.push({ ...record, encoding: 'RAW', payload: '' } as unknown as RecordData); continue;
        }
        if (sha256(content) !== digest(record.payloadSha256) || record.payloadSha256 !== record.afterSha256) throw new Error('Бинарное вложение повреждено.');
        records.push({ ...record, ...encode(content) } as unknown as RecordData);
        continue;
      }
      if (Number(raw.protocolVersion) >= 5 && (record.encoding !== 'RAW' || record.payload !== '')) throw new Error('В пакете допустимы только RAW и FILE.');
      if (raw.readable) {
        const header = Buffer.from(`\n## ${string(record.operation)} ${string(record.path)}\n\n`);
        if (!document.subarray(offset, offset + header.length).equals(header)) throw new Error('Заголовок данных не соответствует описанию пакета.'); offset += header.length;
      }
      const bytes = document.subarray(offset, offset + size); offset += size;
      if (bytes.length !== size || (raw.readable && document[offset++] !== 10)) throw new Error('Размер данных не соответствует описанию пакета.');
      const payload = bytes.toString('utf8');
      if (!Buffer.from(payload).equals(bytes) || (Number(raw.protocolVersion) >= 5 && bytes.includes(0))) throw new Error('Текст пакета повреждён: неверная кодировка UTF-8.');
      if (Number(raw.protocolVersion) >= 5 && record.operation !== 'DELETE' && (bytes.length !== record.size || sha256(bytes) !== digest(record.afterSha256))) throw new Error('Содержимое файла не соответствует размеру или контрольной сумме.');
      records.push({ ...record, payload } as unknown as RecordData);
    }
    if (offset !== document.length) throw new Error('Пакет содержит лишние данные.');
    const transport = parseTransport({ ...raw, records });
    if (!unavailablePaths.length) return transport;
    const unavailable = new Set(unavailablePaths);
    return { ...transport, unavailablePaths, files: transport.files.filter(file => !unavailable.has(file.path)), records: transport.records.filter(record => !unavailable.has(record.path)) };
  }
  let offset = boundary + Buffer.byteLength(OPEN_BODY); let binaryBytes = 0;
  const records: RecordData[] = [];
  for (let index = 0; index < wireRecords.length; index++) {
    const record = object(wireRecords[index]); const name = string(record.path); validatePath(name);
    const size = integer(record.payloadBytes, 0, MAX_BYTES); let payload: string; let encoding: Encoding;
    if (record.encoding === 'RAW') {
      const header = Buffer.from(`\n## ${string(record.operation)} ${name}\n\n`);
      if (!document.subarray(offset, offset + header.length).equals(header)) throw new Error('Заголовок данных не соответствует описанию пакета.'); offset += header.length;
      const content = document.subarray(offset, offset + size); offset += size;
      if (content.length !== size || document[offset++] !== 10) throw new Error('Размер данных не соответствует описанию пакета.');
      payload = content.toString('utf8'); if (!Buffer.from(payload).equals(content) || content.includes(0)) throw new Error('Текстовые данные пакета повреждены.'); encoding = 'RAW';
    } else if (record.encoding === 'FILE') {
      const attachment = binaryName(id, index, name);
      if (record.payload !== attachment) throw new Error('Некорректный путь бинарного файла');
      binaryBytes += size; if (binaryBytes + document.length > MAX_BYTES) throw new Error('Пакет превышает 512 МБ');
      const content = await limitedRead(path.join(path.dirname(filename), attachment), size);
      if (content.length !== size || sha256(content) !== digest(record.payloadSha256)) throw new Error('Бинарное вложение повреждено или отсутствует. Получите его заново вместе с пакетом.');
      // Internal representation only; exported attachment retains original bytes.
      payload = content.toString('base64'); encoding = 'BASE64';
    } else throw new Error('В пакете v2 допустимы только кодирования RAW и FILE.');
    records.push({ ...record, encoding, payload } as unknown as RecordData);
  }
  if (offset !== document.length) throw new Error('Пакет содержит лишние данные.');
  return parseTransport({ ...raw, records });
}
