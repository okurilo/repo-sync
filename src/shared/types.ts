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
export interface IncomingSelection { mode: 'branch' | 'commit' | 'range' | 'repositories' | 'zero'; commit?: string; from?: string; baseBranch?: string; branch?: string }
export interface BranchContext { branches: string[]; defaultBranch?: string }
export interface ExportReview { findings: Finding[]; parts: number; estimatedBytes: number }
export interface RemoteUpdate { changedBranches: string[]; branches: string[]; commits: CommitOption[]; baseCommits: CommitOption[] }
export interface FileEntry { path: string; sha256: string; size: number; mode: number }
export interface Baseline { state: string; files: FileEntry[]; scope: string; localRepository?: string }
export interface Pending { packageId: string; target: Baseline; paths: string[]; partial?: boolean }
export interface Profile {
  id: string; name: string; sources: Partial<Record<Environment, Source>>;
  role: RepositoryRole; baseline?: Baseline; pending?: Pending;
  syncedAt?: string; commitRequired?: boolean; transportMode: TransportMode;
  exclusions: string[]; includeIgnored: string[]; maxPartMB: number;
}
export interface Settings {
  schemaVersion: 5; profiles: Profile[];
  outputDirectory: string; lastRepositories: string[];
}
export interface RecordData {
  path: string; oldPath?: string; operation: Operation; size: number; mode: number;
  beforeMode?: number; beforeSha256?: string; afterSha256?: string; encoding: Encoding; payload: string;
}
export interface Transport {
  protocolVersion: 1 | 2 | 3 | 4; schemaVersion: 1 | 2 | 3 | 4; packageId: string; packageType: PackageType;
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
  entries: { path: string; oldPath?: string; operation: Operation; size: number; ignoredBy?: number[] }[];
}
export interface ImportPreview {
  incomingMode?: IncomingSelection['mode'];
  workingChanges: Analysis['workingChanges'];
  token: string; packageId: string; sourceState: string | null; targetState: string;
  packageType: PackageType; changes: Record<Operation, number>; files: number; lineChanges: { added: number; removed: number };
  entries: { path: string; oldPath?: string; operation: Operation; size: number; ignoredBy?: number[] }[];
}
export interface ReplacementPreview { token: string; path: string; line: number; preview: string; replacement: string }
export interface CodeComparison { token: string; from: string | null; to: string; entries: Analysis['entries']; lineChanges?: { added: number; removed: number } }
export interface CodePreview { before: string; after: string; message?: string }
export interface API {
  settings(): Promise<Settings>;
  saveProfile(profile: Profile): Promise<Settings>;
  deleteProfile(id: string): Promise<Settings>;
  chooseDirectory(): Promise<string | null>;
  choosePackage(): Promise<string | null>;
  setOutputDirectory(path: string): Promise<Settings>;
  refreshSource(source: Source): Promise<RemoteUpdate>;
  branchContext(source: Source): Promise<BranchContext>;
  listBranches(source: Source): Promise<string[]>;
  listCommits(source: Source): Promise<CommitOption[]>;
  previewComparison(profile: Profile, direction: Direction): Promise<CodeComparison>;
  previewCode(token: string, path: string): Promise<CodePreview>;
  analyze(id: string, direction: Direction, selection?: IncomingSelection): Promise<Analysis>;
  selectExport(token: string, selectedPaths: string[]): Promise<ExportReview>;
  loadPackage(path: string, profileId: string): Promise<CodeComparison>;
  preparePackage(token: string, selectedPaths: string[]): Promise<ImportPreview>;
  exportPackage(token: string, keep: string[], override: boolean): Promise<string[]>;
  confirmTransfer(id: string): Promise<Settings>;
  discardPending(id: string): Promise<Settings>;
  excludeFinding(token: string, findingId: string): Promise<{ settings: Settings; analysis: Analysis }>;
  openFinding(token: string, findingId: string): Promise<void>;
  previewReplacement(token: string, findingId: string): Promise<ReplacementPreview>;
  applyReplacement(token: string): Promise<void>;
  prepareIncoming(token: string, selectedPaths?: string[]): Promise<ImportPreview>;
  openRepository(id: string): Promise<void>;
  preflight(path: string, target: string, profileId: string): Promise<ImportPreview>;
  applyImport(token: string): Promise<Settings>;
}
export type Command = keyof API;
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
