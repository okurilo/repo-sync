import { brotliDecompressSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Encoding, FileEntry, Operation, RecordData, Transport } from '../shared/types';
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидался объект');
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
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error('Некорректный SHA256');
  return result;
}
function state(value: unknown): string {
  const result = string(value, 128);
  if (!/^[a-zA-Z0-9:-]+$/.test(result)) throw new Error('Некорректный state');
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
  if (record.encoding !== 'BROTLI_BASE64') throw new Error('Неизвестный encoding');
  return brotliDecompressSync(bytes, { maxOutputLength: MAX_BYTES });
}
function parsePart(bytes: Buffer): Part {
  const text = bytes.toString('utf8');
  if (!text.startsWith(HEADER) || !text.endsWith(FOOTER)) throw new Error('Неизвестный формат Markdown-пакета');
  const raw = object(JSON.parse(text.slice(HEADER.length, -FOOTER.length)) as unknown);
  if (raw.protocolVersion !== 1) throw new Error('Protocol version не поддерживается');
  const packageId = string(raw.packageId, 36);
  if (!/^[0-9a-f-]{36}$/.test(packageId)) throw new Error('Некорректный packageId');
  if (raw.packageType !== 'snapshot' && raw.packageType !== 'diff') throw new Error('Некорректный тип пакета');
  const part: Part = { protocolVersion: 1, packageId, packageType: raw.packageType,
    sourceState: raw.sourceState === null ? null : state(raw.sourceState), targetState: state(raw.targetState),
    partNumber: integer(raw.partNumber, 1, MAX_PARTS), totalParts: integer(raw.totalParts, 1, MAX_PARTS),
    records: integer(raw.records, 0, 100_000), packageSha256: digest(raw.packageSha256), partSha256: digest(raw.partSha256),
    totalBytes: integer(raw.totalBytes, 1, MAX_BYTES), fragment: string(raw.fragment, MAX_BYTES * 2) };
  if (part.fragment.length > Math.ceil(part.totalBytes / 3) * 4) throw new Error('Фрагмент превышает заявленный размер пакета');
  if (part.partNumber > part.totalParts || sha256(base64(part.fragment)) !== part.partSha256) throw new Error('Checksum части не совпадает');
  return part;
}
export function parseFile(value: unknown): FileEntry {
  const raw = object(value);
  const name = string(raw.path);
  validatePath(name);
  const mode = integer(raw.mode, 0o644, 0o755);
  if (mode !== 0o644 && mode !== 0o755) throw new Error('Некорректный file mode');
  return { path: name, sha256: digest(raw.sha256), size: integer(raw.size, 0, MAX_BYTES), mode };
}
export function parseTransport(value: unknown): Transport {
  const raw = object(value);
  if (!((raw.protocolVersion === 1 && raw.schemaVersion === 1) || (raw.protocolVersion === 2 && raw.schemaVersion === 2))) throw new Error('Версия transport не поддерживается');
  if (raw.packageType !== 'snapshot' && raw.packageType !== 'diff') throw new Error('Неизвестный transport type');
  if (!Array.isArray(raw.files) || !Array.isArray(raw.records) || raw.files.length > 100_000 || raw.records.length > 100_000) throw new Error('Некорректные records');
  const files = raw.files.map(parseFile);
  const records = raw.records.map((value: unknown): RecordData => {
    const item = object(value);
    const name = string(item.path);
    validatePath(name);
    const operation = string(item.operation) as Operation;
    if (!['ADD', 'MODIFY', 'DELETE', 'RENAME', 'REPLACE'].includes(operation)) throw new Error('Неизвестная операция');
    const encoding = string(item.encoding) as Encoding;
    if (!['RAW', 'BASE64', 'BROTLI_BASE64'].includes(encoding)) throw new Error('Неизвестный encoding');
    const record: RecordData = { path: name, operation, size: integer(item.size, 0, MAX_BYTES), mode: integer(item.mode, 0o644, 0o755), encoding,
      payload: string(item.payload, MAX_BYTES * 2) };
    if (item.oldPath !== undefined) { record.oldPath = string(item.oldPath); validatePath(record.oldPath); }
    if (item.beforeSha256 !== undefined) record.beforeSha256 = digest(item.beforeSha256);
    if (item.afterSha256 !== undefined) record.afterSha256 = digest(item.afterSha256);
    if ((operation !== 'ADD' && !record.beforeSha256) || (operation !== 'DELETE' && !record.afterSha256)
      || (operation !== 'RENAME' && record.oldPath !== undefined)
      || (operation === 'RENAME' && (!record.oldPath || record.oldPath === name || record.beforeSha256 !== record.afterSha256 || record.payload !== ''))
      || (operation === 'DELETE' && record.payload !== '') || (operation === 'ADD' && record.beforeSha256)) throw new Error('Несогласованный manifest операции');
    if (record.mode !== 0o644 && record.mode !== 0o755) throw new Error('Некорректный file mode');
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
    if (filePaths.has(file.path.toLowerCase()) || (file.mode !== 0o644 && file.mode !== 0o755)) throw new Error('Некорректный inventory');
    filePaths.add(file.path.toLowerCase()); size += file.size;
    if (size > MAX_BYTES) throw new Error('Восстановленное состояние превышает 512 MB');
  }
  for (const name of filePaths) {
    const segments = name.split('/');
    segments.pop();
    while (segments.length) { if (filePaths.has(segments.join('/'))) throw new Error('Конфликт файла и каталога'); segments.pop(); }
  }
  if (raw.packageType === 'snapshot' && (records.length !== files.length || records.some(r => r.operation !== 'ADD'))) throw new Error('Некорректный Snapshot');
  if ((raw.packageType === 'snapshot' && raw.sourceState !== null) || (raw.packageType === 'diff' && raw.sourceState === null)) throw new Error('Некорректный sourceState');
  const inventory = new Map(files.map(file => [file.path, file]));
  for (const record of records) {
    const file = inventory.get(record.path);
    if (record.operation === 'DELETE' ? !!file : !file || file.sha256 !== record.afterSha256 || file.size !== record.size || file.mode !== record.mode) throw new Error('Операция не соответствует target inventory');
  }
  return { protocolVersion: raw.protocolVersion, schemaVersion: raw.schemaVersion, packageId: string(raw.packageId, 36), packageType: raw.packageType,
    sourceState: raw.sourceState === null ? null : state(raw.sourceState), targetState: state(raw.targetState),
    scope: digest(raw.scope), files, records };
}
export async function loadTransport(filename: string): Promise<Transport> {
  const firstBytes = await limitedRead(filename);
  if (firstBytes.subarray(0, OPEN_HEADER.length).equals(Buffer.from(OPEN_HEADER))) return loadOpenTransport(filename, firstBytes);
  const first = parsePart(firstBytes);
  const names = await readdir(path.dirname(filename));
  const parts = new Map<number, Buffer>();
  let assembled = 0;
  for (const name of names.filter(name => name.endsWith('.md'))) {
    const candidate = path.join(path.dirname(filename), name);
    let part: Part;
    // Экспорт включает UUID в имя: соседние Markdown-файлы не читаются.
    if (candidate !== filename && !name.includes(first.packageId)) continue;
    part = parsePart(await limitedRead(candidate));
    if (part.packageId !== first.packageId) continue;
    if (part.totalParts !== first.totalParts || part.packageSha256 !== first.packageSha256 || part.totalBytes !== first.totalBytes
      || part.sourceState !== first.sourceState || part.targetState !== first.targetState || part.packageType !== first.packageType || part.records !== first.records) throw new Error('Manifest частей не совпадает');
    if (parts.has(part.partNumber)) throw new Error('Дублирующая часть пакета');
    const bytes = base64(part.fragment);
    assembled += bytes.length;
    if (assembled > first.totalBytes) throw new Error('Превышен размер логического пакета');
    parts.set(part.partNumber, bytes);
  }
  if (parts.size !== first.totalParts) throw new Error('Не все части пакета присутствуют. Сохраните исходные имена частей.');
  const result = Buffer.concat(Array.from({ length: first.totalParts }, (_, i) => parts.get(i + 1)!));
  if (result.length !== first.totalBytes || sha256(result) !== first.packageSha256) throw new Error('Integrity логического пакета нарушена');
  const transport = parseTransport(JSON.parse(result.toString('utf8')) as unknown);
  if (transport.packageId !== first.packageId || transport.sourceState !== first.sourceState || transport.targetState !== first.targetState
    || transport.packageType !== first.packageType || transport.records.length !== first.records) throw new Error('Transport не соответствует внешнему manifest');
  return transport;
}
async function limitedRead(filename: string, expectedSize?: number): Promise<Buffer> {
  const { lstat } = await import('node:fs/promises');
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || (expectedSize !== undefined && info.size !== expectedSize)) throw new Error('Файл пакета отсутствует, заменён или имеет неверный размер');
  if (info.size > MAX_BYTES) throw new Error('Размер части превышает защитный лимит');
  return readFile(filename);
}
export const newPackageId = (): string => randomUUID();

