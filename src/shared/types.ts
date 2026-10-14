export type Environment = 'internal' | 'global';
export type Direction = 'incoming' | 'outgoing';
export type RepositoryRole = 'internal' | 'external';
export type TransportMode = 'compact' | 'readable';
export type PackageType = 'snapshot' | 'diff';
export type Operation = 'ADD' | 'MODIFY' | 'DELETE' | 'RENAME' | 'REPLACE';
export type Encoding = 'RAW' | 'BASE64' | 'BROTLI_BASE64';
export interface GitRevision { branch: string; commit?: string }
export interface Source { kind: 'local' | 'remote'; location: string; branch: string; commit?: string; base?: GitRevision }
export interface CommitOption { sha: string; date: string; subject?: string }
export interface OutgoingSelection { mode: 'commit' | 'working'; commit?: string }
export interface IncomingSelection { mode: 'branch' | 'branches' | 'commit' | 'range' | 'repositories' | 'zero'; commit?: string; from?: string; baseBranch?: string; branch?: string }
export interface ProjectFilters { extra: string[]; disabled: string[] }
export interface LastAction { type: string; at: string }
export interface ProjectGitSummary { sourcesKey?: string; local?: LocalGitState; localDate?: string; localError?: string; remote?: { branch: string; head: string | null; date?: string; availableHead?: string | null; checkedAt?: string; error?: string }; checkedAt: string }
export interface LocalGitState {
  branch: string | null; head: string | null; branches: string[];
  workingChanges: { staged: number; unstaged: number; untracked: number };
  conflicts: number; operations: string[]; issue: string | null; canSwitch: boolean;
}
export interface BranchContext { branches: string[]; defaultBranch?: string }
export interface ExportReview { originalFindings?: Finding[]; redactedIds?: string[]; findings: Finding[]; parts: number; estimatedBytes: number }
export interface RemoteUpdate { changedBranches: string[]; branches: string[]; commits: CommitOption[]; baseCommits: CommitOption[] }
export interface FileEntry { path: string; sha256: string; size: number; mode: number }
export interface Baseline { state: string; files: FileEntry[]; scope: string; localRepository?: string }
export interface Pending { packageId: string; target: Baseline; paths: string[]; partial?: boolean }
export interface Profile {
  filters?: ProjectFilters; lastAction?: LastAction;
  id: string; name: string; sources: Partial<Record<Environment, Source>>;
  role: RepositoryRole; baseline?: Baseline; pending?: Pending;
  syncedAt?: string; commitRequired?: boolean; transportMode: TransportMode;
  exclusions: string[]; includeIgnored: string[]; maxPartMB: number;
}
export interface Settings {
  schemaVersion: 6; profiles: Profile[]; globalExclusions: string[];
  outputDirectory: string; lastRepositories: string[];
}
export interface RecordData {
  path: string; oldPath?: string; operation: Operation; size: number; mode: number;
  beforeMode?: number; beforeSha256?: string; afterSha256?: string; encoding: Encoding; payload: string;
}
export interface Transport {
  unavailablePaths?: string[];
  protocolVersion: 1 | 2 | 3 | 4 | 5 | 6; schemaVersion: 1 | 2 | 3 | 4 | 5 | 6; packageId: string; packageType: PackageType;
  sourceState: string | null; targetState: string; scope: string;
  files: FileEntry[]; records: RecordData[];
}
export interface Finding {
  id: string; path: string; line: number; preview: string; reason: string;
  context?: { before: string; match: string; after: string; location: string };
  severity: 'warning' | 'block'; replacement: string; canReplace: boolean;
}
export interface Analysis {
  incomingMode?: IncomingSelection['mode'];
  branchComparison?: { branch: string; baseBranch: string; baseHead: string };
  token: string; state: string; sourceState: string | null; packageType: PackageType;
  files: number; changes: Record<Operation, number>; excludedGit: number;
  excludedCustom: number; estimatedBytes: number; parts: number; findings: Finding[];
  lineChanges: { added: number; removed: number };
  local: boolean; ignored: string[];
  workingChanges: { staged: number; unstaged: number; untracked: number };
  entries: { path: string; oldPath?: string; operation: Operation; size: number; ignoredBy?: number[]; excludedBy?: string }[];
}
export interface ImportPreview {
  divergences?: { path: string; message: string }[];
  acceptedPaths?: string[];
  overwritePaths?: { path: string; staged: boolean }[];
  conflicts?: { path: string; operation: Operation; message: string }[];
  incomingMode?: IncomingSelection['mode'];
  workingChanges: Analysis['workingChanges'];
  token: string; packageId: string; sourceState: string | null; targetState: string;
  packageType: PackageType; changes: Record<Operation, number>; files: number; lineChanges: { added: number; removed: number };
  entries: { path: string; oldPath?: string; operation: Operation; size: number; ignoredBy?: number[]; excludedBy?: string }[];
}
export interface ReplacementPreview { token: string; path: string; line: number; preview: string; replacement: string }
export interface CodeComparison { unavailablePaths?: string[]; token: string; from: string | null; to: string; entries: Analysis['entries']; lineChanges?: { added: number; removed: number } }
export interface CodePreview { before: string; after: string; message?: string; beforeLabel?: string; afterLabel?: string; details?: string; source?: CodePreview }
export interface BackupSummary { id: string; at: string; files: number; action?: string; branch?: string; unavailable?: string; directory: string }
export interface RestorePreview { token: string; entries: { path: string; action: string }[] }
export interface AppUpdateState { installedVersion?: string; installedCommit?: string; installedBranch?: string; heads?: Record<string, string>; checkedAt?: string; root: string; branch: string; branches: string[]; phase: 'idle' | 'checking' | 'building' | 'restarting' | 'error'; message: string; command: string; error?: string }
export interface API {
  listBackups(profileId: string): Promise<BackupSummary[]>;
  prepareRestore(profileId: string, backupId: string): Promise<RestorePreview>;
  applyRestore(token: string): Promise<Settings>;
  appUpdateStatus(): Promise<AppUpdateState>;
  appUpdateInspect(): Promise<AppUpdateState>;
  appUpdate(branch: string): Promise<void>;
  cancelAppUpdate(): Promise<void>;
  localState(source: Source): Promise<LocalGitState>;
  switchLocalBranch(profileId: string): Promise<LocalGitState>;
  settings(): Promise<Settings>;
  saveFilters(global: string[] | null, profileId?: string, filters?: ProjectFilters): Promise<Settings>;
  projectGit(id: string): Promise<ProjectGitSummary>;
  refreshProject(id: string): Promise<ProjectGitSummary>;
  saveProfile(profile: Profile): Promise<Settings>;
  deleteProfile(id: string): Promise<Settings>;
  chooseDirectory(): Promise<string | null>;
  choosePackage(): Promise<string[] | null>;
  setOutputDirectory(path: string): Promise<Settings>;
  refreshSource(source: Source): Promise<RemoteUpdate>;
  branchContext(source: Source): Promise<BranchContext>;
  listBranches(source: Source): Promise<string[]>;
  listCommits(source: Source): Promise<CommitOption[]>;
  previewComparison(profile: Profile, direction: Direction): Promise<CodeComparison>;
  previewCode(token: string, path: string): Promise<CodePreview>;
  analyze(id: string, direction: Direction, selection?: IncomingSelection, outgoing?: OutgoingSelection): Promise<Analysis>;
  selectExport(token: string, selectedPaths: string[], redactedIds?: string[]): Promise<ExportReview>;
  loadPackage(path: string | string[], profileId: string): Promise<CodeComparison>;
  preparePackage(token: string, selectedPaths: string[], acceptedPaths?: string[]): Promise<ImportPreview>;
  exportPackage(token: string, keep: string[], override: boolean): Promise<string[]>;
  confirmTransfer(id: string): Promise<Settings>;
  discardPending(id: string): Promise<Settings>;
  excludeFinding(token: string, findingId: string): Promise<{ settings: Settings; analysis: Analysis }>;
  openFinding(token: string, findingId: string): Promise<void>;
  previewReplacement(token: string, findingId: string): Promise<ReplacementPreview>;
  applyReplacement(token: string): Promise<void>;
  prepareIncoming(token: string, selectedPaths?: string[], acceptedPaths?: string[]): Promise<ImportPreview>;
  openRepository(id: string): Promise<void>;
  preflight(path: string, target: string, profileId: string): Promise<ImportPreview>;
  applyImport(token: string, overwrite?: boolean): Promise<Settings>;
}
export type Command = keyof API;
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string; path?: string };

export function appVersionLabel(state: AppUpdateState | null): string { return state?.installedVersion ? `v${state.installedVersion}${state.installedBranch && state.installedBranch !== 'main' ? ` · ${state.installedBranch}` : ''}` : 'Версия не определена'; }
