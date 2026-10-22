const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Engine } = require('../dist/main/main/engine.js');
const { SettingsStore } = require('../dist/main/main/infra/settings.js');

const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reposync-branch-switch-')));
  try {
    const repo = path.join(root, 'repo'); await fs.mkdir(repo); git(repo, ['init', '-b', 'alpha']);
    await fs.writeFile(path.join(repo, 'file.txt'), 'one\n');
    git(repo, ['add', '.']); git(repo, ['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'base']);
    git(repo, ['branch', 'beta']);
    const profile = { id: crypto.randomUUID(), name: 'Проверка ветки', role: 'external', transportMode: 'compact', sources: { internal: { kind: 'local', location: repo, branch: 'alpha' } }, baseline: { state: 'abc', scope: 'a'.repeat(64), files: [] }, exclusions: [], includeIgnored: [], maxPartMB: 1 };
    const store = new SettingsStore(path.join(root, 'settings')); await store.load();
    await store.save({ schemaVersion: 6, profiles: [profile], globalExclusions: [], outputDirectory: '', lastRepositories: [] });
    const engine = new Engine(store);
    const other = path.join(root, 'other'); git(repo, ['worktree', 'add', other, 'beta']);
    await assert.rejects(engine.switchLocalBranch(profile.id, 'beta'), /Не удалось переключить локальную ветку/);
    assert.equal(git(repo, ['branch', '--show-current']), 'alpha'); await fs.rm(other, { recursive: true, force: true }); git(repo, ['worktree', 'prune']);
    const switched = await engine.switchLocalBranch(profile.id, 'beta');
    assert.equal(switched.branch, 'beta'); assert.equal(store.get().profiles[0].sources.internal.branch, 'beta');
    assert.equal(store.get().profiles[0].baseline.state, 'abc');
    const loaded = new SettingsStore(store.directory); await loaded.load(); assert.equal(loaded.get().profiles[0].sources.internal.branch, 'beta');
    await fs.writeFile(path.join(repo, 'dirty.txt'), 'unsaved');
    await assert.rejects(engine.switchLocalBranch(profile.id, 'beta'), /Переключение ветки недоступно/);
    assert.equal(git(repo, ['branch', '--show-current']), 'beta'); await fs.rm(path.join(repo, 'dirty.txt'));
    await assert.rejects(engine.switchLocalBranch(profile.id, 'missing'), /отсутствует|недоступно/);
    const save = store.save.bind(store); let fail = true;
    store.save = async settings => { if (fail) { fail = false; throw new Error('fixture settings failure'); } return save(settings); };
    await assert.rejects(engine.switchLocalBranch(profile.id, 'alpha'), /переключился на «alpha».+сохранить ветку/);
    assert.equal(git(repo, ['branch', '--show-current']), 'alpha'); assert.equal(store.get().profiles[0].sources.internal.branch, 'beta');
    const recovered = await engine.switchLocalBranch(profile.id, 'alpha');
    assert.equal(recovered.branch, 'alpha'); assert.equal(store.get().profiles[0].sources.internal.branch, 'alpha');
    console.log('Local branch switch checks passed: target checkout, persisted profile, baseline preservation, dirty/missing branch guards, other-worktree guard, settings failure and retry after successful checkout.');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
