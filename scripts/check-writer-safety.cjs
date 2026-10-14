const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { create, load, git, snapshot, fs, path, Engine } = require('./writer-fixture.cjs');
const original = { rename: fs.rename, rm: fs.rm, writeFile: fs.writeFile, open: fs.open, lstat: fs.lstat };
const reset = () => Object.assign(fs, original);
async function prepare(fixture, direction) { if (direction === 'restore') await (await fixture.prepare()).run(); return fixture.prepare(direction); }
async function child(root, direction, point) {
  const f = await load(root); const op = await f.prepare(direction); let stopped = false;
  const stop = async event => { if (!stopped && event === point) { stopped = true; process.send({ point }); await new Promise(() => {}); } };
  fs.writeFile = async (name, ...args) => { if (String(name).startsWith(f.local + path.sep) && path.basename(name).startsWith('.reposync-')) await stop('before-write'); return original.writeFile(name, ...args); };
  fs.rename = async (from, to) => { const result = await original.rename(from, to); if (String(to).startsWith(f.local + path.sep) && path.basename(from).startsWith('.reposync-')) await stop('after-replace'); return result; };
  fs.rm = async (name, ...args) => { const result = await original.rm(name, ...args); if (op.files.some(file => file.after === null && name === path.join(f.local, file.path))) await stop('after-delete'); return result; };
  const save = f.store.save.bind(f.store); f.store.save = async settings => { await stop('before-commit'); return save(settings); };
  await op.run(); throw new Error(`Checkpoint not reached: ${direction}/${point}`);
}
async function crash(fixture, direction, point) {
  const worker = cp.fork(__filename, ['--child', fixture.root, direction, point], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  await new Promise((resolve, reject) => { let reached = false; const timer = setTimeout(() => { worker.kill('SIGKILL'); reject(new Error(`Checkpoint timed out: ${direction}/${point}`)); }, 60000); worker.on('message', message => { if (message.point === point) { reached = true; worker.kill('SIGKILL'); } }); worker.on('error', reject); worker.on('exit', (_code, signal) => { clearTimeout(timer); reached && signal === 'SIGKILL' ? resolve() : reject(new Error(`Unexpected child exit: ${direction}/${point}`)); }); });
}
async function noTemporaryFiles(directory) { for (const name of await fs.readdir(directory)) { if (name === '.git') continue; assert(!name.startsWith('.reposync-'), 'temporary file leaked'); const item = path.join(directory, name); if ((await fs.lstat(item)).isDirectory()) await noTemporaryFiles(item); } }
async function failed(direction, kind) {
  const f = await create();
  try {
    const op = await prepare(f, direction); const names = [...new Set(op.files.map(file => file.path).concat('untouched.txt'))]; const before = await snapshot(f.local, names); const index = git(f.local, ['ls-files', '--stage']); let fired = false; let writes = 0;
    fs.rename = async (from, to) => { if (String(to).startsWith(f.local + path.sep) && path.basename(from).startsWith('.reposync-')) { if (kind === 'write' && writes > 0 && !fired) { fired = true; throw new Error('injected write'); } writes++; } return original.rename(from, to); };
    fs.writeFile = async (name, ...args) => { if (kind === 'backup' && String(name).includes(path.sep + 'backups' + path.sep) && String(name).endsWith('.bin') && !fired) { fired = true; throw new Error('injected backup'); } return original.writeFile(name, ...args); };
    fs.open = async (name, ...args) => { const handle = await original.open(name, ...args); if (kind === 'sync' && /journal\.json\.|progress\.log$/.test(String(name))) { const sync = handle.sync.bind(handle); handle.sync = async () => { if (writes > 0 && !fired) { fired = true; throw new Error('injected sync'); } return sync(); }; } return handle; };
    const save = f.store.save.bind(f.store); f.store.save = async settings => { if (kind === 'settings' && !fired) { fired = true; throw new Error('injected settings'); } return save(settings); };
    await assert.rejects(op.run(), /injected/); reset(); assert(fired);
    assert.deepEqual(await snapshot(f.local, names), before, `${direction}/${kind}: data rollback`); assert.equal(git(f.local, ['ls-files', '--stage']), index);
    await new Engine(f.store).recover(); assert.deepEqual(await snapshot(f.local, names), before); await noTemporaryFiles(f.local);
  } finally { reset(); await f.cleanup(); }
}
async function race(direction, kind) {
  const f = await create();
  try {
    const op = await prepare(f, direction); const next = op.files.find((file, i) => i > 0 && file.before !== null && file.after !== null); const names = op.files.map(file => file.path); const before = await snapshot(f.local, names); let fired = false; let expectedIndex = git(f.local, ['ls-files', '--stage']);
    const indexFile = path.resolve(f.local, git(f.local, ['rev-parse', '--git-path', 'index'])); const indexStat = await original.lstat(indexFile, { bigint: true });
    fs.rename = async (from, to) => { const value = await original.rename(from, to); if (!fired && String(to).startsWith(f.local + path.sep) && path.basename(from).startsWith('.reposync-')) {
      fired = true;
      if (kind === 'bytes') await original.writeFile(path.join(f.local, next.path), 'external bytes');
      if (kind === 'symlink') { await original.rm(path.join(f.local, next.path)); await fs.symlink('untouched.txt', path.join(f.local, next.path)); }
      if (kind === 'operation') await original.writeFile(path.join(f.local, git(f.local, ['rev-parse', '--git-path', 'MERGE_HEAD'])), git(f.local, ['rev-parse', 'HEAD']));
      if (kind === 'mode') await fs.chmod(path.join(f.local, next.path), next.beforeMode ^ 0o111);
      if (kind === 'stage' || kind === 'hidden-stage' || kind === 'unrelated') { const name = kind === 'unrelated' ? 'untouched.txt' : next.path; const oid = git(f.local, ['hash-object', '-w', '--stdin'], 'external staged bytes'); git(f.local, ['update-index', '--cacheinfo', `100644,${oid},${name}`]); expectedIndex = git(f.local, ['ls-files', '--stage']); }
      if (kind === 'hidden-stage') fs.lstat = async (name, ...args) => String(name) === indexFile && args[0]?.bigint ? indexStat : original.lstat(name, ...args);
      if (kind === 'head') git(f.local, ['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '--allow-empty', '-m', 'Внешний commit']);
      if (kind === 'branch') git(f.local, ['switch', '-c', 'other']);
    } return value; };
    if (kind === 'unrelated') await op.run(); else await assert.rejects(op.run());
    reset(); assert(fired); assert.equal(git(f.local, ['ls-files', '--stage']), expectedIndex, 'external staged version must be preserved');
    const current = await snapshot(f.local, names);
    if (kind === 'unrelated') for (const file of op.files) assert.deepEqual(current[file.path], file.after === null ? null : { bytes: file.after, mode: file.afterMode });
    else { if (kind === 'bytes') before[next.path].bytes = Buffer.from('external bytes'); if (kind === 'mode') before[next.path].mode ^= 0o111; if (kind === 'symlink') before[next.path] = { link: 'untouched.txt' }; assert.deepEqual(current, before, `${direction}/${kind}: preserve external edits and restore own writes`); }
  } finally { reset(); await f.cleanup(); }
}
async function compatibility() {
  const f = await create();
  try {
    const op = await f.prepare(); const before = await snapshot(f.local, op.files.map(file => file.path)); await op.run();
    const copy = (await f.engine.listBackups(f.profileId)).find(item => !item.unavailable); const journalPath = path.join(copy.directory, 'journal.json'); const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
    const saved = await fs.readFile(journalPath); for (const version of [undefined, 2]) {
      const old = { ...journal, schemaVersion: version, committed: false }; await fs.writeFile(journalPath, JSON.stringify(old)); await new Engine(f.store).recover(); assert.deepEqual(await snapshot(f.local, op.files.map(file => file.path)), before); await fs.writeFile(journalPath, saved);
      if (version === undefined) await (await f.prepare()).run();
    }
    // A completed v2 copy remains available for manual restoration.
    await fs.writeFile(journalPath, JSON.stringify({ ...journal, schemaVersion: 2, committed: true }));
    assert(!(await f.engine.listBackups(f.profileId)).find(item => item.id === copy.id).unavailable);
    await (await f.prepare()).run();
    const restoration = await f.engine.prepareRestore(f.profileId, copy.id); await f.engine.applyRestore(restoration.token);
    assert.deepEqual(await snapshot(f.local, op.files.map(file => file.path)), before);
  } finally { await f.cleanup(); }
}
async function progressRecovery(kind, direction) {
  const f = await create();
  try {
    const op = await prepare(f, direction); const names = op.files.map(file => file.path); const before = await snapshot(f.local, names);
    await crash(f, direction, 'after-replace');
    let directory;
    for (const id of await fs.readdir(path.join(f.store.directory, 'backups'))) { const candidate = path.join(f.store.directory, 'backups', id); if (!JSON.parse(await fs.readFile(path.join(candidate, 'journal.json'), 'utf8')).committed) directory = candidate; }
    const journal = JSON.parse(await fs.readFile(path.join(directory, 'journal.json'), 'utf8')); assert.equal(journal.schemaVersion, 3);
    const progress = path.join(directory, 'progress.log'); const log = await fs.readFile(progress); const partial = await snapshot(f.local, names);
    if (kind === 'tail') await fs.appendFile(progress, '{unfinished');
    else if (kind === 'corrupt') { await fs.appendFile(progress, '["t",999999]\n'); await assert.rejects(new Engine(f.store).recover(), /повреждён/); assert.deepEqual(await snapshot(f.local, names), partial); await fs.writeFile(progress, log); }
    else { await fs.rm(progress); await assert.rejects(new Engine(f.store).recover(), /повреждён/); assert.deepEqual(await snapshot(f.local, names), partial); await fs.writeFile(progress, log); }
    await new Engine(f.store).recover(); assert.deepEqual(await snapshot(f.local, names), before); await noTemporaryFiles(f.local); await new Engine(f.store).recover();
  } finally { await f.cleanup(); }
}
(async () => {
  if (process.argv[2] === '--child') { await child(process.argv[3], process.argv[4], process.argv[5]); return; }
  let cases = 0;
  for (const direction of ['apply', 'restore']) {
    for (const kind of ['backup', 'write', 'sync', 'settings']) { await failed(direction, kind); cases++; }
    for (const kind of ['bytes', 'mode', 'stage', 'hidden-stage', 'head', 'branch', 'symlink', 'operation', 'unrelated']) { await race(direction, kind); cases++; }
    for (const point of ['before-write', 'after-replace', 'after-delete', 'before-commit']) {
      const f = await create(); try { const op = await prepare(f, direction); const names = op.files.map(file => file.path); const before = await snapshot(f.local, names); const index = git(f.local, ['ls-files', '--stage']); await crash(f, direction, point); await new Engine(f.store).recover(); assert.deepEqual(await snapshot(f.local, names), before); await noTemporaryFiles(f.local); assert.equal(git(f.local, ['ls-files', '--stage']), index); await new Engine(f.store).recover(); await noTemporaryFiles(f.local); if (direction === 'apply') await assert.rejects(fs.access(path.join(f.local, 'new'))); cases++; } finally { await f.cleanup(); }
    }
    console.log(`${direction}: data, failures, concurrent edits and process-crash recovery passed`);
  }
  for (const mode of [{ split: true }, { worktree: true }]) { const f = await create(mode); try { const p = await f.prepare(); const before = await snapshot(f.local, p.files.map(file => file.path)); await p.run(); await (await f.prepare('restore')).run(); assert.deepEqual(await snapshot(f.local, p.files.map(file => file.path)), before); cases++; } finally { await f.cleanup(); } }
  await compatibility(); cases++;
  if (process.argv.includes('--v3')) for (const direction of ['apply', 'restore']) for (const kind of ['tail', 'corrupt', 'missing']) { await progressRecovery(kind, direction); cases++; }
  console.log(`Writer safety passed: ${cases} real Git/file cases; remote I/O mocked; actual SIGKILL/restart, not power-loss simulation.`);
})().catch(error => { reset(); console.error(error); process.exitCode = 1; });
