const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { sameUpdatePath, updateManifest, appInstallScript } = require('../dist/main/main/infra/appUpdate.js');

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
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ ...manifest, name: 'other' }));
    await assert.rejects(updateManifest(root, 'win32'), /исходников RepoSync/);
    await checkInstaller(false);
    await checkInstaller(true);
    console.log('App update checks passed: Windows paths, platform scripts, identity, locks, backup and rollback. Native apps were not launched.');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
