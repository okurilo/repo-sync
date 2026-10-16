import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, realpath } from 'node:fs/promises';
import { AppUpdater } from './infra/appUpdate';
import { Engine, parseIncomingSelection } from './engine';
import { SettingsStore, parseProfile, parseSource, parseRules, parseFilters } from './infra/settings';
import { localState, branchContext, listBranches, listCommits, refreshSource, safePath, stopGit, projectGitSummary } from './infra/git';
import { string } from './transport';
import type { Reply } from '../shared/types';

let window: BrowserWindow | null = null;
let busy = false;
const isDev = !app.isPackaged && process.env.REPOSYNC_DEV_URL === 'http://127.0.0.1:5173';
const rendererFile = path.join(__dirname, '../../renderer/index.html');
const MAX_FINDING_ID_LENGTH = 25;
function findingId(value: unknown): string { return string(value, MAX_FINDING_ID_LENGTH); }

function argsMode(value: unknown): 'internal' | 'global' { return value && typeof value === 'object' && 'kind' in value && value.kind === 'remote' ? 'global' : 'internal'; }
function direction(value: unknown): 'incoming' | 'outgoing' { if (value !== 'incoming' && value !== 'outgoing') throw new Error('Неизвестное направление'); return value; }
async function start(): Promise<void> {
  const store = new SettingsStore(app.getPath('userData'));
  await store.load();
  const engine = new Engine(store);
  await engine.recover();
  const target = app.isPackaged ? process.platform === 'win32' ? path.dirname(app.getPath('exe')) : path.resolve(app.getPath('exe'), '../../..') : process.platform === 'win32' ? path.join(app.getAppPath(), 'release', process.arch === 'x64' ? 'win-unpacked' : `win-${process.arch}-unpacked`) : path.join(app.getAppPath(), 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'RepoSync.app');
  const updater = new AppUpdater(app.getPath('userData'), app.isPackaged ? target : app.getAppPath(), target, () => app.quit(), path.join(app.getAppPath(), 'dist/app-revision.json'));
  app.on('before-quit', () => updater.cancel());
  ipcMain.handle('reposync', async (event, command: unknown, incoming: unknown): Promise<Reply<unknown>> => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: 'Запрос поступил из недопустимого источника.' };
    if (!Array.isArray(incoming) || incoming.length > (command === 'analyze' ? 4 : 3)) return { ok: false, error: 'Некорректный запрос к приложению.' };
    if (command === 'appUpdateStatus') return { ok: true, value: updater.status() };
    if (command === 'cancelAppUpdate') { updater.cancel(); return { ok: true, value: undefined }; }
    if (updater.status().phase === 'building' || updater.status().phase === 'restarting') return { ok: false, error: 'Дождитесь завершения обновления приложения.' };
    if (command === 'projectGit') {
      if (busy) return { ok: false, error: 'Дождитесь завершения текущей операции' };
      try { const profile = store.get().profiles.find(item => item.id === string(incoming[0], 36)); if (!profile) throw new Error('Профиль не найден'); return { ok: true, value: await projectGitSummary(profile, engine.cache) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Проверка не выполнена' }; }
    }
    if (command === 'refreshSource') {
      try {
        const mode = (argsMode(incoming[0]));
        const source = parseSource(incoming[0], mode);
        const value = await refreshSource(source, mode, engine.cache, () => window !== null && !window.isDestroyed() && true);
        engine.invalidateRemote(source.location, value.changedBranches); return { ok: true, value };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Фоновая проверка не выполнена' }; }
    }
    if (busy) return { ok: false, error: 'Дождитесь завершения текущей операции' };
    const args: unknown[] = incoming;
    busy = true;
    try {
      let value: unknown;
      switch (command) {
        case 'listBackups': value = await engine.listBackups(string(args[0], 36)); break;
        case 'prepareRestore': value = await engine.prepareRestore(string(args[0], 36), string(args[1], 36)); break;
        case 'applyRestore': value = await engine.applyRestore(string(args[0], 36)); break;
        case 'appUpdateInspect': value = await updater.inspect(); break;
        case 'appUpdate': await updater.update(string(args[0], 255)); value = undefined; break;
        case 'saveFilters': {
          const settings = store.get();
          if (args[0] !== null) { settings.globalExclusions = parseRules(args[0]); for (const profile of settings.profiles) profile.lastAction = { type: 'Общие фильтры', at: new Date().toISOString() }; }
          if (args[1] !== undefined) { const profile = settings.profiles.find(item => item.id === string(args[1], 36)); if (!profile) throw new Error('Профиль не найден'); profile.filters = parseFilters(args[2]); profile.lastAction = { type: 'Настройки фильтров', at: new Date().toISOString() }; }
          engine.invalidate(); value = await store.save(settings); break;
        }
        case 'refreshProject': {
          const profile = store.get().profiles.find(item => item.id === string(args[0], 36)); if (!profile) throw new Error('Профиль не найден');
          if (command === 'refreshProject') { if (!profile.sources.global) throw new Error('Внешний Git не настроен'); const refreshed = await refreshSource(profile.sources.global, 'global', engine.cache); engine.invalidateRemote(profile.sources.global.location, refreshed.changedBranches); await store.action(profile.id, 'Обновление внешнего Git'); }
          value = await projectGitSummary(profile, engine.cache); break;
        }
        case 'localState': value = await localState(parseSource(args[0], 'internal')); break;
        case 'switchLocalBranch': value = await engine.switchLocalBranch(string(args[0], 36)); break;
        case 'settings': value = store.get(); break;
        case 'saveProfile': {
          const settings = store.get();
          const id = string((args[0] as { id?: unknown })?.id, 36);
          const existing = settings.profiles.find(p => p.id === id);
          const profile = parseProfile(args[0], existing);
          if (existing?.pending) throw new Error('Сначала подтвердите применение созданного пакета или отмените ожидание.');
          if (existing) settings.profiles = settings.profiles.map(p => p.id === id ? profile : p);
          else { if (settings.profiles.length >= 100) throw new Error('Можно добавить не более 100 репозиториев.'); settings.profiles.push(profile); }
          profile.lastAction = { type: 'Настройки проекта', at: new Date().toISOString() }; engine.invalidate(); value = await store.save(settings); break;
        }
        case 'deleteProfile': {
          const settings = store.get();
          const id = string(args[0], 36);
          const confirmation = await dialog.showMessageBox(window, { type: 'warning', message: 'Удалить профиль синхронизации?',
            detail: 'Настройки синхронизации, общее состояние и ожидание подтверждения будут удалены. Файлы репозитория, пакеты и резервные копии останутся на компьютере.',
            buttons: ['Отмена', 'Удалить профиль'], defaultId: 0, cancelId: 0 });
          if (confirmation.response === 1) { settings.profiles = settings.profiles.filter(p => p.id !== id); engine.invalidate(); value = await store.save(settings); }
          else value = settings;
          break;
        }
        case 'chooseDirectory': {
          const result = await dialog.showOpenDialog(window, { title: 'Выбор папки', buttonLabel: 'Выбрать папку', properties: ['openDirectory'] }); value = result.canceled ? null : result.filePaths[0]; break;
        }
        case 'choosePackage': {
          const result = await dialog.showOpenDialog(window, { title: 'Выбор частей пакета', buttonLabel: 'Выбрать пакет', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Пакеты RepoSync', extensions: ['md'] }] }); value = result.canceled || !result.filePaths.length ? null : result.filePaths; break;
        }
        case 'setOutputDirectory': {
          const name = await realpath(string(args[0]));
          if (!(await lstat(name)).isDirectory()) throw new Error('Выберите папку для сохранения пакетов.');
          const settings = store.get(); settings.outputDirectory = name; for (const profile of settings.profiles) profile.lastAction = { type: 'Папка экспорта', at: new Date().toISOString() }; value = await store.save(settings); break;
        }
        case 'previewComparison': {
          const id = string((args[0] as { id?: unknown })?.id, 36);
          const profile = parseProfile(args[0], store.get().profiles.find(item => item.id === id));
          value = await engine.previewComparison(profile, direction(args[1])); break;
        }
        case 'previewCode': value = await engine.previewCode(string(args[0], 36), string(args[1])); break;
        case 'analyze': {
          value = await engine.analyze(string(args[0], 36), direction(args[1]), args[2] === undefined ? undefined : parseIncomingSelection(args[2]), args[3] as import('../shared/types').OutgoingSelection | undefined); break;
        }
        case 'branchContext': case 'listBranches': case 'listCommits': {
          const mode = argsMode(args[0]);
          const source = parseSource(args[0], mode);
          value = command === 'branchContext' ? await branchContext(source, mode, engine.cache) : command === 'listBranches' ? await listBranches(source, mode, engine.cache) : await listCommits(source, mode, engine.cache);
          break;
        }
        case 'exportPackage': {
          if (!Array.isArray(args[1]) || args[1].length > 10_000 || typeof args[2] !== 'boolean') throw new Error('Не удалось прочитать решения проверки данных. Повторите проверку.');
          value = await engine.exportPackage(string(args[0], 36), args[1].map(findingId), args[2]); break;
        }
        case 'confirmTransfer': value = await engine.confirmTransfer(string(args[0], 36)); break;
        case 'discardPending': value = await engine.discardPending(string(args[0], 36)); break;
        case 'excludeFinding': value = await engine.excludeFinding(string(args[0], 36), findingId(args[1])); break;
        case 'openFinding': {
          const { session, finding } = engine.finding(string(args[0], 36), findingId(args[1]));
          if (session.resolved.source.kind === 'local') {
            shell.showItemInFolder(await safePath(session.resolved.root, finding.public.path));
          } else {
            await shell.openExternal(engine.findingURL(string(args[0], 36), findingId(args[1])));
          }
          value = undefined; break;
        }
        case 'previewReplacement': value = await engine.previewReplacement(string(args[0], 36), findingId(args[1])); break;
        case 'applyReplacement': await engine.applyReplacement(string(args[0], 36)); value = undefined; break;
        case 'loadPackage': {
          const files = args[0];
          if (Array.isArray(files) && (!files.length || files.length > 10_000)) throw new Error('Выберите от 1 до 10 000 частей одного пакета.');
          value = await engine.loadPackage(Array.isArray(files) ? files.map(file => string(file)) : string(files), string(args[1], 36)); break;
        }
        case 'selectExport': case 'preparePackage':
        case 'prepareIncoming': {
          const paths = args[1];
          if (paths !== undefined && (!Array.isArray(paths) || paths.length > 100_000)) throw new Error('Не удалось прочитать выбранные файлы. Обновите сравнение.');
          const selected = paths === undefined ? undefined : paths.map(item => string(item));
          if (args[2] !== undefined && (!Array.isArray(args[2]) || args[2].length > (command === 'selectExport' ? 10_000 : 100_000))) throw new Error('Некорректные решения проверки.');
          const redacted = args[2] === undefined ? [] : (args[2] as unknown[]).map(item => command === 'selectExport' ? findingId(item) : string(item, 4096));
          value = command === 'selectExport' ? await engine.selectExport(string(args[0], 36), selected, redacted) : command === 'preparePackage' ? await engine.preparePackage(string(args[0], 36), selected, redacted) : await engine.prepareIncoming(string(args[0], 36), selected, redacted);
          break;
        }
        case 'openRepository': { const profile = store.get().profiles.find(p => p.id === string(args[0], 36)); if (!profile?.sources.internal) throw new Error('Укажите локальный репозиторий в настройках.'); const error = await shell.openPath(await realpath(profile.sources.internal.location)); if (error) throw new Error('Не удалось открыть папку репозитория. Проверьте путь в настройках.'); value = undefined; break; }
        case 'preflight': value = await engine.preflight(string(args[0]), string(args[1]), string(args[2], 36)); break;
        case 'applyImport': value = await engine.applyImport(string(args[0], 36), args[1] === true); break;
        default: throw new Error('Запрошенная команда недоступна.');
      }
      return { ok: true, value };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Операция не выполнена';
      // Системные ошибки могут включать содержимое JSON / Git: выводим только известные сообщения.
      const safe = error instanceof SyntaxError ? 'Не удалось прочитать JSON: пакет или настройки повреждены.' : message;
      return { ok: false, error: safe, path: error instanceof Error && 'syncPath' in error && typeof error.syncPath === 'string' ? error.syncPath : undefined };
    } finally { busy = false; }
  });
  const createWindow = (): void => {
    window = new BrowserWindow({ width: 1220, height: 840, minWidth: 900, minHeight: 640, title: 'RepoSync', backgroundColor: '#f6f7fb',
      webPreferences: { preload: path.join(__dirname, '../preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url;
      let localFile = false;
      if (url.startsWith('file://')) {
        try {
          const relative = path.relative(path.dirname(rendererFile), fileURLToPath(url));
          localFile = !relative.startsWith('..') && !path.isAbsolute(relative);
        } catch { localFile = false; }
      }
      const allowed = localFile || (isDev && (url.startsWith('http://127.0.0.1:5173/') || url.startsWith('ws://127.0.0.1:5173/')));
      callback({ cancel: !allowed });
    });
    if (isDev) void window.loadURL('http://127.0.0.1:5173');
    else void window.loadFile(rendererFile);
    window.on('closed', () => { window = null; updater.cancel(); stopGit(); });
  };
  createWindow();
  void updater.inspect().catch(() => { /* startup check is reported only in settings */ });
  app.on('activate', () => { if (!window) createWindow(); });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('before-quit', stopGit);
  process.on('SIGINT', () => app.quit());
  process.on('SIGTERM', () => app.quit());
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('RepoSync: запуск остановлен', 'Не удалось прочитать настройки или завершить восстановление. Проверьте папку данных RepoSync. Сохраните settings.json, журнал восстановления и резервные копии для ручного восстановления.');
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
