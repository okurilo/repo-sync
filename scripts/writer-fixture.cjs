const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const gm = require('../dist/main/main/infra/git.js');
const { Engine } = require('../dist/main/main/engine.js');
const { SettingsStore } = require('../dist/main/main/infra/settings.js');
const originalResolve = gm.resolveSource; const originalRefresh = gm.refreshSource;
const git = (dir, args, input) => cp.execFileSync('git', args, { cwd: dir, input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const commit = dir => { git(dir, ['add', '.']); git(dir, ['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'Тестовое состояние']); };
async function load(root) {
  const config = JSON.parse(await fs.readFile(path.join(root, 'fixture.json'), 'utf8'));
  const store = new SettingsStore(path.join(root, 'settings')); await store.load();
  gm.refreshSource = async () => ({ changedBranches: [], branches: ['main', 'feature'], commits: [], baseCommits: [] });
  gm.resolveSource = async (source, mode, cache) => source.kind === 'remote' ? { ...await originalResolve({ ...source, kind: 'local', location: config.remote }, 'internal', cache), source } : originalResolve(source, mode, cache);
  const engine = new Engine(store);
  return { root, ...config, store, engine,
    async prepare(direction = 'apply') {
      let preview;
      if (direction === 'restore') { const copies = await engine.listBackups(config.profileId); preview = await engine.prepareRestore(config.profileId, copies.find(copy => !copy.unavailable).id); }
      else { const analysis = await engine.analyze(config.profileId, 'incoming', { mode: 'branch', branch: 'feature', baseBranch: 'main' }); preview = await engine.prepareIncoming(analysis.token, analysis.entries.filter(entry => !entry.excludedBy).map(entry => entry.path)); }
      const session = direction === 'restore' ? engine.restoreSession : engine.importSession;
      return { preview, files: session.files, run: () => direction === 'restore' ? engine.applyRestore(preview.token) : engine.applyImport(preview.token, true) };
    },
    async cleanup() { gm.resolveSource = originalResolve; gm.refreshSource = originalRefresh; await fs.rm(root, { recursive: true, force: true }); }
  };
}
async function create({ count = 6, ignored = 0, mixed = true, split = false, worktree = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reposync-writer-')));
  const remote = path.join(root, 'remote'); let local = path.join(root, 'local');
  try {
    await fs.mkdir(remote); git(remote, ['init', '-b', 'main']);
    await fs.writeFile(path.join(remote, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(remote, '.gitattributes'), '* -text\n');
    await fs.writeFile(path.join(remote, 'untouched.txt'), 'keep\n');
    for (let i = 0; i < count; i++) await fs.writeFile(path.join(remote, `f${String(i).padStart(5, '0')}.txt`), i === 0 && mixed ? Buffer.from([239, 187, 191, 97, 13, 10]) : `before ${i}\n`);
    if (mixed) { await fs.writeFile(path.join(remote, 'removed.txt'), 'delete original\n'); await fs.writeFile(path.join(remote, 'old.txt'), 'rename original\n'); }
    commit(remote); git(root, ['clone', remote, local]);
    if (worktree) { const linked = path.join(root, 'linked'); git(local, ['worktree', 'add', '-b', 'receiving', linked, 'main']); local = linked; }
    if (split) git(local, ['update-index', '--split-index']);
    git(remote, ['switch', '-c', 'feature']);
    for (let i = 0; i < count; i++) await fs.writeFile(path.join(remote, `f${String(i).padStart(5, '0')}.txt`), i === 0 && mixed ? Buffer.from([239, 187, 191, 98, 13, 10]) : i === 1 && mixed ? Buffer.from([0, 255, 1, 2]) : `after ${i}\n`);
    if (mixed) { await fs.rm(path.join(remote, 'removed.txt')); await fs.rename(path.join(remote, 'old.txt'), path.join(remote, 'renamed.txt')); await fs.chmod(path.join(remote, 'f00002.txt'), 0o755); await fs.mkdir(path.join(remote, 'new')); await fs.writeFile(path.join(remote, 'new', 'empty.txt'), ''); }
    commit(remote);
    if (ignored) { await fs.mkdir(path.join(local, 'node_modules')); for (let i = 0; i < ignored; i++) await fs.writeFile(path.join(local, 'node_modules', `ignored${i}`), 'ignored'); }
    const profile = { id: crypto.randomUUID(), name: 'Writer QA', role: 'internal', sources: { internal: { kind: 'local', location: local, branch: worktree ? 'receiving' : 'main' }, global: { kind: 'remote', location: 'https://example.invalid/writer.git', branch: 'feature' } }, exclusions: [], includeIgnored: [], maxPartMB: 1, transportMode: 'compact' };
    const store = new SettingsStore(path.join(root, 'settings')); await store.load(); await store.save({ schemaVersion: 6, globalExclusions: [], profiles: [profile], outputDirectory: '', lastRepositories: [] });
    await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify({ local, remote, profileId: profile.id }));
    return await load(root);
  } catch (error) { await fs.rm(root, { recursive: true, force: true }); throw error; }
}
async function snapshot(local, names) {
  const result = {};
  for (const name of names) { try { const file = path.join(local, name); const stat = await fs.lstat(file); result[name] = stat.isSymbolicLink() ? { link: await fs.readlink(file) } : { bytes: await fs.readFile(file), mode: stat.mode & 0o777 }; } catch (error) { if (error.code !== 'ENOENT') throw error; result[name] = null; } }
  return result;
}
module.exports = { create, load, git, snapshot, fs, path, gm, Engine };
