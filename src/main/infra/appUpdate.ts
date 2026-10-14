import { execFile, spawn } from 'node:child_process';
import { access, constants, readFileSync } from 'node:fs';
import { copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppUpdateState } from '../../shared/types';
import { git } from './git';
import { object, string } from '../transport';

export const sameUpdatePath = (left: string, right: string, platform: NodeJS.Platform = process.platform): boolean => platform === 'win32' ? path.win32.resolve(left).toLowerCase() === path.win32.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right);
async function executable(filename: string): Promise<boolean> { return new Promise(resolve => access(filename, constants.X_OK, error => resolve(!error))); }
async function readable(filename: string): Promise<boolean> { return new Promise(resolve => access(filename, constants.R_OK, error => resolve(!error))); }
export async function updateTools(signal?: AbortSignal): Promise<{ node: string; npm: string; env: NodeJS.ProcessEnv }> {
  if (signal?.aborted) throw new Error('Обновление отменено. Текущая версия продолжает работать.');
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', path.join(homedir(), '.volta/bin'), path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'), process.env.NVM_SYMLINK ?? ''];
  const versions = path.join(process.env.NVM_DIR || path.join(homedir(), '.nvm'), 'versions/node');
  try { for (const version of (await readdir(versions)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) dirs.push(path.join(versions, version, 'bin')); } catch { /* nvm is optional */ }
  const pair = async (node: string, npm: string, shellEnv: NodeJS.ProcessEnv = {}): Promise<{ node: string; npm: string; env: NodeJS.ProcessEnv } | undefined> => {
    if (!path.isAbsolute(node) || !path.isAbsolute(npm) || !await executable(node) || !await readable(npm)) return undefined;
    try {
      const resolvedNode = await realpath(node); const resolvedNpm = await realpath(npm);
      const env: NodeJS.ProcessEnv = { ...process.env, ...shellEnv, npm_config_arch: process.arch, npm_config_platform: process.platform };
      for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
      env.PATH = [...new Set([path.dirname(node), path.dirname(resolvedNode), ...(shellEnv.PATH ?? '').split(path.delimiter).filter(Boolean), ...dirs.filter(Boolean)])].join(path.delimiter);
      return { node: resolvedNode, npm: resolvedNpm, env };
    } catch { return undefined; }
  };
  for (const dir of dirs.filter(Boolean)) {
    const node = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node'); const npm = process.platform === 'win32' ? path.join(dir, 'node_modules/npm/bin/npm-cli.js') : path.join(dir, 'npm');
    const tools = await pair(node, npm); if (tools) return tools;
  }
  if (process.platform === 'darwin') {
    const shells = [...new Set([process.env.SHELL, '/bin/zsh', '/bin/bash'].filter((value): value is string => !!value && path.isAbsolute(value)))];
    const command = `node -p 'JSON.stringify({node:process.execPath,PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:process.env.NODE_EXTRA_CA_CERTS,NODE_TLS_REJECT_UNAUTHORIZED:process.env.NODE_TLS_REJECT_UNAUTHORIZED})'; command -v npm`;
    for (const shell of shells) {
      if (signal?.aborted) throw new Error('Обновление отменено. Текущая версия продолжает работать.');
      const output = await new Promise<string>(resolve => execFile(shell, ['-ilc', command], { timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 8192, signal }, (error, stdout) => resolve(error ? '' : stdout)));
      if (signal?.aborted) throw new Error('Обновление отменено. Текущая версия продолжает работать.');
      const lines = output.split(/\r?\n/).map(value => value.trim());
      const npm = lines.find(value => path.isAbsolute(value) && path.basename(value) === 'npm');
      for (const line of lines.filter(value => value.startsWith('{'))) {
        try {
          const data = object(JSON.parse(line)); if (typeof data.node !== 'string' || typeof data.PATH !== 'string' || !npm) continue;
          const shellEnv: NodeJS.ProcessEnv = { PATH: data.PATH };
          if (typeof data.NODE_EXTRA_CA_CERTS === 'string' && path.isAbsolute(data.NODE_EXTRA_CA_CERTS)) shellEnv.NODE_EXTRA_CA_CERTS = data.NODE_EXTRA_CA_CERTS;
          if (data.NODE_TLS_REJECT_UNAUTHORIZED === '1') shellEnv.NODE_TLS_REJECT_UNAUTHORIZED = '1';
          const tools = await pair(data.node, npm, shellEnv); if (tools) return tools;
        } catch { /* Шум или неподходящие пути shell не дают рабочую пару. */ }
      }
    }
    if (signal?.aborted) throw new Error('Обновление отменено. Текущая версия продолжает работать.');
  }
  throw new Error('RepoSync не удалось найти Node.js или npm для сборки. Если они установлены, закройте приложение и запустите его из терминала, где работают node и npm.');
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
  private abort = new AbortController();
  private stopProcess: (() => void) | undefined;
  private state: AppUpdateState = { root: '', branch: '', branches: [], phase: 'idle', message: '', command: '' };
  constructor(private readonly data: string, private readonly appPath: string, private readonly target: string, private readonly quit: () => void, revisionFile = path.join(appPath, 'dist/app-revision.json')) {
    try {
      const revision = object(JSON.parse(readFileSync(revisionFile, 'utf8')));
      if (revision.schemaVersion === 1 || revision.schemaVersion === 2) {
        if (typeof revision.commit === 'string' && /^[a-f0-9]{40,64}$/.test(revision.commit)) this.state.installedCommit = revision.commit;
        if (typeof revision.branch === 'string') this.state.installedBranch = revision.branch;
        if (revision.schemaVersion === 2 && typeof revision.version === 'string' && /^\d+\.\d+\.\d+$/.test(revision.version)) this.state.installedVersion = revision.version;
      }
    } catch { /* Старые сборки могут не содержать метаданных. */ }
    if (!this.state.installedVersion) {
      try { const manifest = object(JSON.parse(readFileSync(path.join(path.dirname(revisionFile), '../package.json'), 'utf8'))); if (typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version)) this.state.installedVersion = manifest.version; } catch { /* Не подменять неизвестную версию данными исходников. */ }
    }
  }
  status(): AppUpdateState { return { ...this.state, heads: this.state.heads ? { ...this.state.heads } : undefined, branches: [...this.state.branches] }; }
  cancel(): void { if (this.state.phase !== 'checking' && this.state.phase !== 'building') return; this.stopping = true; this.stopProcess?.(); this.abort.abort(); }
  private check(): void { if (this.stopping) throw new Error('Обновление отменено. Текущая версия продолжает работать.'); }
  private async repo(args: string[], allowedFailureCode?: number, timeoutMs?: number): Promise<Buffer> { this.check(); try { const value = await git(this.root, args, undefined, allowedFailureCode, timeoutMs, this.abort.signal); this.check(); return value; } catch (error) { this.check(); throw error; } }
  private async command(file: string, args: string[], env: NodeJS.ProcessEnv, label: string, timeout = 1_800_000): Promise<void> {
    this.check(); this.state.message = label;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, args, { cwd: this.root, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let tail = '';
      const output = (chunk: string): void => { tail = (tail + chunk).slice(-4000); };
      child.stdout?.setEncoding('utf8').on('data', output); child.stderr?.setEncoding('utf8').on('data', output);
      let reason = '';
      const stop = (): void => { if (child.pid) { if (process.platform === 'win32') { const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); killer.on('error', () => child.kill('SIGKILL')); } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } } } };
      this.stopProcess = stop;
      const timer = setTimeout(() => { reason = `${label}: превышено время ожидания. Повторите обновление.`; stop(); }, timeout);
      child.on('error', () => { clearTimeout(timer); this.stopProcess = undefined; reject(new Error(`${label}: не удалось запустить процесс.`)); });
      child.on('close', code => { clearTimeout(timer); this.stopProcess = undefined; code === 0 && !this.stopping ? resolve() : reject(new Error(this.stopping ? 'Обновление отменено. Текущая версия продолжает работать.' : reason || `${label}: процесс завершился с кодом ${code}. Текущая версия сохранена.${tail.trim() ? `\n${tail.trim()}` : ''}`)); });
    });
  }
  private async candidate(directory: string): Promise<string | undefined> {
    this.check();
    try {
      const root = await realpath(directory); await updateManifest(root);
      const top = (await git(root, ['rev-parse', '--show-toplevel'], undefined, undefined, 15_000, this.abort.signal)).toString().trim();
      const origin = (await git(root, ['remote', 'get-url', 'origin'], undefined, undefined, 15_000, this.abort.signal)).toString().trim();
      this.check();
      if (sameUpdatePath(top, root) && /^(?:https:\/\/github\.com\/|git@github\.com:)okurilo\/repo-sync(?:\.git)?$/.test(origin)) return root;
    } catch { this.check(); }
    return undefined;
  }
  async inspect(): Promise<AppUpdateState> {
    if (this.state.phase === 'building' || this.state.phase === 'checking') throw new Error('Дождитесь завершения обновления.');
    this.stopping = false; this.abort = new AbortController(); this.state.phase = 'checking'; this.state.message = 'Проверка обновления…'; this.state.error = undefined;
    try {
      if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('Сборка и автоматический перезапуск доступны на macOS и Windows.');
      if (!this.root) { try { this.root = await readFile(path.join(this.data, 'app-update-source.txt'), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      if (this.root) this.root = await this.candidate(this.root) ?? '';
      if (!this.root) {
        let dir = this.appPath;
        for (let n = 0; n < 9; n++, dir = path.dirname(dir)) {
          const candidate = await this.candidate(dir); if (candidate) { this.root = candidate; break; }
        }
      }
      if (!this.root) {
        await mkdir(this.data, { recursive: true }); let managed = path.join(this.data, 'app-source');
        const candidate = await this.candidate(managed);
        if (candidate) this.root = candidate;
        else {
          try { await lstat(managed); managed = `${managed}-${randomUUID()}`; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          const temporary = `${managed}.${randomUUID()}.tmp`;
          try { await git(this.data, ['clone', '--', 'https://github.com/okurilo/repo-sync.git', temporary], undefined, undefined, 15_000, this.abort.signal); this.check(); await rename(temporary, managed); } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 }); }
          this.root = await realpath(managed);
        }
      }
      await updateManifest(this.root);
      if (!sameUpdatePath(await realpath(this.root), this.root)) throw new Error('Папка исходников изменилась. Выберите её заново.');
      if (!sameUpdatePath((await this.repo(['rev-parse', '--show-toplevel'])).toString().trim(), this.root)) throw new Error('Выберите корень Git-репозитория RepoSync.');
      const origin = (await this.repo(['remote', 'get-url', 'origin'])).toString().trim();
      if (!/^(?:https:\/\/github\.com\/|git@github\.com:)okurilo\/repo-sync(?:\.git)?$/.test(origin)) throw new Error('Origin должен указывать на github.com/okurilo/repo-sync.');
      await this.repo(['fetch', '--prune', 'origin'], undefined, 15_000); this.check();
      const heads: Record<string, string> = Object.fromEntries((await this.repo(['for-each-ref', '--format=%(refname:strip=3)%09%(objectname)', 'refs/remotes/origin/'])).toString().trim().split('\n').map(line => line.split('\t')).filter(([branch, head]) => branch && branch !== 'HEAD' && head)); const refs = Object.keys(heads);
      this.state = { installedVersion: this.state.installedVersion, installedCommit: this.state.installedCommit, installedBranch: this.state.installedBranch, heads, checkedAt: new Date().toISOString(), root: this.root, branch: (await this.repo(['symbolic-ref', '--short', '-q', 'HEAD'], 1)).toString().trim(), branches: refs, phase: 'idle', message: '', command: `npm run ${(await updateManifest(this.root)).script}` };
      await mkdir(this.data, { recursive: true }); await writeFile(path.join(this.data, 'app-update-source.txt'), this.root, { mode: 0o600 });
      return this.status();
    } catch (error) { this.state.phase = 'error'; this.state.error = error instanceof Error ? error.message : 'Не удалось проверить обновление.'; this.state.root = this.root; throw error; }
  }
  async update(branch: string): Promise<void> {
    if (this.state.phase !== 'idle' || !this.state.branches.includes(branch)) throw new Error('Проверьте обновление и выберите ветку.');
    if (!this.state.installedCommit || !this.state.heads?.[branch] || this.state.heads[branch] === this.state.installedCommit) throw new Error('Для выбранной ветки нет доступного обновления.');
    this.stopping = false; this.abort = new AbortController(); this.state.phase = 'building'; this.state.error = undefined;
    try {
      this.state.message = 'Проверка исходников…';
      if (!sameUpdatePath(await realpath(this.root), this.root)) throw new Error('Папка исходников изменилась. Выберите её заново.');
      const origin = (await this.repo(['remote', 'get-url', 'origin'])).toString().trim();
      if (!/^(?:https:\/\/github\.com\/|git@github\.com:)okurilo\/repo-sync(?:\.git)?$/.test(origin)) throw new Error('Origin RepoSync изменился. Проверьте обновление ещё раз.');
      await this.repo(['check-ref-format', '--branch', branch]);
      if ((await this.repo(['status', '--porcelain', '--untracked-files=no'])).length) throw new Error('В исходниках RepoSync есть незакоммиченные изменения. Сохраните их перед обновлением.');
      const gitDir = (await this.repo(['rev-parse', '--absolute-git-dir'])).toString().trim();
      for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer']) { try { await lstat(path.join(gitDir, marker)); throw new Error('Завершите текущую операцию Git перед обновлением.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      const tools = await updateTools(this.abort.signal); this.check();
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
      await this.command(tools.node, [path.join(this.root, 'node_modules/electron/install.js')], tools.env, 'Подготовка Electron…');
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