// v2: readable metadata and literal UTF-8 payloads; native binary attachments.
const OPEN_HEADER = '# RepoSync transport v2\n\n';
const OPEN_BODY = '\n\n---\n';
interface Artifact { name: string; bytes: Buffer }
const binaryName = (id: string, index: number, name: string): string => `${id}.binary${String(index + 1).padStart(3, '0')}${path.posix.extname(name)}`;
function openDocument(transport: Transport): { bytes: Buffer; binaries: Artifact[] } {
  const binaries: Artifact[] = []; const bodies: Buffer[] = [];
  const records = transport.records.map((record, index) => {
    const bytes = decode(record); const text = bytes.toString('utf8');
    if (Buffer.from(text).equals(bytes) && !bytes.includes(0)) {
      bodies.push(Buffer.from(`\n## ${record.operation} ${record.path}\n\n`), bytes, Buffer.from('\n'));
      return { ...record, encoding: 'RAW', payload: '', payloadBytes: bytes.length };
    }
    const name = binaryName(transport.packageId, index, record.path); binaries.push({ name, bytes });
    return { ...record, encoding: 'FILE', payload: name, payloadBytes: bytes.length, payloadSha256: sha256(bytes) };
  });
  const metadata = { ...transport, protocolVersion: 2, schemaVersion: 2, records };
  return { bytes: Buffer.concat([Buffer.from(JSON.stringify(metadata, null, 2) + OPEN_BODY), ...bodies]), binaries };
}
export function exportArtifacts(transport: Transport, maxBytes: number): Artifact[] {
  integer(maxBytes, 4096, MAX_BYTES);
  const document = openDocument(transport);
  if (document.bytes.length + document.binaries.reduce((sum, file) => sum + file.bytes.length, 0) > MAX_BYTES) throw new Error('Открытый пакет превышает 512 MB');
  if (document.binaries.some(file => file.bytes.length > maxBytes)) throw new Error('Бинарный файл больше лимита части: увеличьте Maximum part size или исключите файл');
  const template = { protocolVersion: 2, schemaVersion: 2, packageId: transport.packageId, partNumber: MAX_PARTS, totalParts: MAX_PARTS, totalBytes: document.bytes.length, packageSha256: sha256(document.bytes), partSha256: sha256(document.bytes) };
  const prefix = (metadata: typeof template): Buffer => Buffer.from(OPEN_HEADER + JSON.stringify(metadata, null, 2) + OPEN_BODY);
  const capacity = maxBytes - prefix(template).length;
  if (capacity < 4) throw new Error('Лимит слишком мал для manifest');
  const fragments: Buffer[] = []; let offset = 0;
  while (offset < document.bytes.length) {
    let end = Math.min(offset + capacity, document.bytes.length);
    while (end < document.bytes.length && (document.bytes[end]! & 0xc0) === 0x80) end--;
    // Prefer complete lines, but allow a long line to span parts without changing bytes.
    if (end < document.bytes.length) { const newline = document.bytes.lastIndexOf(10, end - 1); if (newline > offset + capacity / 2) end = newline + 1; }
    fragments.push(document.bytes.subarray(offset, end)); offset = end;
    if (fragments.length > MAX_PARTS) throw new Error('Слишком много частей: увеличьте размер');
  }
  return [...fragments.map((fragment, index) => ({ name: `${transport.packageId}.part${String(index + 1).padStart(3, '0')}.md`, bytes: Buffer.concat([prefix({ ...template, partNumber: index + 1, totalParts: fragments.length, partSha256: sha256(fragment) }), fragment]) })), ...document.binaries];
}
export function splitTransport(transport: Transport, maxBytes: number): Buffer[] { return exportArtifacts(transport, maxBytes).map(file => file.bytes); }
function openPart(bytes: Buffer): { metadata: Record<string, unknown>; body: Buffer } {
  if (!bytes.subarray(0, OPEN_HEADER.length).equals(Buffer.from(OPEN_HEADER))) throw new Error('Неизвестный формат открытого пакета');
  const boundary = bytes.indexOf(OPEN_BODY, OPEN_HEADER.length);
  if (boundary < 0) throw new Error('Manifest отсутствует');
  const metadata = object(JSON.parse(bytes.subarray(OPEN_HEADER.length, boundary).toString('utf8')) as unknown);
  if (metadata.protocolVersion !== 2 || metadata.schemaVersion !== 2) throw new Error('Версия открытого пакета не поддерживается');
  const body = bytes.subarray(boundary + Buffer.byteLength(OPEN_BODY));
  integer(metadata.partNumber, 1, MAX_PARTS); integer(metadata.totalParts, 1, MAX_PARTS); integer(metadata.totalBytes, 1, MAX_BYTES);
  if (Number(metadata.partNumber) > Number(metadata.totalParts) || sha256(body) !== digest(metadata.partSha256)) throw new Error('Checksum части не совпадает');
  digest(metadata.packageSha256);
  if (!/^[0-9a-f-]{36}$/.test(string(metadata.packageId, 36))) throw new Error('Некорректный packageId');
  return { metadata, body };
}
async function loadOpenTransport(filename: string, bytes: Buffer): Promise<Transport> {
  const first = openPart(bytes); const id = string(first.metadata.packageId, 36); const parts = new Map<number, Buffer>(); let assembled = 0;
  for (const name of await readdir(path.dirname(filename))) {
    const candidate = path.join(path.dirname(filename), name);
    if (candidate !== filename && (!name.startsWith(`${id}.part`) || !name.endsWith('.md'))) continue;
    const part = openPart(candidate === filename ? bytes : await limitedRead(candidate));
    for (const key of ['packageId', 'totalParts', 'totalBytes', 'packageSha256']) if (part.metadata[key] !== first.metadata[key]) throw new Error('Manifest частей не совпадает');
    const number = Number(part.metadata.partNumber); if (parts.has(number)) throw new Error('Дублирующая часть');
    assembled += part.body.length; if (assembled > Number(first.metadata.totalBytes)) throw new Error('Превышен размер пакета'); parts.set(number, part.body);
  }
  if (parts.size !== Number(first.metadata.totalParts)) throw new Error('Не все части пакета присутствуют');
  const document = Buffer.concat(Array.from({ length: parts.size }, (_, index) => parts.get(index + 1)!));
  if (document.length !== Number(first.metadata.totalBytes) || sha256(document) !== first.metadata.packageSha256) throw new Error('Integrity пакета нарушена');
  const boundary = document.indexOf(OPEN_BODY); if (boundary < 0) throw new Error('Manifest отсутствует');
  const raw = object(JSON.parse(document.subarray(0, boundary).toString('utf8')) as unknown);
  if (raw.protocolVersion !== 2 || raw.schemaVersion !== 2 || raw.packageId !== id || !Array.isArray(raw.records) || raw.records.length > 100_000) throw new Error('Некорректный открытый transport');
  let offset = boundary + Buffer.byteLength(OPEN_BODY); let binaryBytes = 0;
  const records: RecordData[] = [];
  for (let index = 0; index < raw.records.length; index++) {
    const record = object(raw.records[index]); const name = string(record.path); validatePath(name);
    const size = integer(record.payloadBytes, 0, MAX_BYTES); let payload: string; let encoding: Encoding;
    if (record.encoding === 'RAW') {
      const header = Buffer.from(`\n## ${string(record.operation)} ${name}\n\n`);
      if (!document.subarray(offset, offset + header.length).equals(header)) throw new Error('Заголовок payload не совпадает'); offset += header.length;
      const content = document.subarray(offset, offset + size); offset += size;
      if (content.length !== size || document[offset++] !== 10) throw new Error('Размер payload не совпадает');
      payload = content.toString('utf8'); if (!Buffer.from(payload).equals(content) || content.includes(0)) throw new Error('Некорректный текстовый payload'); encoding = 'RAW';
    } else if (record.encoding === 'FILE') {
      const attachment = binaryName(id, index, name);
      if (record.payload !== attachment) throw new Error('Некорректный путь бинарного файла');
      binaryBytes += size; if (binaryBytes + document.length > MAX_BYTES) throw new Error('Пакет превышает 512 MB');
      const content = await limitedRead(path.join(path.dirname(filename), attachment), size);
      if (content.length !== size || sha256(content) !== digest(record.payloadSha256)) throw new Error('Бинарный файл повреждён или отсутствует');
      // Internal representation only; exported attachment retains original bytes.
      payload = content.toString('base64'); encoding = 'BASE64';
    } else throw new Error('В v2 разрешены только RAW и FILE');
    records.push({ ...record, encoding, payload } as unknown as RecordData);
  }
  if (offset !== document.length) throw new Error('Лишние bytes в открытом пакете');
  return parseTransport({ ...raw, records });
}
