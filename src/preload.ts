import { contextBridge, ipcRenderer } from 'electron';
import type { API, Command, Reply } from './shared/types';

async function call<T>(command: Command, args: unknown[] = []): Promise<T> {
  const result = await ipcRenderer.invoke('reposync', command, args) as Reply<T>;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api: API = {
  settings: () => call('settings'),
  saveProfile: profile => call('saveProfile', [profile]),
  deleteProfile: id => call('deleteProfile', [id]),
  chooseDirectory: () => call('chooseDirectory'),
  choosePackage: () => call('choosePackage'),
  setOutputDirectory: name => call('setOutputDirectory', [name]),
  refreshSource: source => call('refreshSource', [source]),
  listBranches: source => call('listBranches', [source]),
  listCommits: source => call('listCommits', [source]),
  previewComparison: (profile, direction) => call('previewComparison', [profile, direction]),
  previewCode: (token, name) => call('previewCode', [token, name]),
  analyze: (id, type, selection) => call('analyze', [id, type, selection]),
  exportPackage: (token, keep, override) => call('exportPackage', [token, keep, override]),
  confirmTransfer: id => call('confirmTransfer', [id]),
  discardPending: id => call('discardPending', [id]),
  excludeFinding: (token, id) => call('excludeFinding', [token, id]),
  openFinding: (token, id) => call('openFinding', [token, id]),
  previewReplacement: (token, id) => call('previewReplacement', [token, id]),
  applyReplacement: token => call('applyReplacement', [token]),
  prepareIncoming: token => call('prepareIncoming', [token]),
  openRepository: id => call('openRepository', [id]),
  preflight: (name, target, id) => call('preflight', [name, target, id]),
  applyImport: token => call('applyImport', [token]),
};
contextBridge.exposeInMainWorld('reposync', api);
