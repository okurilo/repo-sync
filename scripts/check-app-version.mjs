import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeAppRevision } from './app-revision.mjs';

const source = process.cwd();
const root = await mkdtemp(path.join(tmpdir(), 'reposync-version-'));
try {
  process.chdir(root);
  const manifest = JSON.stringify({ version: '1.0.1' });
  await writeFile('package.json', manifest);
  await writeAppRevision();
  const revision = async () => JSON.parse(await readFile('dist/app-revision.json', 'utf8'));
  assert.deepEqual(await revision(), { schemaVersion: 2, version: '1.0.1', commit: null, branch: null });
  const git = args => execFileSync('git', args, { stdio: 'pipe' }).toString().trim();
  git(['init', '-b', 'main']);
  await writeFile('.gitignore', 'dist/\n');
  git(['add', '.']); git(['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'fixture']);
  const commit = git(['rev-parse', 'HEAD']);
  for (const branch of ['main', 'feature/windows-update']) {
    if (branch !== 'main') git(['switch', '-c', branch]);
    await writeAppRevision();
    assert.deepEqual(await revision(), { schemaVersion: 2, version: '1.0.1', commit, branch });
  }
  git(['switch', '--detach']); await writeAppRevision();
  assert.equal((await revision()).branch, null);
  assert.equal(await readFile('package.json', 'utf8'), manifest);
  const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(source, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, lock.version); assert.equal(pkg.version, lock.packages[''].version);
  for (const group of ['dependencies', 'devDependencies']) {
    assert.deepEqual(pkg[group], lock.packages[''][group]);
    for (const [name, version] of Object.entries(pkg[group])) {
      assert.match(version, /^\d+\.\d+\.\d+$/);
      assert.equal(lock.packages['node_modules/' + name].version, version);
    }
  }
  assert.deepEqual(pkg.overrides, { postcss: { '.': '8.5.28', nanoid: '3.3.19' }, 'node-abi': '4.35.0', minimatch: { 'brace-expansion': '5.0.9' }, electron: { '@types/node': '24.19.0' } });
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name.endsWith('/postcss')) assert.equal(entry.version, '8.5.28');
    if (name.endsWith('/node-abi')) assert.equal(entry.version, '4.35.0');
    if (name.endsWith('/node_modules/brace-expansion')) assert.equal(entry.version, '5.0.9');
  }
  assert.equal(lock.packages['node_modules/postcss/node_modules/nanoid'].version, '3.3.19');
  assert.equal(lock.packages['node_modules/electron/node_modules/@types/node'].version, '24.19.0');
  console.log('Version checks passed: main, branch, detached, archive, unchanged manifest and exact dependency lock.');
} finally { process.chdir(source); await rm(root, { recursive: true, force: true }); }
