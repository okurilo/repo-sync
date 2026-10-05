import { contextBridge, ipcRenderer } from 'electron';
import type { API, Command, Reply } from './shared/types';

async function call<T>(command: Command, args: unknown[] = []): Promise<T> {
  const result = await ipcRenderer.invoke('reposync', command, args) as Reply<T>;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api: API = {
  settings: () => call('settings'),
  setEnvironment: mode => call('setEnvironment', [mode]),
  saveProfile: profile => call('saveProfile', [profile]),
  deleteProfile: id => call('deleteProfile', [id]),
  chooseDirectory: () => call('chooseDirectory'),
  choosePackage: () => call('choosePackage'),
  setOutputDirectory: name => call('setOutputDirectory', [name]),
  refreshSource: source => call('refreshSource', [source]),
  listBranches: source => call('listBranches', [source]),
  listCommits: source => call('listCommits', [source]),
  previewComparison: profile => call('previewComparison', [profile]),
  previewCode: (token, name) => call('previewCode', [token, name]),
  analyze: (id, type) => call('analyze', [id, type]),
  exportPackage: (token, keep, override) => call('exportPackage', [token, keep, override]),
  confirmTransfer: id => call('confirmTransfer', [id]),
  discardPending: id => call('discardPending', [id]),
  excludeFinding: (token, id) => call('excludeFinding', [token, id]),
  openFinding: (token, id) => call('openFinding', [token, id]),
  previewReplacement: (token, id) => call('previewReplacement', [token, id]),
  redactFinding: (token, id) => call('redactFinding', [token, id]),
  applyReplacement: token => call('applyReplacement', [token]),
  preflight: (name, target, id) => call('preflight', [name, target, id]),
  applyImport: token => call('applyImport', [token]),
};
contextBridge.exposeInMainWorld('reposync', api);
