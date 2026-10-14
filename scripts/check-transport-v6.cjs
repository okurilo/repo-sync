const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { exportArtifacts, loadTransport, decode, encode } = require('../dist/main/main/transport.js');
const { imageOperation } = require('../dist/main/shared/fileRules.js');
const { Engine } = require('../dist/main/main/engine.js');
const { SettingsStore } = require('../dist/main/main/infra/settings.js');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const delimiter = Buffer.from('\n\n---\n');
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const base = Buffer.from('before\r\n');
const binary = Buffer.from([0, 255, 13, 10, 1]);
const contents = new Map([
  ['mixed.ts', Buffer.from('\ufeff\t  const x = 1;  \r\n\r\n\n\tlast  ')],
  ['empty.txt', Buffer.alloc(0)], ['literal.md', Buffer.from('\n\n---\n## ADD source\n# RepoSync transport v6\n')],
  ['unicode.ts', Buffer.from('  Привет 世界 😀\r\n'.repeat(600))], ['added.png', binary], ['new.png', binary], ['exec.sh', Buffer.from('echo test\n')]
]);
function make(version = 6) {
  const records = [...contents].map(([name, bytes]) => ({ path: name, operation: name === 'mixed.ts' ? 'REPLACE' : name === 'new.png' ? 'RENAME' : 'ADD', size: bytes.length, mode: name === 'exec.sh' ? 0o755 : 0o644,
    ...(name === 'mixed.ts' ? { beforeMode: 0o644, beforeSha256: hash(base) } : name === 'new.png' ? { oldPath: 'old.png', beforeMode: 0o644, beforeSha256: hash(bytes) } : {}), afterSha256: hash(bytes), ...encode(bytes) }));
  records.push({ path: 'deleted.png', operation: 'DELETE', size: 6, mode: 0o644, beforeMode: 0o644, beforeSha256: hash('delete'), encoding: 'RAW', payload: '' });
  return { protocolVersion: version, schemaVersion: version, packageId: crypto.randomUUID(), packageType: 'diff', sourceState: 'before', targetState: 'after', scope: hash('scope'), files: records.filter(r => r.operation !== 'DELETE').map(r => ({ path: r.path, size: r.size, mode: r.mode, sha256: r.afterSha256 })), records };
}
async function save(dir, transport, mode = 'compact', withBinary = true, limit = 4096) {
  await fs.mkdir(dir, { recursive: true }); const artifacts = exportArtifacts(transport, limit, mode);
  for (const file of artifacts) if (withBinary || file.name.endsWith('.md')) await fs.writeFile(path.join(dir, file.name), file.bytes);
  return artifacts.filter(file => file.name.endsWith('.md')).map(file => path.join(dir, file.name));
}
function envelope(document, version, id) {
  return Buffer.concat([Buffer.from(`# RepoSync transport v${version}\n\n` + JSON.stringify({ protocolVersion: version, schemaVersion: version, packageId: id, partNumber: 1, totalParts: 1, totalBytes: document.length, packageSha256: hash(document), partSha256: hash(document) })), delimiter, document]);
}
function document(artifacts) { return Buffer.concat(artifacts.filter(a => a.name.endsWith('.md')).map(a => a.bytes.subarray(a.bytes.indexOf(delimiter) + delimiter.length))); }
async function damaged(root, transport, mutate, name) {
  const doc = document(exportArtifacts(transport, 1024 * 1024)); const boundary = doc.indexOf(delimiter);
  const metadata = JSON.parse(doc.subarray(0, boundary)); let body = doc.subarray(boundary + delimiter.length);
  const result = mutate(metadata, body); if (result) body = result;
  const packed = Buffer.concat([Buffer.from(JSON.stringify(metadata)), delimiter, body]);
  const file = path.join(root, `bad-${name}.md`); await fs.writeFile(file, envelope(packed, 6, transport.packageId));
  await assert.rejects(loadTransport(file)); checks++;
}
async function apply(root, files, full, images) {
  const local = path.join(root, `receiving-${full}-${images}`); await fs.mkdir(local);
  const git = args => execFileSync('git', args, { cwd: local, stdio: 'pipe' }); git(['init', '-b', 'main']);
  await fs.writeFile(path.join(local, '.gitattributes'), '* -text\n');
  await fs.writeFile(path.join(local, 'mixed.ts'), base);
  await fs.writeFile(path.join(local, 'old.png'), binary); await fs.writeFile(path.join(local, 'deleted.png'), 'delete');
  await fs.writeFile(path.join(local, 'added.png'), binary); await fs.writeFile(path.join(local, 'untouched.png'), 'keep');
  git(['add', '.']); git(['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'Тестовая база']);
  const profile = { id: crypto.randomUUID(), name: 'V6 QA', role: 'external', sources: { internal: { kind: 'local', location: local, branch: 'main' } }, exclusions: [], includeIgnored: [], maxPartMB: 1, transportMode: 'compact' };
  const store = new SettingsStore(path.join(root, `settings-${full}-${images}`)); await store.load(); await store.save({ ...store.get(), globalExclusions: [], profiles: [profile] });
  const engine = new Engine(store); const c = await engine.loadPackage(files, profile.id); const preview = await engine.preparePackage(c.token, c.entries.map(e => e.path)); await engine.applyImport(preview.token);
  for (const [name, bytes] of contents) {
    if (name.endsWith('.png') && (!full || !images)) continue;
    check((await fs.readFile(path.join(local, name))).equals(bytes), `Apply exact bytes ${name}`);
  }
  check((await fs.readFile(path.join(local, 'untouched.png'), 'utf8')) === 'keep', 'unrelated image preserved');
  check((await fs.stat(path.join(local, 'exec.sh'))).mode & 0o111, 'executable mode preserved');
  if (full && images) { await assert.rejects(fs.stat(path.join(local, 'old.png'))); checks++; }
  else check((await fs.readFile(path.join(local, 'old.png'))).equals(binary), 'missing/disabled rename source preserved');
  if (images) { await assert.rejects(fs.stat(path.join(local, 'deleted.png'))); checks++; }
  else check((await fs.readFile(path.join(local, 'deleted.png'), 'utf8')) === 'delete', 'disabled image deletion preserved');
  check(!store.get().profiles[0].baseline, 'partial v6 does not advance baseline');
}
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reposync-v6-')));
  try {
    const transport = make(); let fullFiles;
    for (const mode of ['compact', 'readable']) {
      const dir = path.join(root, mode); const files = await save(dir, transport, mode); if (mode === 'compact') fullFiles = files;
      const loaded = await loadTransport(files);
      for (const [name, bytes] of contents) check(decode(loaded.records.find(r => r.path === name)).equals(bytes), `${mode} exact ${name}`);
      check(loaded.records.at(-1).payload === '', 'DELETE carries no content');
      check(loaded.files.length === contents.size, 'inventory reconstructed');
      check(files.length > 1, 'multipart UTF-8 fixture');
      for (const file of files) check((await fs.stat(file)).size <= 4096, 'part bound');
      const selected = await loadTransport(files[0]); check(selected.records.length === loaded.records.length, 'automatic sibling discovery');
    }
    await apply(root, fullFiles, true, true);
    const absent = await save(path.join(root, 'absent'), transport, 'compact', false);
    const partial = await loadTransport(absent); check(partial.unavailablePaths.join(',') === 'added.png,new.png', 'missing attachments enumerated');
    check(!partial.records.some(r => r.operation === 'RENAME'), 'missing rename omitted wholly');
    await apply(root, absent, false, true);
    const filtered = { ...transport, packageId: crypto.randomUUID(), records: transport.records.filter(r => !imageOperation(r)), files: transport.files.filter(r => !imageOperation(r)) };
    const noImages = await save(path.join(root, 'no-images'), filtered); check(noImages.length > 0, 'text only artifacts'); await apply(root, noImages, false, false);
    for (const name of ['x.PNG', 'x.JpEg', 'x.svg', 'x.SVGZ', 'x.heif']) check(imageOperation({ path: name }), name);
    check(imageOperation({ path: 'x.ts', oldPath: 'x.PNG' }), 'rename out of image'); check(imageOperation({ path: 'x.png', oldPath: 'x.ts' }), 'rename into image'); check(!imageOperation({ path: 'x.json' }), 'JSON not image');
    const artifacts = exportArtifacts(transport, 1024 * 1024); const doc = document(artifacts); const meta = JSON.parse(doc.subarray(0, doc.indexOf(delimiter)));
    check(!('files' in meta) && meta.records.every(r => !('payload' in r) && !('payloadBytes' in r) && !('payloadSha256' in r)), 'compact wire contract');
    for (const [name, change] of [
      ['path', m => { m.records[0].path = '../bad'; }], ['duplicate', m => { m.records[1].path = m.records[0].path; }],
      ['case', m => { m.records[1].path = m.records[0].path.toUpperCase(); }], ['collision', m => { m.records[1].path = m.records[0].path + '/child'; }],
      ['mode', m => { m.records[0].mode = 0o777; }], ['encoding', m => { m.records[0].encoding = 'BASE64'; }],
      ['patch', m => { m.records[0].operation = 'MODIFY'; }], ['inventory', m => { m.files = []; }],
      ['length', m => { m.records[0].size++; }], ['hash', m => { m.records[0].afterSha256 = hash('wrong'); }],
      ['rename', m => { m.records[5].beforeSha256 = hash('wrong'); }], ['extra-field', m => { m.records[0].payload = 'injected'; }],
      ['delete-encoding', m => { m.records.at(-1).encoding = 'FILE'; }], ['schema', m => { m.schemaVersion = 7; }],
      ['tail', (m, body) => Buffer.concat([body, Buffer.from('artifact')])], ['utf8', (m, body) => { const next = Buffer.from(body); next[0] = 255; return next; }]
    ]) await damaged(root, transport, change, name);
    // A structurally invalid missing binary operation cannot disappear through filtering.
    await damaged(root, transport, m => { m.records[4].path = m.records[0].path; }, 'absent-conflict');
    const corrupt = path.join(root, 'compact', artifacts.find(a => a.name.includes('.binary')).name); await fs.writeFile(corrupt, Buffer.from([0, 255, 13, 10, 2])); await assert.rejects(loadTransport(fullFiles)); checks++;
    await fs.rm(corrupt); await fs.symlink(fullFiles[0], corrupt); await assert.rejects(loadTransport(fullFiles)); checks++;
    await assert.rejects(loadTransport([fullFiles[0], fullFiles[0]])); checks++;
    await assert.rejects(loadTransport(fullFiles.slice(1))); checks++;
    const broken = await fs.readFile(fullFiles[0]); broken[broken.length - 1] ^= 1; await fs.writeFile(fullFiles[0], broken); await assert.rejects(loadTransport(fullFiles)); checks++;
    // Legacy v1 envelope and v2/v3/v4/v5 import remain available.
    for (const version of [1, 2, 3, 4, 5]) {
      const bytes = Buffer.from('legacy\r\n'); const record = { path: 'legacy.txt', operation: 'ADD', size: bytes.length, mode: 0o644, afterSha256: hash(bytes), encoding: 'RAW', payload: bytes.toString() };
      const old = { ...make(version), packageType: version < 4 ? 'snapshot' : 'diff', sourceState: version < 4 ? null : 'before', files: [{ path: record.path, size: record.size, mode: record.mode, sha256: record.afterSha256 }], records: [record] };
      const dir = path.join(root, `legacy${version}`); await fs.mkdir(dir); let file;
      if (version === 1) { const data = Buffer.from(JSON.stringify(old)); const metadata = { protocolVersion: 1, packageId: old.packageId, packageType: old.packageType, sourceState: old.sourceState, targetState: old.targetState, partNumber: 1, totalParts: 1, records: 1, packageSha256: hash(data), partSha256: hash(data), totalBytes: data.length, fragment: data.toString('base64') }; file = path.join(dir, 'legacy.md'); await fs.writeFile(file, '# RepoSync transport v1\n\n```json\n' + JSON.stringify(metadata) + '\n```\n'); }
      else if (version === 3 || version === 4) { const m = { ...old, readable: false, records: [{ ...record, payload: '', payloadBytes: bytes.length }] }; const data = Buffer.concat([Buffer.from(JSON.stringify(m)), delimiter, bytes]); file = path.join(dir, 'legacy.md'); await fs.writeFile(file, envelope(data, version, old.packageId)); }
      else [file] = await save(dir, old);
      check(decode((await loadTransport(file)).records[0]).equals(bytes), `legacy ${version}`);
    }
    if (process.argv[2]) {
      const files = (await fs.readdir(process.argv[2])).filter(n => n.endsWith('.md')).sort().map(n => path.join(process.argv[2], n));
      // Repack the complete original descriptors without inventing absent binary bytes.
      const sourceParts = await Promise.all(files.map(async file => { const bytes = await fs.readFile(file); return bytes.subarray(bytes.indexOf(delimiter) + delimiter.length); }));
      const original = Buffer.concat(sourceParts); const boundary = original.indexOf(delimiter); const metadata = JSON.parse(original.subarray(0, boundary));
      const { files: _files, ...description } = metadata;
      const descriptors = metadata.records.map(record => { const { payload, payloadBytes, payloadSha256, encoding, ...fields } = record; return record.operation === 'DELETE' ? fields : { ...fields, encoding }; });
      const reduced = Buffer.concat([Buffer.from(JSON.stringify({ ...description, protocolVersion: 6, schemaVersion: 6, records: descriptors })), delimiter, original.subarray(boundary + delimiter.length)]);
      const fullWirePath = path.join(root, 'original-v6.md'); const fullWire = envelope(reduced, 6, metadata.packageId); await fs.writeFile(fullWirePath, fullWire);
      const completePartial = await loadTransport(fullWirePath);
      const loaded = await loadTransport(files); const v5 = exportArtifacts({ ...loaded, protocolVersion: 5, schemaVersion: 5 }, 1024 * 1024); const v6 = exportArtifacts({ ...loaded, protocolVersion: 6, schemaVersion: 6 }, 1024 * 1024);
      check(completePartial.unavailablePaths.length === loaded.unavailablePaths.length && completePartial.records.every((r, i) => decode(r).equals(decode(loaded.records[i]))), 'original complete wire preserves available bytes and missing attachment list');
      const n5 = document(v5).indexOf(delimiter); const n6 = document(v6).indexOf(delimiter); check(n5 - n6 >= 240000, 'sample metadata saving >=240KB');
      const roundtrip = await save(path.join(root, 'sample'), { ...loaded, protocolVersion: 6, schemaVersion: 6 }, 'compact', true, 1024 * 1024); const reread = await loadTransport(roundtrip);
      check(loaded.records.length === reread.records.length && loaded.records.every((r, i) => decode(r).equals(decode(reread.records[i]))), 'sample all available bytes exact');
      console.log(JSON.stringify({ sample: { originalMd: (await Promise.all(files.map(f => fs.stat(f)))).reduce((n, s) => n + s.size, 0), availableV5Md: v5.reduce((n, a) => n + a.bytes.length, 0), availableV6Md: v6.reduce((n, a) => n + a.bytes.length, 0), metadataSaved: n5 - n6, completeDocumentV6: reduced.length, originalDocument: original.length, completeMetadataSaved: original.length - reduced.length, missingAttachments: loaded.unavailablePaths?.length ?? 0 } }));
    }
    console.log(`PASS: ${checks} transport/image/Apply checks`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
