import { contextBridge, ipcRenderer } from 'electron';
import type { API, Command, Reply } from './shared/types';

async function call<T>(command: Command, args: unknown[] = []): Promise<T> {
  const result = await ipcRenderer.invoke('reposync', command, args) as Reply<T>;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api: API = {
  appUpdateStatus: () => call('appUpdateStatus'),
  appUpdateInspect: () => call('appUpdateInspect'),
  appUpdate: branch => call('appUpdate', [branch]),
  cancelAppUpdate: () => call('cancelAppUpdate'),
  localState: source => call('localState', [source]),
  switchLocalBranch: id => call('switchLocalBranch', [id]),
  settings: () => call('settings'),
  saveFilters: (global, id, filters) => call('saveFilters', [global, id, filters]),
  projectGit: id => call('projectGit', [id]),
  refreshProject: id => call('refreshProject', [id]),
  saveProfile: profile => call('saveProfile', [profile]),
  deleteProfile: id => call('deleteProfile', [id]),
  chooseDirectory: () => call('chooseDirectory'),
  choosePackage: () => call('choosePackage'),
  setOutputDirectory: name => call('setOutputDirectory', [name]),
  refreshSource: source => call('refreshSource', [source]),
  branchContext: source => call('branchContext', [source]),
  selectExport: (token, paths, redacted) => call('selectExport', [token, paths, redacted]),
  loadPackage: (name, id) => call('loadPackage', [name, id]),
  preparePackage: (token, paths) => call('preparePackage', [token, paths]),
  listBranches: source => call('listBranches', [source]),
  listCommits: source => call('listCommits', [source]),
  previewComparison: (profile, direction) => call('previewComparison', [profile, direction]),
  previewCode: (token, name) => call('previewCode', [token, name]),
  analyze: (id, type, selection, outgoing) => call('analyze', [id, type, selection, outgoing]),
  exportPackage: (token, keep, override) => call('exportPackage', [token, keep, override]),
  confirmTransfer: id => call('confirmTransfer', [id]),
  discardPending: id => call('discardPending', [id]),
  excludeFinding: (token, id) => call('excludeFinding', [token, id]),
  openFinding: (token, id) => call('openFinding', [token, id]),
  previewReplacement: (token, id) => call('previewReplacement', [token, id]),
  applyReplacement: token => call('applyReplacement', [token]),
  prepareIncoming: (token, selectedPaths) => call('prepareIncoming', selectedPaths ? [token, selectedPaths] : [token]),
  openRepository: id => call('openRepository', [id]),
  preflight: (name, target, id) => call('preflight', [name, target, id]),
  applyImport: (token, overwrite) => call('applyImport', [token, overwrite]),
};
contextBridge.exposeInMainWorld('reposync', api);
