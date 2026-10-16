import { imageOperation } from '../shared/fileRules';
import { appVersionLabel } from '../shared/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BackupSummary, RestorePreview, AppUpdateState, LocalGitState, ProjectGitSummary, ProjectFilters, API, Analysis, BranchContext, CompareSelection, ExportReview, CommitOption, IncomingSelection, OutgoingSelection, CodeComparison, Direction, Finding, ImportPreview, Profile, Settings } from '../shared/types';
import { AppearanceStyle, BusyNotice, Icon, type Appearance } from './Appearance';
import { RepositoryCard, RepositoryGrid, syncDate } from './features/Repositories';
import { LocalRepositoryState, RepositorySettings } from './features/RepositorySettings';
import { AppUpdate } from './features/AppUpdate';
import { FileFilters } from './features/FileFilters';
import { IncomingSource } from './features/IncomingSource';
import { LocalCompareSource } from './features/LocalCompareSource';
import { SyncWorkflow, type SyncStep } from './features/SyncWorkflow';
import { AppShell } from './ui/AppShell';
import { Badge, Button, Dialog, DialogBody, DialogHeader, EmptyState, GlobalStyle, IconButton, Muted, Overlay, Row, SourceForm, Status, Surface, WorkflowActions } from './ui/components';
declare global { interface Window { reposync: API } }
const api = window.reposync;
const initialProfile = (): Profile => ({ id: crypto.randomUUID(), name: '', role: 'internal', sources: {}, exclusions: [], includeIgnored: [], maxPartMB: 1, transportMode: 'compact' });
export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(() => { try { return localStorage.getItem('reposync-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const [selected, setSelected] = useState(''); const [draft, setDraft] = useState<Profile | null>(null);
  const [appSettings, setAppSettings] = useState(false);
  const [backupView, setBackupView] = useState<{ profileId: string; items: BackupSummary[]; preview?: RestorePreview } | null>(null);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(null);
  const [updateBranch, setUpdateBranch] = useState('');
  const appUpdateAvailable = appUpdateState?.phase === 'idle' && !!appUpdateState.installedCommit && !!appUpdateState.heads?.[updateBranch] && appUpdateState.heads[updateBranch] !== appUpdateState.installedCommit;
  const [busy, setBusy] = useState(false); const [previewBusy, setPreviewBusy] = useState(false);
  const [failedPath, setFailedPath] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [direction, setDirection] = useState<Direction>('outgoing'); const [step, setStep] = useState<SyncStep | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null); const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [redactedIds, setRedactedIds] = useState<string[]>([]);
  const [gitSummaries, setGitSummaries] = useState<Record<string, ProjectGitSummary>>({});
  const polling = useRef(false);
  const [kept, setKept] = useState<string[]>([]); const [override, setOverride] = useState(false);
  const [exported, setExported] = useState<string[]>([]);
  const [commits, setCommits] = useState<CommitOption[]>([]);
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [branchContext, setBranchContext] = useState<BranchContext>({ branches: [] });
  const [packageComparison, setPackageComparison] = useState<CodeComparison | null>(null);
  const [exportReview, setExportReview] = useState<ExportReview | null>(null);
  const [reviewReady, setReviewReady] = useState(false);
  const [operationLabel, setOperationLabel] = useState('Загрузка настроек…');
  const [outgoingSelection, setOutgoingSelection] = useState<OutgoingSelection>({ mode: 'commit' });
  const [overwriteToken, setOverwriteToken] = useState('');
  const [incomingSelection, setIncomingSelection] = useState<IncomingSelection>({ mode: 'branch' });
  const [selectedIncomingPaths, setSelectedIncomingPaths] = useState<string[]>([]);
  const [includeImages, setIncludeImages] = useState(true); const rememberedImages = useRef<string[]>([]);
  const [localGit, setLocalGit] = useState<LocalGitState | null>(null); const [localError, setLocalError] = useState('');
  const [status, setStatus] = useState<{ incoming?: number; outgoing?: number }>({});
  const packageFile = useRef<string[] | null>(null);
  const pending = useRef<Promise<void> | null>(null); const active = useRef(false);
  const profile = settings?.profiles.find(item => item.id === selected);
  const locked = busy || previewBusy;
  useEffect(() => { if (backupView && !locked) (document.querySelector<HTMLElement>('[data-restore-action]') ?? document.querySelector<HTMLElement>('[data-backup-close]'))?.focus(); }, [!!backupView, backupView?.preview?.token, locked]);
  async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (active.current) return undefined;
    active.current = true; setBusy(true); setError(''); setFailedPath('');
    try { await pending.current; return await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция не выполнена'); setFailedPath(cause instanceof Error && 'syncPath' in cause && typeof cause.syncPath === 'string' ? cause.syncPath : ''); return undefined; }
    finally { active.current = false; setBusy(false); }
  }
  useEffect(() => { void run(async () => setSettings(await api.settings())); }, []);
  useEffect(() => {
    let valid = true;
    const read = (): void => { void api.appUpdateStatus().then(next => { if (!valid) return; setAppUpdateState(next); setUpdateBranch(prior => next.branches.includes(prior) ? prior : next.branches.includes(next.installedBranch ?? '') ? next.installedBranch! : next.branches.includes(next.branch) ? next.branch : next.branches[0] ?? ''); }).catch(() => { /* no banner on an unavailable check */ }); };
    read();
    if (!locked && appUpdateState && (appUpdateState.phase === 'idle' || appUpdateState.phase === 'error')) return () => { valid = false; };
    const timer = window.setInterval(read, 1000); return () => { valid = false; clearInterval(timer); };
  }, [locked, appUpdateState?.phase]);
  const sourcesKey = JSON.stringify(settings?.profiles.map(item => [item.id, item.sources]));
  useEffect(() => {
    if (!settings || locked || step) return;
    let stopped = false; const profiles = settings.profiles;
    const check = async (): Promise<void> => {
      if (polling.current || active.current || document.hidden) return; polling.current = true;
      try { for (const current of profiles) {
        if (stopped || active.current) break;
        try { const next = await api.projectGit(current.id); if (!stopped) setGitSummaries(previous => { const prior = previous[current.id]; const sourcesKey = JSON.stringify(current.sources); return { ...previous, [current.id]: { ...next, sourcesKey, remote: next.remote?.error && prior?.sourcesKey === sourcesKey && prior?.remote ? { ...prior.remote, error: next.remote.error } : next.remote } }; }); }
        catch { /* foreground may take ownership; retry on the next idle pass */ }
      } } finally { polling.current = false; }
    };
    void check(); const timer = window.setInterval(() => void check(), 300_000); const focus = (): void => { void check(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [sourcesKey, locked, step]);
  function reset(): void { setIncludeImages(true); rememberedImages.current = []; setFailedPath(''); setBackupView(null); setOverwriteToken(''); setOutgoingSelection({ mode: 'commit' }); packageFile.current = null; setLocalGit(null); setLocalError(''); setPackageComparison(null); setExportReview(null); setReviewReady(false); setStep(null); setAnalysis(null); setImportPreview(null); setSelectedIncomingPaths([]); setKept([]); setRedactedIds([]); setOverride(false); setExported([]); setError(''); setNotice(''); setStatus({}); }
  function home(): void { reset(); setSelected(''); }
  async function openBackups(current: Profile): Promise<void> {
    reset(); setSelected(current.id); setOperationLabel('Чтение резервных копий…');
    setBackupView({ profileId: current.id, items: await api.listBackups(current.id) });
  }
  async function readLocal(current: Profile): Promise<LocalGitState | null> {
    setLocalGit(null); setLocalError('');
    if (!current.sources.internal) return null;
    try { const state = await api.localState(current.sources.internal); setLocalGit(state); return state; }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Не удалось прочитать локальный Git.'); return null; }
  }
  async function refresh(current: Profile): Promise<void> {
    if (current.role !== 'internal' || current.pending || !current.sources.internal || !current.sources.global) return;
    setOperationLabel('Расчёт исходящих изменений…'); const outgoing = await api.analyze(current.id, 'outgoing'); setStatus({ outgoing: outgoing.entries.length });
  }
  function open(current: Profile): void { reset(); setSelected(current.id); if (!current.sources.internal || (current.role === 'internal' && !current.sources.global)) { setDraft(current); return; } void run(async () => { await readLocal(current); if (current.role === 'internal' && !current.pending) await refresh(current); }); }
  async function begin(next: Direction, current: Profile | undefined = profile, outgoing: OutgoingSelection = { mode: 'commit' }): Promise<void> {
    if (!current) return;
    reset(); setOutgoingSelection(outgoing); setSelected(current.id); setDirection(next);
    setStep('loading'); setOperationLabel('Чтение локального Git…');
    await readLocal(current);
    if (next === 'incoming') {
      setCommits([]); setBranchContext({ branches: [] }); setOperationLabel('Определение основной ветки…');
      const source = current.sources.global;
      if (!source) throw new Error('Настройте внешний Git.');
      setIncomingSelection({ mode: 'branch', branch: source.branch });
      const context = await api.branchContext(source); setBranchContext(context);
      const selection: IncomingSelection = { mode: 'branch', branch: source.branch, baseBranch: context.defaultBranch };
      setIncomingSelection(selection); await api.refreshSource(source); setCommits(await api.listCommits(source));
      setStep('source');
      return;
    }
    setOperationLabel('Загрузка коммитов…');
    const source = { ...current.sources.internal!, commit: undefined };
    setCommits(await api.listCommits(source)); setLocalBranches(await api.listBranches(source)); setStep('source');
  }
  async function compareOutgoing(): Promise<void> {
    if (!profile) return;
    setOperationLabel('Расчёт исходящих изменений…'); setStep('source'); setSelectedIncomingPaths([]); setAnalysis(null); setExportReview(null); setReviewReady(false); setImportPreview(null); setOverwriteToken(''); setKept([]); setRedactedIds([]); setOverride(false); rememberedImages.current = [];
    const result = await api.analyze(profile.id, 'outgoing', undefined, outgoingSelection);
    setAnalysis(result); setSelectedIncomingPaths(result.entries.filter(entry => entry.operation !== 'DELETE' && !entry.excludedBy && (includeImages || !imageOperation(entry))).map(entry => entry.path)); setStep('compare'); setSettings(await api.settings());
  }
  function changeSelection(selection: IncomingSelection): void {
    setIncomingSelection(selection); setAnalysis(null); setImportPreview(null); setOverwriteToken(''); setSelectedIncomingPaths([]); setError(''); setStep('source');
    if (selection.branch !== incomingSelection.branch && profile?.sources.global) {
      setCommits([]); const source = { ...profile.sources.global, branch: selection.branch ?? profile.sources.global.branch };
      void run(async () => { setOperationLabel('Загрузка истории ветки…'); await api.refreshSource(source); setCommits(await api.listCommits(source)); });
    }
  }
  function changePaths(paths: string[], images = includeImages): void {
    const allowed = new Set((direction === 'outgoing' ? analysis?.entries : comparison?.entries)?.filter(entry => !entry.excludedBy && (direction !== 'outgoing' || images || !imageOperation(entry))).map(entry => entry.path));
    setSelectedIncomingPaths([...new Set(paths)].filter(path => allowed.has(path))); setOverwriteToken(''); setRedactedIds([]); setImportPreview(null); setExportReview(null); setReviewReady(false); setKept([]); setOverride(false); setError(''); setStep('compare');
  }
  function toggleImages(enabled: boolean): void {
    if (!analysis || direction !== 'outgoing' || locked) return;
    const imagePaths = new Set(analysis.entries.filter(imageOperation).map(entry => entry.path));
    if (!enabled) rememberedImages.current = selectedIncomingPaths.filter(path => imagePaths.has(path));
    const allowed = new Set(analysis.entries.filter(entry => !entry.excludedBy && (enabled || !imageOperation(entry))).map(entry => entry.path));
    const paths = [...new Set(enabled ? [...selectedIncomingPaths, ...rememberedImages.current] : selectedIncomingPaths)].filter(path => allowed.has(path));
    setIncludeImages(enabled); changePaths(paths, enabled);
    void run(async () => { setOperationLabel('Пересчёт выбранных файлов…'); const result = await api.selectExport(analysis.token, paths); setExportReview(result); });
  }
  async function compareIncoming(selection: IncomingSelection): Promise<void> {
    if (!profile) return;
    setOperationLabel('Расчёт выбранных изменений…'); setStep('source'); setIncomingSelection(selection); setImportPreview(null); setAnalysis(null); setSelectedIncomingPaths([]);
    const result = await api.analyze(profile.id, 'incoming', selection);
    setAnalysis(result); setSelectedIncomingPaths(result.entries.filter(entry => !entry.excludedBy).map(entry => entry.path)); setStep('compare');
  }
  async function importPackage(current: Profile | undefined = profile): Promise<void> {
    if (!current?.sources.internal) throw new Error('Сначала настройте локальный репозиторий');
    const file = await api.choosePackage(); if (!file) { setError(error); return; }
    reset(); setSelected(current.id); setDirection('incoming'); setStep('loading'); await readLocal(current); packageFile.current = file; setOperationLabel('Чтение и проверка частей пакета…');
    const result = await api.loadPackage(file, current.id); setPackageComparison(result); setSelectedIncomingPaths(result.entries.filter(entry => !entry.excludedBy).map(entry => entry.path)); setStep('compare');
  }
  const comparison: CodeComparison | null = useMemo(() => packageComparison ? { ...packageComparison, token: importPreview?.token ?? packageComparison.token } : (analysis ? { token: importPreview?.token ?? analysis.token, from: analysis.sourceState, to: analysis.state, entries: analysis.entries.map(entry => direction === 'outgoing' && !includeImages && imageOperation(entry) ? { ...entry, excludedBy: entry.excludedBy ?? 'Изображения выключены' } : entry), lineChanges: analysis.lineChanges } : null), [packageComparison, importPreview?.token, analysis, direction, includeImages]);
  const selectionKey = `${selected}:${direction}:${packageComparison?.token ?? analysis?.token ?? ''}:${JSON.stringify(selectedIncomingPaths)}`;
  const currentSelection = useRef(selectionKey); currentSelection.current = selectionKey;
  async function checkSelection(): Promise<void> {
    if (!comparison) return;
    setOperationLabel(direction === 'incoming' ? 'Проверка выбранных операций…' : 'Проверка данных выбранных файлов…');
    if (direction === 'outgoing') setReviewReady(false);
    const key = selectionKey;
    if (direction === 'incoming') {
      if (!profile) return;
      const state = await readLocal(profile);
      if (!state || state.issue) return;
      const result = packageComparison ? await api.preparePackage(packageComparison.token, selectedIncomingPaths) : await api.prepareIncoming(analysis!.token, selectedIncomingPaths);
      if (currentSelection.current === key) { setImportPreview(result); setStep('apply'); }
    } else { const result = await api.selectExport(comparison.token, selectedIncomingPaths, redactedIds); if (currentSelection.current === key) { setExportReview(result); setSettings(await api.settings()); setReviewReady(true); setStep(result.findings.length ? 'security' : 'apply'); } }
  }
  async function resolveConflicts(names: string[], accept: boolean): Promise<void> {
    if (!profile || !importPreview?.conflicts?.length) return;
    const conflicts = new Set(importPreview.conflicts.map(conflict => conflict.path));
    const chosen = new Set(names.filter(name => conflicts.has(name)));
    if (!chosen.size) return;
    const paths = accept ? selectedIncomingPaths : selectedIncomingPaths.filter(path => !chosen.has(path));
    const selectedPaths = new Set(paths);
    const accepted = [...new Set([...(importPreview.acceptedPaths ?? []).filter(path => selectedPaths.has(path)), ...(accept ? [...chosen] : [])])];
    setOverwriteToken('');
    if (!paths.length && comparison?.entries.length) { setSelectedIncomingPaths(paths); setImportPreview(null); setStep('compare'); return; }
    setOperationLabel(accept ? 'Подготовка входящей версии…' : 'Сохранение локальной версии…');
    try {
      const result = packageComparison ? await api.preparePackage(packageComparison.token, paths, accepted) : await api.prepareIncoming(analysis!.token, paths, accepted);
      setSelectedIncomingPaths(paths); setImportPreview(result); setStep('apply');
    } catch (cause) { setImportPreview(null); setStep('compare'); throw cause; }
  }
  function updateReview(paths: string[], masks: string[]): void {
    if (!analysis) return;
    const allowed = new Set(comparison?.entries.filter(entry => !entry.excludedBy).map(entry => entry.path));
    paths = paths.filter(path => allowed.has(path));
    setSelectedIncomingPaths(paths); setRedactedIds(masks); setOverride(false); setReviewReady(false);
    void run(async () => { setOperationLabel('Пересчёт выгрузки…'); const activePaths = new Set(paths); const findingPaths = new Map((exportReview?.originalFindings ?? analysis.findings).map(finding => [finding.id, finding.path])); const activeMasks = masks.filter(id => activePaths.has(findingPaths.get(id) ?? ''));
      const result = await api.selectExport(analysis.token, paths, activeMasks); setRedactedIds([...new Set([...masks, ...(result.redactedIds ?? [])])]); setExportReview(result); setSettings(await api.settings()); setReviewReady(true); });
  }
  function toggleReviewPath(path: string, included: boolean): void {
    if (!analysis || locked) return;
    const entry = (comparison?.entries ?? analysis.entries).find(item => item.path === path);
    if (!entry || entry.excludedBy) return;
    const paths = included ? [...new Set([...selectedIncomingPaths, path])] : selectedIncomingPaths.filter(item => item !== path);
    updateReview(paths, redactedIds);
  }
  function decideFindings(ids: string[], choice: 'keep' | 'mask' | 'undecided'): void {
    if (!ids.length || locked) return;
    const idSet = new Set(ids);
    setKept(previous => choice === 'keep' ? [...new Set([...previous, ...ids])] : previous.filter(id => !idSet.has(id)));
    const masks = choice === 'mask' ? [...new Set([...redactedIds, ...ids])] : redactedIds.filter(id => !idSet.has(id));
    if (masks.length !== redactedIds.length || masks.some((id, index) => id !== redactedIds[index])) updateReview(selectedIncomingPaths, masks);
  }
  async function saveFileFilters(global: string[] | null, filters?: ProjectFilters): Promise<void> {
    await run(async () => {
      const next = await api.saveFilters(global, filters ? profile?.id : undefined, filters); setSettings(next);
      if (step && profile) { const current = next.profiles.find(item => item.id === profile.id)!; const files = packageFile.current;
        setImportPreview(null); setExportReview(null); setReviewReady(false); setKept([]); setRedactedIds([]); setOverride(false);
        if (files) { const result = await api.loadPackage(files, profile.id); setPackageComparison(result); setSelectedIncomingPaths(selectedIncomingPaths.filter(path => result.entries.some(entry => entry.path === path && !entry.excludedBy))); }
        else { const result = await api.analyze(current.id, direction, direction === 'incoming' ? incomingSelection : undefined, direction === 'outgoing' ? outgoingSelection : undefined); setAnalysis(result); setSelectedIncomingPaths(selectedIncomingPaths.filter(path => result.entries.some(entry => entry.path === path && !entry.excludedBy))); }
        setStep('compare'); setNotice('Правила применены. Выбор и готовность пересчитаны.');
      }
    });
  }
  const fileFilters = settings && profile ? <FileFilters key={`${profile.id}:${JSON.stringify(settings.globalExclusions)}:${JSON.stringify(profile.filters)}`} settings={settings} profile={profile} busy={locked} save={saveFileFilters} /> : null;
  function showFinding(finding: Finding): void { if (analysis) void run(() => api.openFinding(analysis.token, finding.id)); }
  const localStatus = profile?.sources.internal ? <LocalRepositoryState source={profile.sources.internal} state={localGit} error={localError} busy={locked} refresh={() => void run(async () => { setImportPreview(null); if (step === 'apply') setStep('compare'); await readLocal(profile); })} switchBranch={() => void run(async () => {
        const filename = packageFile.current; const paths = selectedIncomingPaths;
        setImportPreview(null); setAnalysis(null); setPackageComparison(null); setLocalGit(null);
        try { setLocalGit(await api.switchLocalBranch(profile.id)); } catch (cause) { await readLocal(profile); throw cause; }
        if (step && step !== 'done' && step !== 'source') {
          const result = filename ? await api.loadPackage(filename, profile.id) : await api.analyze(profile.id, direction, direction === 'incoming' ? incomingSelection : undefined, direction === 'outgoing' ? outgoingSelection : undefined);
          if (filename) setPackageComparison(result as CodeComparison); else setAnalysis(result as Analysis);
          setSelectedIncomingPaths(paths.filter(name => result.entries.some(entry => entry.path === name))); setStep('compare');
        }
        setNotice('Ветка переключена. Проверка применения выполняется заново.');
      })} /> : null;
  const incomingControls = profile && direction === 'incoming' && profile.role === 'internal' && step !== 'done' && <IncomingSource branch={profile.sources.global?.branch ?? ''} context={branchContext} selection={incomingSelection} commits={commits} busy={locked} change={changeSelection} reload={() => void run(async () => { if (!profile.sources.global) return; setOperationLabel('Обновление веток и истории…'); const source = { ...profile.sources.global, branch: incomingSelection.branch ?? profile.sources.global.branch }; setAnalysis(null); setImportPreview(null); setSelectedIncomingPaths([]); setStep('source'); setBranchContext(await api.branchContext(source)); await api.refreshSource(source); setCommits(await api.listCommits(source)); })} compare={selection => void run(() => compareIncoming(selection))} />;
  const sourceControls = direction === 'incoming' ? incomingControls : profile && <SourceForm aria-label="Источник пакета"><fieldset disabled={locked}><label>Источник файлов<select value={outgoingSelection.mode} onChange={event => { const mode = event.target.value; setOutgoingSelection(mode === 'working' ? { mode: 'working' } : mode === 'compare' ? { mode: 'compare', fromBranch: profile.sources.internal?.branch ?? '', toBranch: profile.sources.internal?.branch ?? '' } : { mode: 'commit' }); setAnalysis(null); setExportReview(null); setReviewReady(false); setError(''); }}><option value="commit">Из коммита</option><option value="working">Из рабочей копии</option><option value="compare">Сравнить две версии Git</option></select><small>{outgoingSelection.mode === 'working' ? 'Текущие файлы с диска, включая незакоммиченные правки и новые файлы.' : outgoingSelection.mode === 'compare' ? 'Выберите исходную A и конечную B версию внутреннего Git. Коммиты можно оставить пустыми, чтобы использовать вершины веток.' : 'Незакоммиченные изменения не входят в пакет.'}</small></label>{outgoingSelection.mode === 'commit' && <label>Коммит<select value={outgoingSelection.commit ?? ''} onChange={event => { setOutgoingSelection({ mode: 'commit', commit: event.target.value || undefined }); setAnalysis(null); setExportReview(null); setReviewReady(false); setError(''); }}><option value="">Последний в ветке {profile.sources.internal?.branch}</option>{commits.map(commit => <option key={commit.sha} value={commit.sha}>{commit.sha.slice(0, 8)} · {commit.subject ?? commit.date}</option>)}</select></label>}{outgoingSelection.mode === 'compare' && <LocalCompareSource selection={outgoingSelection} branches={localBranches} source={profile.sources.internal!} workingBranch={localGit?.branch ?? undefined} change={(selection: CompareSelection) => { setOutgoingSelection(selection); setAnalysis(null); setExportReview(null); setReviewReady(false); setError(''); }} />}</fieldset><WorkflowActions><Muted style={{ margin: 0, fontSize: 13 }}>Далее — выбор файлов и просмотр отличий.</Muted><Button $primary disabled={locked} onClick={() => void run(compareOutgoing)}>Показать изменения</Button></WorkflowActions></SourceForm>;
  const sourceSummary = direction === 'outgoing' ? outgoingSelection.mode === 'compare' ? `${outgoingSelection.fromBranch}@${outgoingSelection.fromCommit?.slice(0, 8) ?? 'HEAD'} → ${outgoingSelection.toBranch}@${outgoingSelection.toWorking ? 'рабочая копия' : outgoingSelection.toCommit?.slice(0, 8) ?? 'HEAD'}` : `${profile?.sources.internal?.branch} · ${outgoingSelection.mode === 'working' ? 'Рабочая копия' : outgoingSelection.commit ? `Коммит ${outgoingSelection.commit.slice(0, 8)}` : `Последний коммит${analysis ? ` ${analysis.state.slice(0, 8)}` : ''}`}` : profile?.role === 'external' ? 'Выбранный пакет изменений' : `${incomingSelection.branch ?? profile?.sources.global?.branch} · ${{ branch: 'Изменения ветки', branches: 'Две ветки', commit: 'Один коммит', range: 'Два коммита', repositories: 'Репозитории целиком', zero: 'Все внешние файлы' }[incomingSelection.mode]}${incomingSelection.mode === 'branch' || incomingSelection.mode === 'branches' ? ` · ${incomingSelection.baseBranch} → ${incomingSelection.branch}` : incomingSelection.mode === 'range' ? ` · ${incomingSelection.from?.slice(0, 8)} → ${(incomingSelection.commit ?? commits[0]?.sha)?.slice(0, 8)}` : incomingSelection.mode === 'commit' ? ` · ${(incomingSelection.commit ?? commits[0]?.sha)?.slice(0, 8)}` : ''}`;
  return <><GlobalStyle /><AppearanceStyle $appearance={appearance} /><AppShell version={appVersionLabel(appUpdateState)} direction={step ? direction : undefined} incoming={profile?.role === 'internal' && !profile.pending && profile.sources.internal && profile.sources.global ? () => void run(() => begin('incoming')) : undefined} outgoing={profile?.role === 'internal' && !profile.pending && profile.sources.internal ? () => void run(() => begin('outgoing')) : undefined} appearance={appearance} disabled={locked} toggleTheme={() => { const next = appearance === 'dark' ? 'light' : 'dark'; setAppearance(next); try { localStorage.setItem('reposync-theme', next); } catch { /* optional preference */ } }} repositories={home} settings={() => setAppSettings(true)}>
    {busy && !step && <BusyNotice role="status">{operationLabel}</BusyNotice>}{error && !draft && !step && <Status $error role="alert">{error}</Status>}{notice && <Status role="status">{notice}</Status>}
    {!settings ? <div role="status" aria-label="Загрузка репозиториев"><div className="reposync-skeleton" style={{ height: 110, marginBottom: 20 }} /><div className="reposync-skeleton" style={{ height: 260 }} /></div> : !profile ? <><Row style={{ justifyContent: 'space-between', marginBottom: 28 }}><div><h1>Репозитории</h1><Muted style={{ margin: 0 }}>Синхронизация изменений между репозиториями.</Muted></div><Row>{appUpdateAvailable && <Button disabled={locked} onClick={() => setAppSettings(true)}>Обновить приложение</Button>}<Button $primary disabled={locked} onClick={() => { setError(''); setDraft(initialProfile()); }}><Icon name="plus" />Добавить репозиторий</Button></Row></Row>{settings.profiles.length ? <><RepositoryGrid>{settings.profiles.map(current => <RepositoryCard key={current.id} profile={current} gitSummary={gitSummaries[current.id]?.sourcesKey === JSON.stringify(current.sources) ? gitSummaries[current.id] : undefined} refreshGit={() => void run(async () => { setOperationLabel('Обновление внешнего Git…'); const summary = await api.refreshProject(current.id); setGitSummaries(previous => ({ ...previous, [current.id]: { ...summary, sourcesKey: JSON.stringify(current.sources) } })); setSettings(await api.settings()); })} busy={locked} open={() => open(current)} incoming={() => void run(() => begin('incoming', current))} outgoing={() => void run(() => begin('outgoing', current))} importPackage={() => void run(() => importPackage(current))} backups={() => void run(() => openBackups(current))} />)}</RepositoryGrid></> : <EmptyState title="Репозитории ещё не добавлены"><Muted>Добавьте репозиторий, чтобы получать изменения из Git или создавать пакеты .md.</Muted><Button $primary disabled={locked} onClick={() => setDraft(initialProfile())}><Icon name="plus" />Добавить репозиторий</Button></EmptyState>}</> : <>
      {!step && <><Row style={{ justifyContent: 'space-between', marginBottom: step ? 12 : 24 }}><IconButton disabled={locked} onClick={home}><Icon name="back" />Репозитории</IconButton><IconButton disabled={locked || !!step} aria-label="Настроить репозиторий" onClick={() => { setError(''); setDraft(profile); }}><Icon name="settings" /></IconButton></Row><Row><h1 style={{ margin: 0, fontSize: step ? 22 : 30 }}>{profile.name}</h1><Badge>{profile.role === 'internal' ? 'Внутренний контур' : 'Внешний контур'}</Badge></Row><Muted style={{ margin: step ? '4px 0 12px' : '10px 0 28px' }}><code>{profile.sources.internal?.location ?? 'Укажите локальный репозиторий в настройках'}</code> · {profile.sources.internal?.branch}</Muted></>}
      {!step && <Row><Button disabled={locked} onClick={() => void run(() => openBackups(profile))}>Резервные копии и восстановление</Button></Row>}
      {!step && localStatus}
      {!step ? <>
        {profile.pending ? <Surface><h2>Пакет ожидает подтверждения</h2><Muted>{profile.pending.partial ? 'Подтвердите получение выбранных файлов снаружи. Подтверждение завершает ожидание передачи.' : 'Подтверждайте полный пакет после применения всех его операций. Если применили только часть, отмените ожидание, чтобы сохранить прежнее общее состояние.'}</Muted>{profile.pending.paths.map(file => <p key={file}><code>{file}</code></p>)}<Row><Button $primary disabled={locked} onClick={() => void run(async () => { setSettings(await api.confirmTransfer(profile.id)); setNotice(profile.pending?.partial ? 'Передача выбранных файлов подтверждена.' : 'Применение подтверждено. Состояние синхронизации обновлено.'); })}>Подтвердить применение</Button><Button disabled={locked} onClick={() => void run(async () => { setSettings(await api.discardPending(profile.id)); setNotice('Ожидание отменено. Файлы пакета сохранены на диске.'); })}>Отменить ожидание</Button></Row></Surface> : profile.role === 'internal' ? <Surface style={{ padding: 36 }}><h2>Синхронизация</h2><div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 48px minmax(0, 1fr)', gap: 24, margin: '32px 0' }}><div><Badge>Внешний Git</Badge><Muted><code>{profile.sources.global?.location ?? 'Настройте внешний Git'}</code><br />{profile.sources.global?.branch}</Muted><p>{status.incoming === undefined ? 'Сравните ветку с её основой' : `Изменено файлов: ${status.incoming}`}</p><Button $primary disabled={locked || !profile.sources.global || !profile.sources.internal} onClick={() => void run(() => begin('incoming'))}><Icon name="import" />Получить изменения из Git</Button></div><div style={{ alignSelf: 'center', color: 'var(--muted)' }}><Icon name="sync" /></div><div><Badge>Локальный репозиторий</Badge><Muted><code>{profile.sources.internal?.location}</code><br />{profile.sources.internal?.branch}</Muted><p>{status.outgoing === undefined ? 'Изменения ещё не проверены' : `Изменено файлов: ${status.outgoing}`}</p><Button disabled={locked || !profile.sources.internal} onClick={() => void run(() => begin('outgoing'))}><Icon name="arrow" />Подготовить пакет</Button></div></div><Row style={{ justifyContent: 'space-between' }}><small>Последняя синхронизация: {syncDate(profile.syncedAt)}</small><Button disabled={locked} onClick={() => void run(() => refresh(profile))}>Проверить изменения</Button></Row><details style={{ marginTop: 20 }}><summary>Подробности</summary><p><code>{profile.baseline?.state ?? 'Состояние синхронизации ещё не сохранено'}</code></p><small>Файлов в общем состоянии: {profile.baseline?.files.length ?? 0}.</small></details></Surface> : <EmptyState title="Пакет изменений"><Muted>Выберите любую часть пакета .md. Все части должны лежать в одной папке с исходными именами. Перед применением вы увидите изменения.</Muted><Button $primary disabled={locked || !profile.sources.internal} onClick={() => void run(() => importPackage())}><Icon name="import" />Выбрать пакет</Button></EmptyState>}
      </> : <>

        <SyncWorkflow localProblem={!!localError || !!localGit?.issue} operationLabel={operationLabel} sourceSummary={sourceSummary} includeImages={includeImages} toggleImages={toggleImages} failedPath={failedPath} workingSource={outgoingSelection.mode === 'working' || (outgoingSelection.mode === 'compare' && !!outgoingSelection.toWorking)} overwriteConfirmed={overwriteToken === importPreview?.token} confirmOverwrite={checked => setOverwriteToken(checked ? importPreview?.token ?? '' : '')} fileFilters={fileFilters} redactedIds={redactedIds} reviewFindings={exportReview?.originalFindings} reviewReady={direction === 'incoming' || reviewReady} localStatus={localStatus} sourceControls={sourceControls} profile={profile} settings={settings} direction={direction} step={step} analysis={analysis ? { ...analysis, ...exportReview, entries: comparison?.entries ?? analysis.entries} : null} importPreview={importPreview} comparison={comparison} kept={kept} override={override} exported={exported} busy={busy} locked={locked} error={error} retryComparison={() => void run(() => profile.role === 'external' ? importPackage() : direction === 'incoming' ? step === 'loading' ? begin('incoming') : compareIncoming(incomingSelection) : step === 'loading' ? begin(direction, profile, outgoingSelection) : compareOutgoing())} pending={pending} setPreviewBusy={setPreviewBusy} setStep={setStep} setOverride={setOverride} close={() => { reset(); void run(() => readLocal(profile)); }} decide={decideFindings} showFinding={showFinding} selectedIncomingPaths={selectedIncomingPaths} onSelectedIncomingPathsChange={changePaths} toggleReviewPath={toggleReviewPath} checkSelection={() => void run(checkSelection)}
          resolveConflict={(name, accept) => void run(() => resolveConflicts([name], accept))} acceptAllConflicts={() => void run(() => resolveConflicts(importPreview?.conflicts?.map(conflict => conflict.path) ?? [], true))}
          chooseOutput={() => void run(async () => { const directory = await api.chooseDirectory(); if (directory) setSettings(await api.setOutputDirectory(directory)); })}
          exportPackage={() => { if (analysis && reviewReady) void run(async () => { setOperationLabel('Запись частей пакета…'); setExported(await api.exportPackage(analysis.token, kept.filter(id => exportReview?.findings.some(finding => finding.id === id)), override)); setSettings(await api.settings()); setStep('done'); }); }}
          apply={() => { if (importPreview) void run(async () => { setOperationLabel('Резервное копирование и применение…'); try { setSettings(await api.applyImport(importPreview.token, overwriteToken === importPreview.token)); } catch (cause) { setOverwriteToken(''); setImportPreview(null); setStep('compare'); throw cause; } await readLocal(profile); setStep('done'); setAnalysis(null); }); }}
          restore={() => void run(() => openBackups(profile))} openRepository={() => void run(() => api.openRepository(profile.id))} />
      </>}
    </>}
  </AppShell>
  {backupView && <Overlay><Dialog locked={locked} onClose={() => { setBackupView(null); setError(''); }} role="dialog" aria-modal="true" aria-labelledby="backup-title">
    <DialogHeader><h2 id="backup-title">Восстановление файлов</h2><Button data-backup-close disabled={locked} onClick={() => { setBackupView(null); setError(''); }}>Закрыть</Button></DialogHeader>
    <DialogBody>
      {error && <Status $error role="alert">{error}</Status>}
      {backupView.preview ? <>
        <Muted>Будут восстановлены файлы операции: {backupView.preview.entries.length}. {backupView.preview.entries.length > 1000 ? 'Показаны первые 1000 путей; восстановление затронет весь набор.' : 'Будут возвращены их предыдущие версии и права.'} Текущее состояние также сохранится в резервной копии. Git index и история не изменятся.</Muted>
        {backupView.preview.entries.slice(0, 1000).map(entry => <p key={entry.path} style={{ overflowWrap: 'anywhere' }}><code>{entry.path}</code> · {entry.action}</p>)}
        <Row>
          <Button disabled={locked} onClick={() => setBackupView({ ...backupView, preview: undefined })}>К списку копий</Button>
          <Button data-restore-action $primary disabled={locked} onClick={() => void run(async () => {
            setOperationLabel('Восстановление файлов…'); let next: Settings;
            try { next = await api.applyRestore(backupView.preview!.token); }
            catch (cause) { setBackupView({ ...backupView, preview: undefined }); throw cause; }
            setSettings(next); setBackupView(null); setNotice('Предыдущие файлы восстановлены. Состояние перед восстановлением сохранено в новой копии.');
            const current = next.profiles.find(item => item.id === backupView.profileId); if (current) await readLocal(current);
          })}>Восстановить предыдущие файлы</Button>
        </Row>
      </> : <>
        {!backupView.items.length && <Muted>Сохранённых операций для этого репозитория пока нет.</Muted>}
        {backupView.items.map(item => <section key={item.id} style={{ borderBottom: '1px solid var(--line)', paddingBlock: 12, overflowWrap: 'anywhere' }}>
          <strong>{item.at ? syncDate(item.at) : 'Дата неизвестна'}</strong><p>{item.action ?? 'Применение изменений'} · {item.files} файлов · ветка {item.branch ?? 'не сохранена'}</p>
          <details><summary>Расположение копии</summary><code>{item.directory}</code></details>
          {item.unavailable ? <p>{item.unavailable}</p> : <Button disabled={locked} onClick={() => void run(async () => {
            setOperationLabel('Проверка восстановления…'); const preview = await api.prepareRestore(backupView.profileId, item.id); setBackupView({ ...backupView, preview });
          })}>Посмотреть восстановление</Button>}
        </section>)}
      </>}
    </DialogBody>
  </Dialog></Overlay>}
  {draft && <RepositorySettings key={draft.id} profile={draft} busy={locked} error={error} inspect={source => api.localState(source)} close={() => { setDraft(null); setError(''); }} choose={async () => await run(() => api.chooseDirectory()) ?? null} branches={async source => {
    const result = await run(async () => {
      try { return { ok: true as const, value: await api.listBranches(source) }; }
      catch (cause) { return { ok: false as const, message: cause instanceof Error ? cause.message : 'Не удалось загрузить ветки. Повторите попытку.' }; }
    });
    if (!result) throw new Error('Дождитесь завершения текущей операции и повторите загрузку веток.');
    if (!result.ok) throw new Error(result.message);
    return result.value;
  }} save={next => void run(async () => { setSettings(await api.saveProfile(next)); setSelected(next.id); setDraft(null); reset(); await readLocal(next); })} remove={settings?.profiles.some(p => p.id === draft.id) ? () => { void run(async () => { setSettings(await api.deleteProfile(draft.id)); setDraft(null); home(); }); } : undefined} />}
  {appSettings && <Overlay><Dialog onClose={() => setAppSettings(false)} locked={locked} role="dialog" aria-modal="true" aria-labelledby="app-settings-title"><DialogHeader><h2 id="app-settings-title">Настройки</h2><IconButton aria-label="Закрыть" disabled={locked} onClick={() => setAppSettings(false)}><Icon name="close" /></IconButton></DialogHeader><DialogBody><AppUpdate state={appUpdateState} branch={updateBranch} change={setUpdateBranch} checked={setAppUpdateState} busy={locked || !!step} run={operation => { setOperationLabel('Обновление приложения…'); void run(operation); }} />{error && <Status $error role="alert">{error}</Status>}{settings && <FileFilters key={JSON.stringify(settings.globalExclusions)} settings={settings} busy={locked} save={saveFileFilters} />}<h3>Папка для пакетов</h3><code>{settings?.outputDirectory || 'Не выбрана'}</code><Button disabled={locked || !!step} onClick={() => void run(async () => { const directory = await api.chooseDirectory(); if (directory) setSettings(await api.setOutputDirectory(directory)); })}>Выбрать папку</Button><Muted>RepoSync работает локально, без телеметрии. Контур «Внутренний» или «Внешний» задаётся для каждого репозитория.</Muted>{step && <small>Папку можно выбрать рядом с кнопкой создания пакета.</small>}</DialogBody></Dialog></Overlay>}

  </>;
}
