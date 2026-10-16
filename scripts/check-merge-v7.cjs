const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Engine } = require('../dist/main/main/engine.js');
const { SettingsStore } = require('../dist/main/main/infra/settings.js');

const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const commit = (cwd, message) => { git(cwd, ['add', '.']); git(cwd, ['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', message]); };
const profile = (id, name, role, location, branch, outputDirectory = '') => ({ id, name, role, sources: { internal: { kind: 'local', location, branch } }, exclusions: [], includeIgnored: [], maxPartMB: 64, transportMode: 'compact', outputDirectory });
async function storeAt(directory, item, outputDirectory) {
  const store = new SettingsStore(directory); await store.load();
  await store.save({ schemaVersion: 6, globalExclusions: [], profiles: [item], outputDirectory, lastRepositories: [] }); return store;
}
async function runCase(root, conflicting, keepLocal = false) {
  const suffix = conflicting ? keepLocal ? 'local' : 'conflict' : 'clean';
  const source = path.join(root, `source-${suffix}`); const target = path.join(root, `target-${suffix}`);
  await fs.mkdir(source); git(source, ['init', '-b', 'main']);
  const lines = Array.from({ length: 24 }, (_, index) => `line-${index + 1}`); const doc = values => `\uFEFF${values.join('\r\n')}\r\n`; await fs.writeFile(path.join(source, 'doc.txt'), doc(lines)); await fs.writeFile(path.join(source, 'asset.bin'), Buffer.from([0, 1, 2, 3])); await fs.writeFile(path.join(source, 'metadata.txt'), 'contact: first.last@example.com\n'); commit(source, 'A');
  const base = git(source, ['rev-parse', 'HEAD']);
  await fs.writeFile(path.join(source, 'doc.txt'), doc(lines.map((line, index) => index === 1 ? 'inner-change' : line))); await fs.writeFile(path.join(source, 'asset.bin'), Buffer.from([0, 1, 2, 9])); await fs.writeFile(path.join(source, 'metadata.txt'), 'contact removed\n'); commit(source, 'B');
  const end = git(source, ['rev-parse', 'HEAD']); await fs.mkdir(target); git(target, ['init', '-b', 'main']); await fs.writeFile(path.join(target, 'doc.txt'), doc(lines)); await fs.writeFile(path.join(target, 'asset.bin'), Buffer.from([0, 1, 2, 3])); await fs.writeFile(path.join(target, 'metadata.txt'), 'contact: first.last@example.com\n'); commit(target, 'independent A');
  const external = doc(lines.map((line, index) => index === (conflicting ? 1 : 18) ? 'external-change' : line));
  await fs.writeFile(path.join(target, 'doc.txt'), external); commit(target, 'external work');
  const outputDirectory = path.join(root, `out-${suffix}`); await fs.mkdir(outputDirectory);
  const sender = profile(crypto.randomUUID(), 'sender', 'internal', source, 'main'); sender.transportMode = conflicting ? 'compact' : 'readable';
  const senderStore = await storeAt(path.join(root, `settings-sender-${suffix}`), sender, outputDirectory); const senderEngine = new Engine(senderStore);
  const analysis = await senderEngine.analyze(sender.id, 'outgoing', undefined, { mode: 'compare', fromBranch: 'main', fromCommit: base, toBranch: 'main', toCommit: end });
  assert.equal(analysis.sourceState, base); assert.equal(analysis.state, end); assert(analysis.entries.some(entry => entry.path === 'doc.txt'));
  const review = await senderEngine.selectExport(analysis.token, ['doc.txt', 'asset.bin', 'metadata.txt']);
  assert(review.findings.some(finding => finding.path === 'metadata.txt' && finding.reason.includes('исходная версия для слияния') && !finding.canReplace));
  const packageFiles = await senderEngine.exportPackage(analysis.token, review.findings.map(finding => finding.id), false);
  const markdown = await fs.readFile(packageFiles[0], 'utf8'); assert.match(markdown, /^# RepoSync transport v7/m); assert(!markdown.includes('"encoding":"BASE64"'));
  const receiver = profile(crypto.randomUUID(), 'receiver', 'external', target, 'main');
  const receiverStore = await storeAt(path.join(root, `settings-receiver-${suffix}`), receiver, ''); const receiverEngine = new Engine(receiverStore);
  const comparison = await receiverEngine.loadPackage(packageFiles[0], receiver.id);
  const prepared = await receiverEngine.preparePackage(comparison.token, ['doc.txt', 'asset.bin', 'metadata.txt']);
  if (conflicting) {
    assert.equal(prepared.conflicts?.length, 1);
    await assert.rejects(receiverEngine.applyImport(prepared.token), /разрешите конфликты/i);
    const resolved = keepLocal
      ? await receiverEngine.preparePackage(comparison.token, ['asset.bin', 'metadata.txt'])
      : await receiverEngine.preparePackage(comparison.token, ['doc.txt', 'asset.bin', 'metadata.txt'], ['doc.txt']);
    await receiverEngine.applyImport(resolved.token);
    const result = await fs.readFile(path.join(target, 'doc.txt'), 'utf8');
    assert.equal(result.includes('inner-change'), !keepLocal);
    assert.equal(result.includes('external-change'), keepLocal);
  } else {
    assert.equal(prepared.conflicts?.length, 0);
    const preview = await receiverEngine.previewCode(prepared.token, 'doc.txt');
    assert(preview.after.includes('inner-change')); assert(preview.after.includes('external-change'));
    assert.equal(preview.source?.after, doc(lines)); assert.equal(preview.sourceLabel, 'Исходная версия A');
    await receiverEngine.applyImport(prepared.token);
    const result = await fs.readFile(path.join(target, 'doc.txt'), 'utf8'); assert(result.includes('inner-change')); assert(result.includes('external-change'));
  }
  assert.deepEqual(await fs.readFile(path.join(target, 'asset.bin')), Buffer.from([0, 1, 2, 9]));
  assert((await fs.readFile(path.join(target, 'doc.txt'))).subarray(0, 3).equals(Buffer.from([239, 187, 191])));
  assert((await fs.readFile(path.join(target, 'doc.txt'))).includes(Buffer.from('\r\n')));
  assert.equal(await fs.readFile(path.join(target, 'metadata.txt'), 'utf8'), 'contact removed\n');
}

async function runWorkingCase(root) {
  const source = path.join(root, 'source-working'); const outputDirectory = path.join(root, 'out-working');
  await fs.mkdir(source); await fs.mkdir(outputDirectory); git(source, ['init', '-b', 'main']);
  await fs.writeFile(path.join(source, 'doc.txt'), 'base\n'); commit(source, 'A');
  const store = await storeAt(path.join(root, 'settings-working'), profile(crypto.randomUUID(), 'working sender', 'internal', source, 'main'), outputDirectory);
  const engine = new Engine(store); await fs.writeFile(path.join(source, 'doc.txt'), 'working B\n');
  const analysis = await engine.analyze(store.get().profiles[0].id, 'outgoing', undefined, { mode: 'compare', fromBranch: 'main', toBranch: 'main', toWorking: true });
  assert.match(analysis.state, /^content:/); assert(analysis.entries.some(entry => entry.path === 'doc.txt'));
  await engine.selectExport(analysis.token, ['doc.txt']); await engine.exportPackage(analysis.token, [], false);
}

async function runVersionGuards(root) {
  const source = path.join(root, 'source-guards'); const outputDirectory = path.join(root, 'out-guards');
  await fs.mkdir(source); await fs.mkdir(outputDirectory); git(source, ['init', '-b', 'main']);
  await fs.writeFile(path.join(source, 'doc.txt'), 'A\n'); commit(source, 'A'); const a = git(source, ['rev-parse', 'HEAD']);
  await fs.writeFile(path.join(source, 'doc.txt'), 'B\n'); commit(source, 'B'); const b = git(source, ['rev-parse', 'HEAD']);
  const item = profile(crypto.randomUUID(), 'guard sender', 'internal', source, 'main'); const store = await storeAt(path.join(root, 'settings-guards'), item, outputDirectory); const engine = new Engine(store);
  const same = await engine.analyze(item.id, 'outgoing', undefined, { mode: 'compare', fromBranch: 'main', toBranch: 'main' });
  assert.equal(same.entries.length, 0);
  const pinned = await engine.analyze(item.id, 'outgoing', undefined, { mode: 'compare', fromBranch: 'main', fromCommit: a, toBranch: 'main', toCommit: b });
  await engine.selectExport(pinned.token, ['doc.txt']); await fs.writeFile(path.join(source, 'doc.txt'), 'C\n'); commit(source, 'C');
  await engine.exportPackage(pinned.token, [], false);
  const floatingProfile = { ...item, id: crypto.randomUUID() }; const floatingStore = await storeAt(path.join(root, 'settings-floating'), floatingProfile, outputDirectory); const floatingEngine = new Engine(floatingStore);
  const floating = await floatingEngine.analyze(floatingProfile.id, 'outgoing', undefined, { mode: 'compare', fromBranch: 'main', fromCommit: a, toBranch: 'main' });
  await floatingEngine.selectExport(floating.token, ['doc.txt']); await fs.writeFile(path.join(source, 'doc.txt'), 'D\n'); commit(source, 'D');
  await assert.rejects(floatingEngine.exportPackage(floating.token, [], false), /Источник изменился/i);
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reposync-merge-v7-'));
  try { await runCase(root, false); await runCase(root, true); await runCase(root, true, true); await runWorkingCase(root); await runVersionGuards(root); console.log('Transport v7 / three-way merge checks passed: independent Git histories, working-copy B, same-version empty result, pinned/floating branch guards, source/local/incoming preview, CRLF/BOM preservation, DLP for A, automatic merge, unresolved conflict blocking, incoming choice and keep-local exclusion.'); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
