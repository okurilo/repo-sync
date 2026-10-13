const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const gitModule = require('../dist/main/main/infra/git.js');
const { EventEmitter } = require('node:events');
const { AppUpdater, sameUpdatePath, updateManifest, appInstallScript } = require('../dist/main/main/infra/appUpdate.js');

async function checkInstaller(failInstall) {
  const folders = new Map([['target', 'old'], ['incoming', 'new']]);
  const launched = [];
  let firstRename = true;
  const fakeFs = {
    writeFile: async () => {},
    rename: async (from, to) => {
      if (from === 'target' && firstRename) {
        firstRename = false;
        throw Object.assign(new Error('temporary lock'), { code: 'EBUSY' });
      }
      if (failInstall && from === 'incoming' && to === 'target') throw new Error('replacement failed');
      assert(folders.has(from) && !folders.has(to));
      folders.set(to, folders.get(from));
      folders.delete(from);
    },
  };
  const fakeProcesses = {
    spawn: executable => {
      launched.push(executable);
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  };
  await vm.runInNewContext(appInstallScript, {
    require: name => name === 'node:fs/promises' ? fakeFs : name === 'node:child_process' ? fakeProcesses : path,
    process: {
      argv: ['node', 'install.cjs', '99999', 'target', 'incoming', 'backup', 'report', 'RepoSync.exe'],
      platform: 'win32',
      kill: () => { throw Object.assign(new Error('exited'), { code: 'ESRCH' }); },
    },
    setTimeout: callback => setTimeout(callback, 0),
  });
  assert.equal(folders.get('target'), failInstall ? 'old' : 'new');
  assert.equal(launched[0], path.join('target', 'RepoSync.exe'));
  if (!failInstall) assert.equal(folders.get('backup'), 'old');
}

async function checkRevisionDetection(directory) {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;
  const source = path.join(directory, 'source'); const data = path.join(directory, 'data');
  const runGit = args => execFileSync('git', args, { cwd: source, stdio: 'pipe' }).toString().trim();
  const commit = () => { runGit(['add', '.']); runGit(['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'fixture']); };
  await fs.mkdir(source);
  runGit(['init', '-b', 'main']);
  await fs.copyFile(path.join(directory, 'package.json'), path.join(source, 'package.json'));
  await fs.writeFile(path.join(source, '.gitignore'), 'dist/\n'); commit();
  const installed = runGit(['rev-parse', 'HEAD']);
  await fs.mkdir(path.join(source, 'dist'));
  const revision = path.join(source, 'dist/app-revision.json');
  await fs.writeFile(revision, JSON.stringify({ schemaVersion: 1, commit: installed, branch: 'main' }));
  runGit(['update-ref', 'refs/remotes/origin/main', installed]);
  const actualGit = gitModule.git;
  let offline = false; let failClone = false;
  gitModule.git = async (cwd, args, ...rest) => {
    if (args[0] === 'remote' && args[1] === 'get-url') return Buffer.from('https://github.com/okurilo/repo-sync.git');
    if (args[0] === 'fetch') { if (offline) throw new Error('offline fixture'); return Buffer.alloc(0); }
    if (args[0] === 'clone') {
      if (failClone) { await fs.mkdir(args.at(-1)); throw new Error('interrupted clone'); }
      return actualGit(cwd, args.map(arg => arg === 'https://github.com/okurilo/repo-sync.git' ? source : arg), ...rest);
    }
    return actualGit(cwd, args, ...rest);
  };
  try {
    const updater = new AppUpdater(data, source, 'unused-target', () => assert.fail('Unexpected quit'));
    let state = await updater.inspect();
    assert.equal(state.installedCommit, installed);
    assert.equal(state.heads.main, installed);
    await assert.rejects(updater.update('main'), /нет доступного обновления/);
    await fs.writeFile(path.join(source, 'new.txt'), 'new'); commit();
    const latest = runGit(['rev-parse', 'HEAD']);
    await fs.writeFile(revision, JSON.stringify({ schemaVersion: 1, commit: latest, branch: 'main' }));
    state = await updater.inspect();
    assert.equal(state.installedCommit, installed);
    assert.equal(state.heads.main, installed); // changing checkout is not an installed update
    runGit(['update-ref', 'refs/remotes/origin/main', latest]);
    state = await updater.inspect();
    assert.notEqual(state.heads.main, state.installedCommit);
    offline = true; await assert.rejects(updater.inspect(), /offline/);
    assert.equal(updater.status().phase, 'error');
    assert.equal(updater.status().installedCommit, installed);
    offline = false;
    const managedData = path.join(directory, 'managed-data');
    const standalone = new AppUpdater(managedData, path.join(directory, 'installed-app'), 'unused-target', () => assert.fail('Unexpected quit'), revision);
    failClone = true; await assert.rejects(standalone.inspect(), /interrupted clone/);
    assert(!(await fs.readdir(managedData)).some(name => name.startsWith('app-source')));
    failClone = false; state = await standalone.inspect();
    assert.equal(state.root, await fs.realpath(path.join(managedData, 'app-source')));
    await fs.writeFile(path.join(managedData, 'app-update-source.txt'), path.join(directory, 'removed-source'));
    state = await new AppUpdater(managedData, path.join(directory, 'installed-app'), 'unused-target', () => assert.fail('Unexpected quit'), revision).inspect();
    assert.equal(state.root, await fs.realpath(path.join(managedData, 'app-source')));
    const rejected = path.join(directory, 'wrong-checkout'); await fs.mkdir(rejected); await fs.writeFile(path.join(rejected, 'preserve.txt'), 'user file');
    await fs.writeFile(path.join(managedData, 'app-update-source.txt'), rejected);
    state = await new AppUpdater(managedData, path.join(directory, 'installed-app'), 'unused-target', () => assert.fail('Unexpected quit'), revision).inspect();
    assert.equal(state.root, await fs.realpath(path.join(managedData, 'app-source')));
    assert.equal(await fs.readFile(path.join(rejected, 'preserve.txt'), 'utf8'), 'user file');
  } finally { gitModule.git = actualGit; }
}

async function checkScopedCancellation(directory) {
  if (process.platform === 'win32') return; // native process wrapper below uses a POSIX executable
  const bin = path.join(directory, 'bin'); await fs.mkdir(bin);
  const started = path.join(directory, 'started');
  await fs.writeFile(path.join(bin, 'git'), `#!${process.execPath}\nconst fs=require('fs');fs.appendFileSync(${JSON.stringify(started)},'started\\n');if(process.argv.includes('owned'))setInterval(()=>{},1000);else setTimeout(()=>{process.stdout.write('foreground completed')},250);`, { mode: 0o755 });
  const previousPath = process.env.PATH; process.env.PATH = bin + path.delimiter + previousPath;
  try {
    const updater = new AppUpdater(directory, directory, 'unused-target', () => assert.fail('Unexpected quit'));
    updater.root = directory; updater.state.phase = 'checking';
    const owned = updater.repo(['owned']); const cancelled = assert.rejects(owned, /отменено/); void cancelled.catch(() => {});
    const foreground = gitModule.git(directory, ['foreground'], undefined, undefined, 2000);
    for (let n = 0; ; n++) {
      try { if ((await fs.readFile(started, 'utf8')).split('started').length >= 3) break; } catch { /* both processes must start */ }
      assert(n < 100); await new Promise(resolve => setTimeout(resolve, 5));
    }
    updater.cancel(); await cancelled;
    assert.equal((await foreground).toString(), 'foreground completed');
  } finally { process.env.PATH = previousPath; }
}

(async () => {
  assert(sameUpdatePath('C:/Users/Oleg/repo-sync', 'c:\\Users\\oleg\\repo-sync', 'win32'));
  assert(!sameUpdatePath('C:/Users/Oleg/other', 'C:\\Users\\Oleg\\repo-sync', 'win32'));
  assert(!sameUpdatePath('/tmp/RepoSync', '/tmp/reposync', 'darwin'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reposync-update-check-'));
  try {
    const manifest = { name: 'reposync', build: { appId: 'local.reposync.desktop', productName: 'RepoSync' }, scripts: { 'dist:mac': 'electron-builder --mac', 'dist:win': 'electron-builder --win' } };
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    assert.equal((await updateManifest(root, 'darwin')).script, 'dist:mac');
    assert.equal((await updateManifest(root, 'win32')).script, 'dist:win');
    await checkRevisionDetection(root);
    await checkScopedCancellation(root);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ ...manifest, name: 'other' }));
    await assert.rejects(updateManifest(root, 'win32'), /исходников RepoSync/);
    await checkInstaller(false);
    await checkInstaller(true);
    console.log('App update checks passed: Windows paths, platform scripts, identity, locks, backup and rollback. Native apps were not launched.');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
