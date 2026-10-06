import { useEffect, useRef, useState } from 'react';
import type { API, Analysis, CommitOption, IncomingSelection, CodeComparison, Direction, Finding, ImportPreview, Profile, ReplacementPreview, Settings } from '../shared/types';
import { AppearanceStyle, BusyNotice, Icon, type Appearance } from './Appearance';
import { RepositoryCard, syncDate } from './features/Repositories';
import { RepositorySettings } from './features/RepositorySettings';
import { IncomingSource } from './features/IncomingSource';
import { SyncWorkflow, type SyncStep } from './features/SyncWorkflow';
import { AppShell } from './ui/AppShell';
import { Badge, Button, Dialog, DialogBody, DialogFooter, DialogHeader, EmptyState, GlobalStyle, IconButton, Muted, Overlay, Row, Status, Surface } from './ui/components';
declare global { interface Window { reposync: API } }
const api = window.reposync;
const initialProfile = (): Profile => ({ id: crypto.randomUUID(), name: '', role: 'internal', sources: {}, exclusions: [], includeIgnored: [], maxPartMB: 1, transportMode: 'compact' });
export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(() => { try { return localStorage.getItem('reposync-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  const [selected, setSelected] = useState(''); const [draft, setDraft] = useState<Profile | null>(null);
  const [appSettings, setAppSettings] = useState(false);
  const [busy, setBusy] = useState(false); const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [direction, setDirection] = useState<Direction>('outgoing'); const [step, setStep] = useState<SyncStep | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null); const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [kept, setKept] = useState<string[]>([]); const [override, setOverride] = useState(false);
  const [exported, setExported] = useState<string[]>([]); const [replacement, setReplacement] = useState<ReplacementPreview | null>(null);
  const [commits, setCommits] = useState<CommitOption[]>([]);
  const [incomingSelection, setIncomingSelection] = useState<IncomingSelection>({ mode: 'commit' });
  const [status, setStatus] = useState<{ incoming?: number; outgoing?: number }>({});
  const pending = useRef<Promise<void> | null>(null); const active = useRef(false);
  const profile = settings?.profiles.find(item => item.id === selected);
  const locked = busy || previewBusy;
  async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (active.current) return undefined;
    active.current = true; setBusy(true); setError('');
    try { await pending.current; return await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция не выполнена'); return undefined; }
    finally { active.current = false; setBusy(false); }
  }
  useEffect(() => { void run(async () => setSettings(await api.settings())); }, []);
  function reset(): void { setStep(null); setAnalysis(null); setImportPreview(null); setKept([]); setOverride(false); setExported([]); setError(''); setNotice(''); setStatus({}); }
  function home(): void { reset(); setSelected(''); }
  async function refresh(current: Profile): Promise<void> {
    if (current.role !== 'internal' || current.pending || !current.sources.internal || !current.sources.global) return;
    const outgoing = await api.analyze(current.id, 'outgoing'); setStatus({ outgoing: outgoing.entries.length });
  }
  function open(current: Profile): void { reset(); setSelected(current.id); if (current.role === 'internal') void run(() => refresh(current)); }
  async function begin(next: Direction, current: Profile | undefined = profile): Promise<void> {
    if (!current) return;
    reset(); setSelected(current.id); setDirection(next);
    if (next === 'incoming') {
      setCommits([]); setStep('source');
      const source = current.sources.global;
      if (!source) throw new Error('Настройте внешний Git.');
      await api.refreshSource(source); setCommits(await api.listCommits(source)); return;
    }
    const result = await api.analyze(current.id, next); setAnalysis(result); setStep('compare');
  }
  async function compareIncoming(selection: IncomingSelection): Promise<void> {
    if (!profile) return;
    setIncomingSelection(selection); setImportPreview(null);
    const result = await api.analyze(profile.id, 'incoming', selection);
    setAnalysis(result); setStep('compare');
  }
  async function importPackage(current: Profile | undefined = profile): Promise<void> {
    if (!current?.sources.internal) throw new Error('Сначала настройте локальный репозиторий');
    const file = await api.choosePackage(); if (!file) return;
    reset(); setSelected(current.id); const result = await api.preflight(file, current.sources.internal.location, current.id); setDirection('incoming'); setImportPreview(result); setStep('apply');
  }
  const comparison: CodeComparison | null = importPreview ? { token: importPreview.token, from: importPreview.sourceState, to: importPreview.targetState, entries: importPreview.entries, lineChanges: importPreview.lineChanges } : analysis ? { token: analysis.token, from: analysis.sourceState, to: analysis.state, entries: analysis.entries, lineChanges: analysis.lineChanges } : null;
  function exclude(finding: Finding): void { if (analysis) void run(async () => { const result = await api.excludeFinding(analysis.token, finding.id); setSettings(result.settings); setAnalysis(result.analysis); setKept([]); setOverride(false); }); }
  function replace(finding: Finding): void { if (analysis) void run(async () => setReplacement(await api.previewReplacement(analysis.token, finding.id))); }
  function showFinding(finding: Finding): void { if (analysis) void run(() => api.openFinding(analysis.token, finding.id)); }
  return <><GlobalStyle /><AppearanceStyle $appearance={appearance} /><AppShell appearance={appearance} disabled={locked} toggleTheme={() => { const next = appearance === 'dark' ? 'light' : 'dark'; setAppearance(next); try { localStorage.setItem('reposync-theme', next); } catch { /* optional preference */ } }} repositories={home} settings={() => setAppSettings(true)}>
    {busy && <BusyNotice role="status">Выполняется операция…</BusyNotice>}{error && !draft && !step && <Status $error role="alert">{error}</Status>}{notice && <Status role="status">{notice}</Status>}
    {!settings ? <Muted>Загрузка репозиториев…</Muted> : !profile ? <><Row style={{ justifyContent: 'space-between', marginBottom: 28 }}><div><h1>Репозитории</h1><Muted style={{ margin: 0 }}>Синхронизация изменений между репозиториями.</Muted></div><Button $primary disabled={locked} onClick={() => { setError(''); setDraft(initialProfile()); }}><Icon name="plus" />Добавить репозиторий</Button></Row>{settings.profiles.length ? settings.profiles.map(current => <RepositoryCard key={current.id} profile={current} busy={locked} open={() => open(current)} incoming={() => void run(() => begin('incoming', current))} outgoing={() => void run(() => begin('outgoing', current))} importPackage={() => void run(() => importPackage(current))} />) : <EmptyState title="Репозитории ещё не добавлены"><Muted>Добавьте репозиторий, чтобы получать изменения из Git или создавать пакеты .md.</Muted><Button $primary disabled={locked} onClick={() => setDraft(initialProfile())}><Icon name="plus" />Добавить репозиторий</Button></EmptyState>}</> : <>
      <Row style={{ justifyContent: 'space-between', marginBottom: 24 }}><IconButton disabled={locked} onClick={home}><Icon name="back" />Репозитории</IconButton><IconButton disabled={locked || !!step} aria-label="Настроить репозиторий" onClick={() => { setError(''); setDraft(profile); }}><Icon name="settings" /></IconButton></Row><Row><h1 style={{ margin: 0 }}>{profile.name}</h1><Badge>{profile.role === 'internal' ? 'Внутренний' : 'Внешний'}</Badge></Row><Muted style={{ margin: '10px 0 28px' }}><code>{profile.sources.internal?.location ?? 'Укажите локальный репозиторий в настройках'}</code> · {profile.sources.internal?.branch}</Muted>
      {!step ? <>
        {profile.pending ? <Surface><h2>Пакет ожидает подтверждения</h2><Muted>Примените все части пакета на внешнем компьютере. После успешного применения нажмите «Подтвердить применение».</Muted>{profile.pending.paths.map(file => <p key={file}><code>{file}</code></p>)}<Row><Button $primary disabled={locked} onClick={() => void run(async () => { setSettings(await api.confirmTransfer(profile.id)); setNotice('Применение подтверждено. Состояние синхронизации обновлено.'); })}>Подтвердить применение</Button><Button disabled={locked} onClick={() => void run(async () => { setSettings(await api.discardPending(profile.id)); setNotice('Ожидание отменено. Файлы пакета сохранены на диске.'); })}>Отменить ожидание</Button></Row></Surface> : profile.role === 'internal' ? <Surface style={{ padding: 36 }}><h2>Синхронизация</h2><div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 48px minmax(0, 1fr)', gap: 24, margin: '32px 0' }}><div><Badge>Внешний</Badge><Muted><code>{profile.sources.global?.location ?? 'Настройте внешний Git'}</code><br />{profile.sources.global?.branch}</Muted><p>{status.incoming === undefined ? 'Выберите коммит для сравнения' : `Изменено файлов: ${status.incoming}`}</p><Button $primary disabled={locked || !profile.sources.global || !profile.sources.internal} onClick={() => void run(() => begin('incoming'))}><Icon name="import" />Получить изменения</Button></div><div style={{ alignSelf: 'center', color: 'var(--muted)' }}><Icon name="sync" /></div><div><Badge>Внутренний</Badge><Muted><code>{profile.sources.internal?.location}</code><br />{profile.sources.internal?.branch}</Muted><p>{status.outgoing === undefined ? 'Изменения ещё не проверены' : `Изменено файлов: ${status.outgoing}`}</p><Button disabled={locked || !profile.sources.internal} onClick={() => void run(() => begin('outgoing'))}><Icon name="arrow" />Подготовить пакет изменений</Button></div></div><Row style={{ justifyContent: 'space-between' }}><small>Последняя синхронизация: {syncDate(profile.syncedAt)}</small><Button disabled={locked} onClick={() => void run(() => refresh(profile))}>Проверить изменения</Button></Row>{profile.commitRequired && <Status>Перед подготовкой следующего пакета создайте коммит с применёнными изменениями.</Status>}<details style={{ marginTop: 20 }}><summary>Подробности</summary><p><code>{profile.baseline?.state ?? 'Состояние синхронизации ещё не сохранено'}</code></p><small>Файлов в общем состоянии: {profile.baseline?.files.length ?? 0}.</small></details></Surface> : <EmptyState title="Пакет изменений"><Muted>Выберите любую часть пакета .md. Все части должны лежать в одной папке с исходными именами. Перед применением вы увидите изменения.</Muted><Button $primary disabled={locked || !profile.sources.internal} onClick={() => void run(() => importPackage())}><Icon name="import" />Выбрать пакет</Button></EmptyState>}
      </> : step === 'source' ? <IncomingSource branch={profile.sources.global?.branch ?? ''} commits={commits} busy={locked} error={error} close={reset} reload={() => void run(() => begin('incoming'))} compare={selection => void run(() => compareIncoming(selection))} /> : <>
        <SyncWorkflow profile={profile} settings={settings} direction={direction} step={step} analysis={analysis} importPreview={importPreview} comparison={comparison} kept={kept} override={override} exported={exported} busy={busy} locked={locked} error={error} retryComparison={() => void run(() => profile.role === 'external' ? importPackage() : direction === 'incoming' ? compareIncoming(incomingSelection) : begin(direction))} pending={pending} setPreviewBusy={setPreviewBusy} setStep={setStep} setOverride={setOverride} close={reset} chooseIncoming={() => void run(() => begin('incoming'))} keep={(ids, retained) => setKept(previous => retained ? [...new Set([...previous, ...ids])] : previous.filter(id => !ids.includes(id)))} exclude={exclude} replace={replace} showFinding={showFinding}
          completeReview={() => { if (direction === 'outgoing') setStep('package'); else if (analysis) void run(async () => { setImportPreview(await api.prepareIncoming(analysis.token)); setStep('apply'); }); }}
          chooseOutput={() => void run(async () => { const directory = await api.chooseDirectory(); if (directory) setSettings(await api.setOutputDirectory(directory)); })}
          exportPackage={() => { if (analysis) void run(async () => { setExported(await api.exportPackage(analysis.token, kept, override)); setSettings(await api.settings()); setStep('done'); }); }}
          apply={() => { if (importPreview) void run(async () => { setSettings(await api.applyImport(importPreview.token)); setStep('done'); setAnalysis(null); }); }}
          openRepository={() => void run(() => api.openRepository(profile.id))} />
      </>}
    </>}
  </AppShell>
  {draft && <RepositorySettings key={draft.id} profile={draft} busy={locked} error={error} close={() => { setDraft(null); setError(''); }} choose={async () => await run(() => api.chooseDirectory()) ?? null} branches={async source => {
    const result = await run(async () => {
      try { return { ok: true as const, value: await api.listBranches(source) }; }
      catch (cause) { return { ok: false as const, message: cause instanceof Error ? cause.message : 'Не удалось загрузить ветки. Повторите попытку.' }; }
    });
    if (!result) throw new Error('Дождитесь завершения текущей операции и повторите загрузку веток.');
    if (!result.ok) throw new Error(result.message);
    return result.value;
  }} save={next => void run(async () => { setSettings(await api.saveProfile(next)); setSelected(next.id); setDraft(null); reset(); })} remove={() => { if (!settings?.profiles.some(p => p.id === draft.id)) { setDraft(null); return; } void run(async () => { setSettings(await api.deleteProfile(draft.id)); setDraft(null); home(); }); }} />}
  {appSettings && <Overlay><Dialog onClose={() => setAppSettings(false)} locked={locked} role="dialog" aria-modal="true" aria-labelledby="app-settings-title"><DialogHeader><h2 id="app-settings-title">Настройки</h2><IconButton aria-label="Закрыть" disabled={locked} onClick={() => setAppSettings(false)}><Icon name="close" /></IconButton></DialogHeader><DialogBody>{error && <Status $error role="alert">{error}</Status>}<h3>Папка для пакетов</h3><code>{settings?.outputDirectory || 'Не выбрана'}</code><Button disabled={locked || !!step} onClick={() => void run(async () => { const directory = await api.chooseDirectory(); if (directory) setSettings(await api.setOutputDirectory(directory)); })}>Выбрать папку</Button><Muted>RepoSync работает локально, без телеметрии. Тип «Внутренний» или «Внешний» задаётся для каждого репозитория.</Muted>{step && <small>Папку можно выбрать на шаге «Пакет» или после закрытия синхронизации.</small>}</DialogBody></Dialog></Overlay>}
  {replacement && <Overlay><Dialog onClose={() => setReplacement(null)} locked={locked} role="dialog" aria-modal="true" aria-labelledby="replacement-title"><DialogHeader><h2 id="replacement-title">Замена в исходнике</h2></DialogHeader><DialogBody>{error && <Status $error role="alert">{error}</Status>}<code>{replacement.path}:{replacement.line}</code><p><code>{replacement.preview} → {replacement.replacement}</code></p><Status>Замена изменит локальный файл. Создайте коммит и повторите синхронизацию, чтобы учесть её в пакете.</Status></DialogBody><DialogFooter><Button $primary disabled={locked} onClick={() => void run(async () => { await api.applyReplacement(replacement.token); setReplacement(null); reset(); setNotice('Замена выполнена. Создайте коммит и повторите синхронизацию.'); })}>Выполнить замену</Button><Button disabled={locked} onClick={() => setReplacement(null)}>Отмена</Button></DialogFooter></Dialog></Overlay>}
  </>;
}
