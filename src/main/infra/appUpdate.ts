import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs';
import { copyFile, cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppUpdateState } from '../../shared/types';
import { git, stopGit } from './git';
import { object, string } from '../transport';

export const sameUpdatePath = (left: string, right: string, platform: NodeJS.Platform = process.platform): boolean => platform === 'win32' ? path.win32.resolve(left).toLowerCase() === path.win32.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right);
async function executable(filename: string): Promise<boolean> { return new Promise(resolve => access(filename, constants.X_OK, error => resolve(!error))); }
export async function updateTools(): Promise<{ node: string; npm: string; env: NodeJS.ProcessEnv }> {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', path.join(homedir(), '.volta/bin'), path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'), process.env.NVM_SYMLINK ?? ''];
  const versions = path.join(homedir(), '.nvm/versions/node');
  try { for (const version of (await readdir(versions)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) dirs.push(path.join(versions, version, 'bin')); } catch { /* nvm is optional */ }
  for (const dir of dirs.filter(Boolean)) {
    const node = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node'); const npm = process.platform === 'win32' ? path.join(dir, 'node_modules/npm/bin/npm-cli.js') : path.join(dir, 'npm');
    if (await executable(node) && await executable(npm)) { const env: NodeJS.ProcessEnv = { ...process.env, npm_config_arch: process.arch, npm_config_platform: process.platform }; for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]; env.PATH = [...new Set([dir, ...dirs])].join(path.delimiter); return { node: await realpath(node), npm: await realpath(npm), env }; }
  }
  throw new Error('Для сборки нужны Node.js и npm. Установите Node.js, затем повторите обновление.');
}
export async function updateManifest(root: string, platform: NodeJS.Platform = process.platform): Promise<{ script: string; product: string }> {
  const raw = object(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')));
  const build = object(raw.build); const scripts = object(raw.scripts);
  if (raw.name !== 'reposync' || build.appId !== 'local.reposync.desktop') throw new Error('Выберите папку исходников RepoSync, а не переносимый проект.');
  const script = [platform === 'win32' ? 'dist:win' : 'dist:mac', 'dist'].find(name => typeof scripts[name] === 'string' && /\belectron-builder\b/.test(String(scripts[name])));
  if (!script) throw new Error('В этой ветке нет сценария сборки приложения для этой ОС в package.json.');
  return { script, product: string(build.productName, 100) };
}
export const appInstallScript = `
const fs=require('node:fs/promises'),cp=require('node:child_process');
const [pid,target,incoming,backup,report,executable]=process.argv.slice(2);
const alive=()=>{try{process.kill(Number(pid),0);return true}catch(e){return e.code!=='ESRCH'}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const rename=async(from,to)=>{for(let n=0;;n++){try{return await fs.rename(from,to)}catch(e){if(n>=49||!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;await wait(100)}}};
const open=filename=>process.platform==='win32'?new Promise((resolve,reject)=>{const child=cp.spawn(require('node:path').join(filename,executable),[],{detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve()})}):new Promise((resolve,reject)=>cp.execFile('/usr/bin/open',['-n',filename],e=>e?reject(e):resolve()));
(async()=>{
  await fs.writeFile(report+'.ready','ready');
  for(let n=0;alive();n++){if(n>=600)throw Error('Приложение не завершилось.');await wait(100)}
  let moved=false;
  try{await rename(target,backup);moved=true;await rename(incoming,target);await open(target);await fs.writeFile(report,'Обновление установлено.');}
  catch(e){if(moved){try{await rename(target,incoming)}catch{}await rename(backup,target)}await open(target);throw e;}
})().catch(async()=>{await fs.writeFile(report,'Не удалось установить обновление. Предыдущая версия сохранена.');process.exitCode=1});
`;
export class AppUpdater {
  private root = '';
  private stopping = false;
  private stopProcess: (() => void) | undefined;
  private state: AppUpdateState = { root: '', branch: '', branches: [], phase: 'idle', message: '', command: '' };
  constructor(private readonly data: string, private readonly appPath: string, private readonly target: string, private readonly quit: () => void) {}
  status(): AppUpdateState { return { ...this.state, branches: [...this.state.branches] }; }
  cancel(): void { if (this.state.phase !== 'checking' && this.state.phase !== 'building') return; this.stopping = true; this.stopProcess?.(); stopGit(); }
  private check(): void { if (this.stopping) throw new Error('Обновление отменено. Текущая версия продолжает работать.'); }
  private async repo(args: string[], allowedFailureCode?: number): Promise<Buffer> { this.check(); const value = await git(this.root, args, undefined, allowedFailureCode); this.check(); return value; }
  private async command(file: string, args: string[], env: NodeJS.ProcessEnv, label: string, timeout = 1_800_000): Promise<void> {
    this.check(); this.state.message = label;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, args, { cwd: this.root, env, shell: false, detached: true, stdio: 'ignore' });
      let reason = '';
      const stop = (): void => { if (child.pid) { if (process.platform === 'win32') { const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); killer.on('error', () => child.kill('SIGKILL')); } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } } } };
      this.stopProcess = stop;
      const timer = setTimeout(() => { reason = `${label}: превышено время ожидания. Повторите обновление.`; stop(); }, timeout);
      child.on('error', () => { clearTimeout(timer); this.stopProcess = undefined; reject(new Error(`${label}: не удалось запустить процесс.`)); });
      child.on('close', code => { clearTimeout(timer); this.stopProcess = undefined; code === 0 && !this.stopping ? resolve() : reject(new Error(this.stopping ? 'Обновление отменено. Текущая версия продолжает работать.' : reason || `${label}: процесс завершился с кодом ${code}. Текущая версия сохранена; повторите обновление после проверки подключения и инструментов сборки.`)); });
    });
  }
  async inspect(selectedRoot?: string): Promise<AppUpdateState> {
    if (this.state.phase === 'building' || this.state.phase === 'checking') throw new Error('Дождитесь завершения обновления.');
    this.stopping = false; this.state.phase = 'checking'; this.state.message = 'Получение веток RepoSync…'; this.state.error = undefined;
    try {
      if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('Сборка и автоматический перезапуск доступны на macOS и Windows.');
      if (selectedRoot) { if (!path.isAbsolute(selectedRoot)) throw new Error('Выберите абсолютный путь исходников.'); this.root = await realpath(selectedRoot); }
      if (!this.root) { try { this.root = await readFile(path.join(this.data, 'app-update-source.txt'), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      if (!this.root) {
        let dir = this.appPath;
        for (let n = 0; n < 9; n++, dir = path.dirname(dir)) {
          try { await updateManifest(dir); await lstat(path.join(dir, '.git')); this.root = await realpath(dir); break; } catch { /* try the enclosing source directory */ }
        }
      }
      if (!this.root) throw new Error('Не найдены исходники. Выберите папку Git-репозитория RepoSync.');
      await updateManifest(this.root);
      if (!sameUpdatePath(await realpath(this.root), this.root)) throw new Error('Папка исходников изменилась. Выберите её заново.');
      if (!sameUpdatePath((await this.repo(['rev-parse', '--show-toplevel'])).toString().trim(), this.root)) throw new Error('Выберите корень Git-репозитория RepoSync.');
      const origin = (await this.repo(['remote', 'get-url', 'origin'])).toString().trim();
      if (!/^(?:https:\/\/github\.com\/|git@github\.com:)okurilo\/repo-sync(?:\.git)?$/.test(origin)) throw new Error('Origin должен указывать на github.com/okurilo/repo-sync.');
      await this.repo(['fetch', '--prune', 'origin']); this.check();
      const refs = (await this.repo(['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/'])).toString().trim().split('\n').filter(branch => branch && branch !== 'HEAD');
      this.state = { root: this.root, branch: (await this.repo(['symbolic-ref', '--short', '-q', 'HEAD'], 1)).toString().trim(), branches: refs, phase: 'idle', message: '', command: `npm run ${(await updateManifest(this.root)).script}` };
      await mkdir(this.data, { recursive: true }); await writeFile(path.join(this.data, 'app-update-source.txt'), this.root, { mode: 0o600 });
      return this.status();
    } catch (error) { this.state.phase = 'error'; this.state.error = error instanceof Error ? error.message : 'Не удалось получить ветки.'; this.state.root = this.root; throw error; }
  }
  async update(branch: string): Promise<void> {
    if (this.state.phase !== 'idle' || !this.state.branches.includes(branch)) throw new Error('Получите список веток и выберите ветку обновления.');
    this.stopping = false; this.state.phase = 'building'; this.state.error = undefined;
    try {
      this.state.message = 'Проверка исходников…';
      if (!sameUpdatePath(await realpath(this.root), this.root)) throw new Error('Папка исходников изменилась. Выберите её заново.');
      const origin = (await this.repo(['remote', 'get-url', 'origin'])).toString().trim();
      if (!/^(?:https:\/\/github\.com\/|git@github\.com:)okurilo\/repo-sync(?:\.git)?$/.test(origin)) throw new Error('Origin RepoSync изменился. Получите ветки заново.');
      await this.repo(['check-ref-format', '--branch', branch]);
      if ((await this.repo(['status', '--porcelain', '--untracked-files=no'])).length) throw new Error('В исходниках RepoSync есть незакоммиченные изменения. Сохраните их перед обновлением.');
      const gitDir = (await this.repo(['rev-parse', '--absolute-git-dir'])).toString().trim();
      for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer']) { try { await lstat(path.join(gitDir, marker)); throw new Error('Завершите текущую операцию Git перед обновлением.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      const tools = await updateTools(); this.check();
      this.state.message = 'Переключение ветки и pull…';
      const existing = (await this.repo(['branch', '--list', '--format=%(refname:short)', branch])).length;
      await this.repo(existing ? ['switch', '--', branch] : ['switch', '--track', '-c', branch, `origin/${branch}`]); this.check();
      this.state.branch = branch; await this.repo(['pull', '--ff-only', '--no-rebase', '--no-autostash', 'origin', branch]); this.check();
      const manifest = await updateManifest(this.root);
      if (manifest.product !== 'RepoSync') throw new Error('Сборка должна создавать приложение RepoSync.');
      await lstat(path.join(this.root, 'package-lock.json'));
      const output = path.join(this.data, `app-build-${randomUUID()}`); await mkdir(output, { recursive: true });
      this.state.command = `npm run ${manifest.script}`;
      await this.command(tools.node, [tools.npm, 'ci'], tools.env, 'Установка зависимостей…');
      await this.command(tools.node, [tools.npm, 'run', manifest.script, '--', process.platform === 'win32' ? '--win' : '--mac', `--${process.arch}`, `--config.directories.output=${output}`, `--config.electronDist=${path.join(this.root, 'node_modules/electron/dist')}`], tools.env, 'Сборка новой версии…');
      this.check();
      const built = process.platform === 'win32' ? path.join(output, process.arch === 'x64' ? 'win-unpacked' : `win-${process.arch}-unpacked`) : path.join(output, `mac${process.arch === 'arm64' ? '-arm64' : ''}`, 'RepoSync.app');
      const executableName = process.platform === 'win32' ? 'RepoSync.exe' : 'Contents/MacOS/RepoSync';
      await lstat(path.join(built, executableName));
      if ((await lstat(this.target)).isSymbolicLink() || !await executable(path.join(this.target, executableName))) throw new Error('Не удалось определить установленное приложение для замены.');
      const incoming = `${this.target}.incoming-${randomUUID()}`; const backup = `${this.target}.previous-${randomUUID()}`;
      this.state.message = 'Подготовка перезапуска…';
      if (process.platform === 'win32') { await cp(built, incoming, { recursive: true, errorOnExist: true, force: false }); try { await copyFile(path.join(this.target, 'Uninstall RepoSync.exe'), path.join(incoming, 'Uninstall RepoSync.exe')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      else await this.command('/usr/bin/ditto', [built, incoming], tools.env, 'Подготовка перезапуска…'); this.check();
      const job = path.join(output, 'install.cjs'); const report = path.join(output, 'install-result.txt'); await writeFile(job, appInstallScript, { mode: 0o600 });
      const child = spawn(tools.node, [job, String(process.pid), this.target, incoming, backup, report, executableName], { detached: true, stdio: 'ignore', env: tools.env });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('Не удалось запустить установку; текущая версия сохранена.'))); }); child.unref();
      this.stopProcess = () => { child.kill('SIGKILL'); };
      for (let n = 0; n < 50; n++) { try { await lstat(`${report}.ready`); break; } catch { if (n === 49) throw new Error('Установщик не готов. Текущая версия сохранена.'); await new Promise(resolve => setTimeout(resolve, 100)); } }
      this.check(); this.stopProcess = undefined;
      this.state.phase = 'restarting'; this.state.message = 'Перезапуск RepoSync…'; this.quit();
    } catch (error) { this.stopProcess?.(); this.stopProcess = undefined; this.state.phase = 'error'; this.state.error = error instanceof Error ? error.message : 'Обновление не завершено.'; throw error; }
  }
}
