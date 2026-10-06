import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, realpath } from 'node:fs/promises';
import { Engine } from './engine';
import { SettingsStore, parseProfile, parseSource } from './infra/settings';
import { listBranches, listCommits, refreshSource, safePath, stopGit } from './infra/git';
import { string } from './transport';
import type { Reply } from '../shared/types';

let window: BrowserWindow | null = null;
let busy = false;
const isDev = !app.isPackaged && process.env.REPOSYNC_DEV_URL === 'http://127.0.0.1:5173';
const rendererFile = path.join(__dirname, '../../renderer/index.html');

function argsMode(value: unknown): 'internal' | 'global' { return value && typeof value === 'object' && 'kind' in value && value.kind === 'remote' ? 'global' : 'internal'; }
function direction(value: unknown): 'incoming' | 'outgoing' { if (value !== 'incoming' && value !== 'outgoing') throw new Error('Неизвестное направление'); return value; }
async function start(): Promise<void> {
  const store = new SettingsStore(app.getPath('userData'));
  await store.load();
  const engine = new Engine(store);
  await engine.recover();
  ipcMain.handle('reposync', async (event, command: unknown, incoming: unknown): Promise<Reply<unknown>> => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: 'Запрос поступил из недопустимого источника.' };
    if (!Array.isArray(incoming) || incoming.length > 3) return { ok: false, error: 'Некорректный запрос к приложению.' };
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
        case 'settings': value = store.get(); break;
        case 'saveProfile': {
          const settings = store.get();
          const id = string((args[0] as { id?: unknown })?.id, 36);
          const existing = settings.profiles.find(p => p.id === id);
          const profile = parseProfile(args[0], existing);
          if (existing?.pending) throw new Error('Сначала подтвердите применение созданного пакета или отмените ожидание.');
          if (existing) settings.profiles = settings.profiles.map(p => p.id === id ? profile : p);
          else { if (settings.profiles.length >= 100) throw new Error('Можно добавить не более 100 репозиториев.'); settings.profiles.push(profile); }
          engine.invalidate(); value = await store.save(settings); break;
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
          const result = await dialog.showOpenDialog(window, { title: 'Выбор пакета', buttonLabel: 'Выбрать пакет', properties: ['openFile'], filters: [{ name: 'Пакеты RepoSync', extensions: ['md'] }] }); value = result.canceled ? null : result.filePaths[0]; break;
        }
        case 'setOutputDirectory': {
          const name = await realpath(string(args[0]));
          if (!(await lstat(name)).isDirectory()) throw new Error('Выберите папку для сохранения пакетов.');
          const settings = store.get(); settings.outputDirectory = name; value = await store.save(settings); break;
        }
        case 'previewComparison': {
          const id = string((args[0] as { id?: unknown })?.id, 36);
          const profile = parseProfile(args[0], store.get().profiles.find(item => item.id === id));
          value = await engine.previewComparison(profile, direction(args[1])); break;
        }
        case 'previewCode': value = await engine.previewCode(string(args[0], 36), string(args[1])); break;
        case 'analyze': {
          value = await engine.analyze(string(args[0], 36), direction(args[1])); break;
        }
        case 'listBranches': case 'listCommits': {
          const mode = argsMode(args[0]);
          const source = parseSource(args[0], mode);
          value = command === 'listBranches' ? await listBranches(source, mode, engine.cache) : await listCommits(source, mode, engine.cache);
          break;
        }
        case 'exportPackage': {
          if (!Array.isArray(args[1]) || args[1].length > 10_000 || typeof args[2] !== 'boolean') throw new Error('Не удалось прочитать решения проверки данных. Повторите проверку.');
          value = await engine.exportPackage(string(args[0], 36), args[1].map((v: unknown) => string(v, 20)), args[2]); break;
        }
        case 'confirmTransfer': value = await engine.confirmTransfer(string(args[0], 36)); break;
        case 'discardPending': value = await engine.discardPending(string(args[0], 36)); break;
        case 'excludeFinding': value = await engine.excludeFinding(string(args[0], 36), string(args[1], 20)); break;
        case 'openFinding': {
          const { session, finding } = engine.finding(string(args[0], 36), string(args[1], 20));
          if (session.resolved.source.kind === 'local') {
            shell.showItemInFolder(await safePath(session.resolved.root, finding.public.path));
          } else {
            await shell.openExternal(engine.findingURL(string(args[0], 36), string(args[1], 20)));
          }
          value = undefined; break;
        }
        case 'previewReplacement': value = await engine.previewReplacement(string(args[0], 36), string(args[1], 20)); break;
        case 'applyReplacement': await engine.applyReplacement(string(args[0], 36)); value = undefined; break;
        case 'prepareIncoming': value = await engine.prepareIncoming(string(args[0], 36)); break;
        case 'openRepository': { const profile = store.get().profiles.find(p => p.id === string(args[0], 36)); if (!profile?.sources.internal) throw new Error('Укажите локальный репозиторий в настройках.'); const error = await shell.openPath(await realpath(profile.sources.internal.location)); if (error) throw new Error('Не удалось открыть папку репозитория. Проверьте путь в настройках.'); value = undefined; break; }
        case 'preflight': value = await engine.preflight(string(args[0]), string(args[1]), string(args[2], 36)); break;
        case 'applyImport': value = await engine.applyImport(string(args[0], 36)); break;
        default: throw new Error('Запрошенная команда недоступна.');
      }
      return { ok: true, value };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Операция не выполнена';
      // Системные ошибки могут включать содержимое JSON / Git: выводим только известные сообщения.
      const safe = error instanceof SyntaxError ? 'Не удалось прочитать JSON: пакет или настройки повреждены.' : message;
      return { ok: false, error: safe };
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
    window.on('closed', () => { window = null; stopGit(); });
  };
  createWindow();
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
