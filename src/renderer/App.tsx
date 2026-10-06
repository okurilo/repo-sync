import { BranchPicker } from './BranchPicker';
import { AppearanceStyle, BusyNotice, ExportActions, Icon, ScanFile, ScanWorkspace, reveal, type Appearance } from './Appearance';
import { Comparison } from './Comparison';
import { useEffect, useRef, useState } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import type { API, Analysis, CommitOption, Environment, ImportPreview, Operation, PackageType, Profile, ReplacementPreview, Settings, Source } from '../shared/types';

declare global { interface Window { reposync: API } }
const api = window.reposync;
const GlobalStyle = createGlobalStyle({
  '*': { boxSizing: 'border-box' }, body: { margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: 'var(--text)', background: 'var(--bg)', fontSize: 14 },
  button: { font: 'inherit', cursor: 'pointer' }, input: { font: 'inherit' }, textarea: { font: 'inherit' }, select: { font: 'inherit' },
  'button:disabled': { opacity: 0.5, cursor: 'wait' }, 'input, textarea, select': { width: '100%', minWidth: 0, maxWidth: '100%', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)' },
  'input[type=checkbox]': { width: 'auto' }, 'input:focus, textarea:focus, select:focus': { outline: '2px solid #b6c4ff', outlineOffset: 1 },
  label: { display: 'grid', gap: 8, alignContent: 'start' }, h1: { fontSize: 28, margin: '0 0 10px', letterSpacing: '-0.7px' }, h2: { fontSize: 19, margin: '0 0 14px' }, h3: { fontSize: 15, margin: '0 0 10px' },
  p: { lineHeight: 1.6 }, small: { color: 'var(--muted)' }, code: { fontSize: 12, overflowWrap: 'anywhere' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 }, 'td, th': { textAlign: 'left', padding: '11px 10px', borderBottom: '1px solid var(--line)', overflowWrap: 'anywhere' },
  th: { color: 'var(--muted)', fontWeight: 500 }, 'a, summary': { color: 'var(--accent)', cursor: 'pointer' }, fieldset: { border: 0, margin: 0, padding: 0, minWidth: 0 },
});
const Layout = styled('div')({ display: 'grid', gridTemplateColumns: '196px minmax(0, 1fr)', '@media(max-width: 760px)': { gridTemplateColumns: 'minmax(0, 1fr)' }, minHeight: '100vh' });
const Sidebar = styled('aside')({ background: 'var(--surface)', borderRight: '1px solid var(--line)', padding: '24px 16px', position: 'sticky', top: 0, height: '100dvh', '@media(max-width: 760px)': { position: 'relative', height: 'auto', gap: 12 }, display: 'flex', flexDirection: 'column', gap: 28 });
const Brand = styled('div')({ fontWeight: 750, fontSize: 22, letterSpacing: '-0.8px', display: 'flex', gap: 10, alignItems: 'center' });
const Logo = styled('span')({ display: 'inline-grid', placeItems: 'center', width: 34, height: 34, background: 'linear-gradient(135deg, #6385ff, #405bcc)', boxShadow: '0 0 24px #547cff35', borderRadius: 10, color: '#fff', fontSize: 24 });
const Nav = styled('button')<{ $active?: boolean }>(({ $active }) => ({ width: '100%', border: 0, background: $active ? 'var(--tint)' : 'transparent', color: $active ? 'var(--accent)' : 'var(--muted)', textAlign: 'left', overflowWrap: 'anywhere', padding: '12px 14px', borderRadius: 9, fontWeight: $active ? 650 : 500, marginBottom: 5 }));
const Main = styled('main')({ padding: '30px clamp(18px, 3vw, 44px)', maxWidth: 1600, width: '100%' });
const Row = styled('div')({ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' });
const Header = styled(Row)({ justifyContent: 'space-between', marginBottom: 28 });
const Muted = styled('p')({ color: 'var(--muted)', margin: '0 0 20px' });
const Badge = styled('span')({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 20, background: 'var(--tint)', color: 'var(--accent)', fontSize: 12, fontWeight: 650 });
const Button = styled('button')<{ $primary?: boolean; $danger?: boolean }>(({ $primary, $danger }) => ({ border: $primary ? '1px solid #425dd8' : '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', background: $primary ? '#425dd8' : 'var(--surface)', color: $primary ? '#fff' : $danger ? 'var(--danger)' : 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', boxShadow: $primary ? '0 4px 14px #425dd82b' : 'none', display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'center' }));
const Card = styled('section')({ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: '0 6px 24px #00000010', animation: `${reveal} 200ms ease-out` });
const Grid = styled('div')({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 });
const Stat = styled('div')({ background: 'var(--raised)', borderRadius: 8, padding: 14, display: 'grid', gap: 6, '& strong': { fontSize: 22 }, '& span': { color: 'var(--muted)', fontSize: 12 } });
const ExportSummary = styled('div')({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(200px, 0.6fr)', gap: 24, padding: 24, marginBottom: 20, border: '1px solid var(--line)', borderRadius: 12, background: 'linear-gradient(120deg, var(--tint), var(--raised))', '@media (max-width: 900px)': { gridTemplateColumns: 'minmax(0, 1fr)' } });
const ExportCount = styled('strong')({ display: 'block', fontSize: 48, lineHeight: 1.1, fontWeight: 750, letterSpacing: '-2px', color: 'var(--accent)', margin: '8px 0' });
const CommitPath = styled(Row)({ gap: 10, marginBottom: 20, '& code': { padding: '8px 12px', border: '1px solid var(--line)', background: 'var(--raised)', borderRadius: 7, fontSize: 13 }, '& span': { color: 'var(--muted)', fontSize: 12 } });
const OperationStat = styled('div')<{ $color: string; $empty: boolean }>(({ $color, $empty }) => ({ minWidth: 0, padding: '16px 18px', border: `1px solid ${$color}25`, borderRadius: 10, background: `${$color}12`, opacity: $empty ? 0.8 : 1, '& strong': { display: 'block', fontSize: 28, color: 'var(--text)', marginBottom: 6, fontVariantNumeric: 'tabular-nums' }, '& span': { color: 'var(--muted)', fontSize: 12 } }));
const ChangeBar = styled('div')({ display: 'flex', height: 6, overflow: 'hidden', borderRadius: 6, background: 'var(--line)', margin: '16px 0 20px' });
const operationStats = [
  { operation: 'ADD', label: 'Добавлено', color: '#16805a' },
  { operation: 'MODIFY', label: 'Изменено', color: '#4260d2' },
  { operation: 'DELETE', label: 'Удалено', color: '#ca4054' },
  { operation: 'RENAME', label: 'Переименовано', color: '#8860c4' },
  { operation: 'REPLACE', label: 'Заменено целиком', color: '#ae6b22' },
] as const;
const FindingGroup = styled('section')({ border: '1px solid var(--line)', borderRadius: 10, marginBottom: 12, overflow: 'hidden' });
const FindingFile = styled(Row)({ justifyContent: 'space-between', gap: 10, padding: '12px 14px', background: 'var(--raised)', borderBottom: '1px solid var(--line)', '& strong': { fontSize: 15, overflowWrap: 'anywhere' }, '& small': { display: 'block', marginTop: 3, overflowWrap: 'anywhere' } });
const CompactButton = styled(Button)({ padding: '6px 10px', fontSize: 12 });
const FindingRow = styled('div')({ padding: '10px 14px', borderBottom: '1px solid var(--line)', '&:last-child': { borderBottom: 0 } });
const FindingCode = styled('pre')({ margin: '7px 0 0', padding: '8px 10px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.5 });
const Notice = styled('div')<{ $error?: boolean }>(({ $error }) => ({ padding: '14px 18px', marginBottom: 18, borderRadius: 9, background: $error ? 'var(--danger-bg)' : 'var(--success-bg)', color: $error ? 'var(--danger)' : 'var(--success)', animation: `${reveal} 180ms ease-out`, lineHeight: 1.6, overflowWrap: 'anywhere' }));
const Empty = styled(Card)({ padding: '56px 30px', textAlign: 'center' });
const Form = styled('div')({
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0, gap: 18,
  '& label': { minWidth: 0, gridTemplateColumns: 'minmax(0, 1fr)' },
  [`& ${Grid}`]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  [`& ${Row}`]: { flexDirection: 'column', alignItems: 'stretch', minWidth: 0 },
  [`& ${Button}`]: { maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere' },
  '& small': { overflowWrap: 'anywhere' },
});
const Overlay = styled('div')({ position: 'fixed', inset: 0, background: '#03070f99', backdropFilter: 'blur(10px)', animation: `${reveal} 180ms ease-out`, zIndex: 10, padding: 24, display: 'grid', placeItems: 'center' });
const Modal = styled(Card)({ width: 'min(650px, 100%)', maxHeight: 'calc(100dvh - 48px)', overflow: 'hidden', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' });
const ModalHeader = styled(Row)({ justifyContent: 'space-between', flexWrap: 'nowrap', padding: '20px 24px', flexShrink: 0, borderBottom: '1px solid var(--line)', '& h2': { margin: 0 } });
const ModalBody = styled('div')({ padding: 24, overflowY: 'auto', minHeight: 0 });
const ProfileModal = styled(Modal)({ width: 'min(1500px, 100%)', height: 'calc(100dvh - 48px)', justifySelf: 'end', boxShadow: '-20px 0 60px #00000040' });
const ProfileBody = styled(ModalBody)({ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)', gap: 24, overflow: 'hidden', '& > fieldset': { overflowY: 'auto', maxHeight: 'min(65vh, calc(100dvh - 220px))', paddingRight: 8 }, '@media (max-width: 1100px)': { gridTemplateColumns: '1fr', overflowY: 'auto' } });
const ModalFooter = styled('fieldset')({ padding: '16px 24px', flexShrink: 0, borderTop: '1px solid var(--line)' });
const CloseButton = styled(Button)({ padding: 0, width: 32, height: 32, flexShrink: 0, fontSize: 24, lineHeight: 1 });
const EnvironmentCard = styled(Card)({ display: 'flex', flexDirection: 'column', '& button': { marginTop: 'auto' } });
const Onboarding = styled('div')({ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 40 });
const Scroll = styled('div')({ maxHeight: 320, overflow: 'auto', marginTop: 16 });
const Check = styled('label')({ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 1.6 });
const bytes = (size: number): string => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(2)} MB`;
const short = (state: string | null | undefined): string => state ? state.startsWith('content:') ? `content:${state.slice(8, 16)}` : state.slice(0, 12) : '—';
function ChangeTable({ entries }: { entries: { path: string; oldPath?: string; operation: Operation; size: number }[] }): React.JSX.Element {
  return <details>
<summary>Файлы и операции ({entries.length})</summary>
<Scroll>
<table>
<thead>
<tr>
<th>Операция</th>
<th>Файл</th>
<th>Размер после</th>
</tr>
</thead>
<tbody>{entries.map(entry => <tr key={entry.path}>
<td>{entry.operation}</td>
<td>
<code>{entry.oldPath ? `${entry.oldPath} → ` : ''}{entry.path}</code>
</td>
<td>{bytes(entry.size)}</td>
</tr>)}</tbody>
</table>
</Scroll>
</details>;
}
export function App(): React.JSX.Element {
  const [appearance, setAppearance] = useState<Appearance>(() => { try { return localStorage.getItem('reposync-appearance') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  const [scanFile, setScanFile] = useState('');
  useEffect(() => { try { localStorage.setItem('reposync-appearance', appearance); } catch { /* optional UI preference */ } }, [appearance]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<'profiles' | 'import' | 'settings'>('profiles');
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [baseCommits, setBaseCommits] = useState<CommitOption[]>([]);
  const [commits, setCommits] = useState<CommitOption[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [packageType, setPackageType] = useState<PackageType>('snapshot');
  const [kept, setKept] = useState<string[]>([]);
  const [override, setOverride] = useState(false);
  const [replacement, setReplacement] = useState<ReplacementPreview | null>(null);
  const [remoteVersion, setRemoteVersion] = useState(0);
  const [remoteStatus, setRemoteStatus] = useState('');
  const foregroundBusy = useRef(false);
  const previewRequest = useRef<Promise<void> | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [packagePath, setPackagePath] = useState('');
  const [target, setTarget] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [exported, setExported] = useState<string[]>([]);
  foregroundBusy.current = busy || previewBusy;
  const mode = settings?.environment;
  const profile = settings?.profiles.find(p => p.id === selected);
  const source = mode && profile?.sources[mode];
  const baseline = mode && profile?.baselines[mode];
  const pending = mode && profile?.pending[mode];
  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true); setError(''); setNotice('');
    try { await previewRequest.current; await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Операция не выполнена'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void api.settings().then(value => { setSettings(value); setSelected(value.profiles[0]?.id ?? ''); }).catch(e => setError(String(e))); }, []);
  function reset(): void { setAnalysis(null); setImportPreview(null); setKept([]); setOverride(false); setExported([]); }
  async function compare(): Promise<void> { reset(); setAnalysis(await api.analyze(selected, packageType)); }
  function edit(item?: Profile): void {
    if (!mode) return;
    setBranches([]); setCommits([]); setBaseCommits([]);
    if (item?.sources[mode]?.location) void run(() => loadOptions(item.sources[mode]!));
    setDraft(item ? structuredClone(item) : { id: crypto.randomUUID(), name: '', sources: { [mode]: { kind: 'local', location: '', branch: 'main' } }, baselines: {}, pending: {}, exclusions: [], includeIgnored: [], maxPartMB: 100 });
  }
  async function exclude(findingId: string): Promise<void> {
    if (!analysis) return;
    const result = await api.excludeFinding(analysis.token, findingId);
    setSettings(result.settings); setAnalysis(result.analysis); setKept([]); setOverride(false);
    setNotice('Файл исключён из пакета. Preview и Security Scan обновлены.');
  }
  async function changeEnvironment(next: Environment): Promise<void> { setSettings(await api.setEnvironment(next)); reset(); }
  const backgroundSource = mode && draft ? draft.sources[mode] : undefined;
  const latestBackgroundSource = useRef(backgroundSource); latestBackgroundSource.current = backgroundSource;
  const backgroundKey = JSON.stringify([mode, backgroundSource?.kind, backgroundSource?.location, backgroundSource?.branch, backgroundSource?.base?.branch]);
  useEffect(() => {
    setRemoteStatus('');
    if (backgroundSource?.kind !== 'remote' || !backgroundSource.location) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const check = async (): Promise<void> => {
      if (!active) return;
      if (foregroundBusy.current) { timer = setTimeout(() => void check(), 1000); return; }
      try {
        const result = await api.refreshSource(backgroundSource);
        if (!active) return;
        setBranches(result.branches); setCommits(result.commits); setBaseCommits(result.baseCommits);
        if (result.changedBranches.length) {
          setRemoteStatus('Ветки обновлены в фоне. Конкретный выбранный SHA сохранён.');
          const selected = latestBackgroundSource.current;
          const mutable = selected && ((!selected.commit && result.changedBranches.includes(selected.branch)) || (selected.base && !selected.base.commit && result.changedBranches.includes(selected.base.branch)));
          if (mutable) { setRemoteVersion(value => value + 1); reset(); }
        } else setRemoteStatus('Загружено из локального кэша · ветки проверены в фоне');
      } catch { if (active) setRemoteStatus('Работа из локального кэша · сеть сейчас недоступна'); }
      finally { if (active) timer = setTimeout(() => void check(), 60_000); }
    };
    timer = setTimeout(() => void check(), 1500);
    return () => { active = false; clearTimeout(timer); };
  }, [backgroundKey]);
  const findingGroups = Object.entries((analysis?.findings ?? []).reduce<Record<string, Analysis['findings']>>((groups, finding) => {
    (groups[finding.path] ??= []).push(finding); return groups;
  }, {}));
  const content = !settings ? <Onboarding>
<div>{error || 'Загрузка RepoSync…'}</div>
</Onboarding> : !mode ? <Onboarding>
<div style={{ maxWidth: 720 }}>
<Brand>
<Logo><Icon name="sync" /></Logo>RepoSync</Brand>
<h1 style={{ marginTop: 40 }}>Где запущен RepoSync?</h1>
<Muted>Выберите контур. Изменить его можно в Settings.</Muted>
<Grid>{(['internal', 'global'] as const).map(value => <EnvironmentCard key={value}>
<h2><Icon name={value === 'internal' ? 'internal' : 'globe'} /> {value === 'internal' ? 'Internal' : 'Global'}</h2>
<Muted>{value === 'internal' ? 'Корпоративный контур. Внешний Git недоступен.' : 'Есть доступ к внешнему Git. Источник задаёте вы.'}</Muted>
<Button disabled={busy} $primary onClick={() => void run(() => changeEnvironment(value))}>Выбрать {value}</Button>
</EnvironmentCard>)}</Grid>{error && <Notice $error>{error}</Notice>}<small>Локальная работа · Без telemetry · Ручной перенос пакетов</small>
</div>
</Onboarding> : <Layout>
    <Sidebar>
<Brand>
<Logo><Icon name="sync" /></Logo>RepoSync</Brand>
<div>
<Nav $active={tab === 'profiles'} onClick={() => setTab('profiles')}><Icon name="profiles" /> &nbsp; Профили</Nav>
<Nav $active={tab === 'import'} onClick={() => setTab('import')}><Icon name="import" /> &nbsp; Импорт</Nav>
<Nav $active={tab === 'settings'} onClick={() => setTab('settings')}><Icon name="settings" /> &nbsp; Настройки</Nav>
</div>
{settings.profiles.length > 0 && <div style={{ overflowY: 'auto', minHeight: 0 }}><small style={{ display: 'block', padding: '0 12px 8px', fontSize: 10, letterSpacing: 1.5 }}>РЕПОЗИТОРИИ</small>{settings.profiles.map(p => <Nav key={p.id} $active={p.id === selected && tab === 'profiles'} disabled={busy || previewBusy} onClick={() => { setSelected(p.id); setTab('profiles'); reset(); }}><Icon name="profiles" /> &nbsp; {p.name}</Nav>)}</div>}
<div style={{ marginTop: 'auto' }}>
<Badge><Icon name={mode === 'internal' ? 'internal' : 'globe'} /> {mode === 'internal' ? 'Internal' : 'Global'}</Badge>
<p>
<small>Пакеты переносите вручную.<br />Данные остаются под вашим контролем.</small>
</p>
<Button aria-label="Переключить тему" onClick={() => setAppearance(value => value === 'dark' ? 'light' : 'dark')}><Icon name={appearance === 'dark' ? 'sun' : 'moon'} />{appearance === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</Button><p><small>RepoSync · локальная работа</small></p>
</div>
</Sidebar>
    <Main>
<Header>
<div>
<h1>{tab === 'profiles' ? 'Профили синхронизации' : tab === 'import' ? 'Импорт пакета' : 'Настройки'}</h1>
<Muted style={{ marginBottom: 0 }}>{tab === 'profiles' ? 'Переносите состояние Git между изолированными контурами.' : tab === 'import' ? 'Проверка всех .md и бинарных вложений, затем preview и применение.' : 'Режим среды и локальные настройки приложения.'}</Muted>
</div>{tab === 'profiles' && <Button $primary disabled={busy} onClick={() => edit()}>+ Новый профиль</Button>}</Header>
      {busy && <BusyNotice role="status">Операция выполняется локально…</BusyNotice>}{error && <Notice $error role="alert">{error}</Notice>}{notice && <Notice role="status">{notice}</Notice>}
      <fieldset disabled={busy}>
      {tab === 'profiles' && <>
        {settings.profiles.length === 0 ? <Empty>
<h2>Первый перенос начинается с профиля</h2>
<Muted>Укажите Git repository, branch и правила исключений.</Muted>
<Button $primary onClick={() => edit()}>Создать профиль</Button>
</Empty> : <>
          {profile && <Card>
<Header style={{ marginBottom: 16 }}>
<div>
<h2>{profile.name}</h2>
<code>{source?.location || 'Источник для этой среды ещё не задан'}</code>
</div>
<Button onClick={() => edit(profile)}>Настроить</Button>
</Header>
<Row>
<Badge>{source?.kind === 'remote' ? 'Remote Git' : 'Local Git'}</Badge>
<small>Ветка: {source?.branch ?? '—'} · Коммит: {source?.commit ? short(source.commit) : 'последний в ветке'}</small>
</Row>
<Grid style={{ marginTop: 22 }}>
<Stat>
<span>{mode === 'global' ? 'Последняя синхронизация' : 'Последняя синхронизация'}</span>
<strong>{short(baseline?.state)}</strong>
</Stat>
<Stat>
<span>{source?.kind === 'remote' ? 'Целевой коммит' : 'Целевой коммит'}</span>
<strong>{short(analysis?.state)}</strong>
</Stat>
<Stat>
<span>Максимальный размер части</span>
<strong>{profile.maxPartMB} MB</strong>
</Stat>
</Grid>
            {pending ? <Notice style={{ marginTop: 20, marginBottom: 0 }}>
<h3>Пакет ожидает подтверждения передачи</h3>
<p>Baseline обновится только после вашего подтверждения.</p>
<details>
<summary>Файлы пакета</summary>{pending.paths.map(name => <p key={name}>
<code>{name}</code>
</p>)}</details>
<Row style={{ marginTop: 14 }}>
<Button $primary onClick={() => void run(async () => { setSettings(await api.confirmTransfer(profile.id)); reset(); setNotice('Передача подтверждена. Baseline обновлён.'); })}>Пакет успешно перенесён</Button>
<Button onClick={() => void run(async () => { setSettings(await api.discardPending(profile.id)); reset(); setNotice('Pending отменён. Предыдущий baseline сохранён; файлы пакета не удалены.'); })}>Отменить pending</Button>
</Row>
</Notice> : <Row style={{ marginTop: 22 }}>
<select aria-label="Тип пакета" style={{ width: 310 }} value={packageType} onChange={e => { setPackageType(e.target.value as PackageType); reset(); }}>
<option value="snapshot">Full Snapshot</option>
<option value="diff">{source?.base ? 'Diff между выбранными коммитами' : 'Diff от last sync'}</option>
</select>
<Button $primary disabled={!source} onClick={() => void run(compare)}>Compare и Security Scan</Button>
{packageType === 'diff' && <small>{source?.base ? `От: ${source.base.branch} / ${short(source.base.commit) === '—' ? 'последний коммит' : short(source.base.commit)} → До: ${source.branch} / ${source.commit ? short(source.commit) : 'последний коммит'}` : 'От последнего синхронизированного состояния. Два произвольных коммита можно выбрать в настройках профиля.'}</small>}
</Row>}
          </Card>}
          {analysis && <>
            <Card>
<Header style={{ marginBottom: 18 }}>
<div><h2 style={{ marginBottom: 6 }}>Предпросмотр пакета</h2><Muted style={{ margin: 0 }}>{analysis.packageType === 'diff' ? 'Разница между исходным и целевым состоянием' : 'Полный снимок целевого состояния'}</Muted></div>
<Badge>{analysis.packageType === 'diff' ? 'DIFF' : 'FULL SNAPSHOT'}</Badge>
</Header>
<CommitPath><span>ОТ</span><code title={analysis.sourceState ?? 'Полный снимок без исходного состояния'}>{analysis.sourceState ? short(analysis.sourceState) : 'Пустое состояние'}</code><span aria-hidden="true">→</span><span>ДО</span><code title={analysis.state}>{short(analysis.state)}</code></CommitPath>
<ExportSummary>
<div><span style={{ color: 'var(--muted)', fontWeight: 600 }}>{analysis.packageType === 'diff' ? 'Файлов в Diff' : 'Файлов в полном снимке'}</span><ExportCount>{analysis.entries.length.toLocaleString('ru-RU')}</ExportCount><small>{analysis.entries.length === 0 ? (analysis.packageType === 'diff' ? 'Изменений нет — выбранные состояния совпадают в рамках исключений.' : 'В снимке нет файлов с учётом исключений.') : analysis.packageType === 'diff' ? 'В пакет входят только изменения этих файлов.' : 'В пакет входит полное содержимое этих файлов.'}</small></div>
<div style={{ borderLeft: '3px solid var(--line)', paddingLeft: 20, display: 'grid', alignContent: 'center', gap: 8 }}><small>Размер переносимого пакета</small><strong style={{ fontSize: 26, fontVariantNumeric: 'tabular-nums' }}>{bytes(analysis.estimatedBytes)}</strong><small>Файлов для переноса: <strong style={{ color: 'var(--text)' }}>{analysis.parts}</strong> · Лимит части: {profile?.maxPartMB} MB</small></div>
</ExportSummary>
<Grid style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>{operationStats.map(stat => <OperationStat key={stat.operation} $color={stat.color} $empty={analysis.changes[stat.operation] === 0}><strong>{analysis.changes[stat.operation].toLocaleString('ru-RU')}</strong><span>{stat.label}</span></OperationStat>)}</Grid>
<ChangeBar style={{ transition: 'width 200ms ease' }} role="img" aria-label={operationStats.map(stat => `${stat.label}: ${analysis.changes[stat.operation]}`).join(', ')}>{operationStats.map(stat => <div key={stat.operation} style={{ width: `${100 * analysis.changes[stat.operation] / Math.max(1, analysis.entries.length)}%`, background: stat.color }} />)}</ChangeBar>
<Row style={{ marginBottom: 20, gap: 18, color: 'var(--muted)', fontSize: 12 }}><span>Всего файлов в целевом состоянии: <strong style={{ color: 'var(--text)' }}>{analysis.files}</strong></span><span>Исключено Git: {analysis.excludedGit}</span><span>Исключено правилами RepoSync: {analysis.excludedCustom}</span></Row>
<small style={{ display: 'block', marginBottom: 12 }}>Открытый текст и diff · бинарные вложения в исходном формате</small><ChangeTable entries={analysis.entries} />
              {analysis.local && <Notice style={{ marginTop: 18 }}>Экспортируется состояние выбранного commit. Staged: {analysis.workingChanges.staged}, unstaged: {analysis.workingChanges.unstaged}, untracked: {analysis.workingChanges.untracked}. Незакоммиченные изменения не входят в пакет.</Notice>}
              {analysis.local && analysis.ignored.length > 0 && <details>
<summary>Ignored-файлы: вернуть вручную</summary>
<p>Предупреждение: ignored-файлы часто содержат .env, credentials и secrets.</p>
<Scroll>{analysis.ignored.map(name => <Row key={name} style={{ justifyContent: 'space-between', marginBottom: 8 }}>
<code>{name}</code>
<Button onClick={() => void run(async () => { if (!profile) return; setSettings(await api.saveProfile({ ...profile, includeIgnored: [...new Set([...profile.includeIgnored, name])] })); await compare(); })}>Вернуть в пакет</Button>
</Row>)}</Scroll>
</details>}
            </Card>
            <Card>
<Header style={{ marginBottom: 12 }}>
<div><h2 style={{ marginBottom: 4 }}>Security Scan</h2><small>Локальная проверка · подсвечены найденные совпадения</small></div>
<Badge>{analysis.findings.length ? `${analysis.findings.length} срабатываний · ${findingGroups.length} файлов` : '✓ Срабатываний нет'}</Badge>
</Header>
{analysis.findings.length > 0 && <>
<Row style={{ marginBottom: 12, fontSize: 12, color: 'var(--muted)' }}><span>Блокируют: <strong style={{ color: 'var(--danger)' }}>{analysis.findings.filter(f => f.severity === 'block').length}</strong></span><span>Нужна проверка: {analysis.findings.filter(f => f.severity === 'warning').length}</span><span>Решений принято: {kept.length} / {analysis.findings.length}</span><CompactButton onClick={() => setKept(analysis.findings.map(f => f.id))}>Игнорировать все без решения</CompactButton><details><summary>О правилах проверки</summary><p>Проверка эвристическая. Правило имён EN ищет два слова с заглавных букв и может совпасть с названием компонента. Подсвечено найденное значение в исходном тексте. Для ложного срабатывания выберите «Оставить».</p></details></Row>
<ScanWorkspace><nav aria-label="Файлы Security Scan">{findingGroups.map(([file, items]) => <ScanFile key={file} $selected={file === (findingGroups.some(([name]) => name === scanFile) ? scanFile : findingGroups[0]?.[0])} onClick={() => setScanFile(file)}><strong><Icon name="file" /> {file.split('/').at(-1)}</strong><small>{file} · {items.length} совпадений</small></ScanFile>)}</nav><Scroll style={{ maxHeight: 390, marginTop: 0 }}>{findingGroups.filter(([file]) => file === (findingGroups.some(([name]) => name === scanFile) ? scanFile : findingGroups[0]?.[0])).map(([file, findings]) => <FindingGroup key={file} aria-label={`Срабатывания в ${file}`}>
<FindingFile><div style={{ minWidth: 0, flex: '1 1 260px' }}><strong title={file}><Icon name="file" /> {file.split('/').at(-1)}</strong><small><code>{file}</code> · {findings.length} срабатываний</small></div><Row style={{ gap: 6 }}><CompactButton title={`Открыть ${file}`} onClick={() => void run(() => api.openFinding(analysis.token, findings[0]!.id))}>Открыть файл ↗</CompactButton><CompactButton $danger title={`Исключить ${file} целиком`} onClick={() => void run(() => exclude(findings[0]!.id))}>Исключить файл</CompactButton></Row></FindingFile>
{findings.map(finding => <FindingRow key={finding.id}>
<Row style={{ justifyContent: 'space-between', gap: 8 }}><Row style={{ gap: 8, flex: '1 1 300px' }}><span style={{ fontSize: 11, fontWeight: 650, color: finding.severity === 'block' ? 'var(--danger)' : 'var(--warning)', background: finding.severity === 'block' ? 'var(--danger-bg)' : 'var(--warning-bg)', borderRadius: 4, padding: '3px 6px' }}>{finding.severity === 'block' ? 'Блокирует' : 'Проверить'}</span><span style={{ fontSize: 12 }}>{finding.reason}</span><button title={`${file} · ${finding.context?.location ?? `строка ${finding.line}`}`} style={{ border: 0, padding: '2px 4px', background: 'transparent', color: 'var(--accent)', fontSize: 12 }} onClick={() => void run(() => api.openFinding(analysis.token, finding.id))}>стр. {finding.line} ↗</button></Row><Row style={{ gap: 8 }}><CompactButton disabled={!finding.canRedact} title={finding.canRedact ? 'Заменить совпадение на *** только в пакете, сохранить файл' : 'Совпадение в удалённой строке, имени файла или неподдерживаемом фрагменте'} onClick={() => void run(async () => { const next = await api.redactFinding(analysis.token, finding.id); setAnalysis(next); setKept([]); setOverride(false); setNotice('Значение заменено на *** в пакете. Исходный файл сохранён без изменений; Scan обновлён.'); })}>Заменить на ***</CompactButton>{finding.canReplace && <CompactButton onClick={() => void run(async () => setReplacement(await api.previewReplacement(analysis.token, finding.id)))}>Заменить</CompactButton>}<Check style={{ fontSize: 12, gap: 6 }}><input type="checkbox" checked={kept.includes(finding.id)} onChange={e => setKept(previous => e.target.checked ? [...previous, finding.id] : previous.filter(id => id !== finding.id))} />Оставить</Check></Row></Row>
{finding.context ? <FindingCode title={`${finding.context.location} · ${finding.preview}`}><code>{finding.context.before}<mark style={{ background: finding.severity === 'block' ? '#ffd5dc' : '#ffedb5', borderRadius: 3 }}>{finding.context.match}</mark>{finding.context.after}</code></FindingCode> : <small>{finding.preview}</small>}
</FindingRow>)}
</FindingGroup>)}</Scroll></ScanWorkspace>{analysis.findings.some(f => f.severity === 'block') && <Check style={{ marginTop: 20 }}>
<input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />Я явно разрешаю экспорт обнаруженных secrets и понимаю, что они попадут в переносимый пакет.</Check>}</>}
              <ExportActions>
<Button $primary disabled={!settings.outputDirectory || analysis.findings.some(f => !kept.includes(f.id)) || (analysis.findings.some(f => f.severity === 'block') && !override)} onClick={() => void run(async () => { setExported(await api.exportPackage(analysis.token, kept, override)); setSettings(await api.settings()); setAnalysis(null); setNotice('Пакет сохранён. Перенесите все .md и бинарные вложения, затем подтвердите передачу.'); })}>Создать {mode === 'global' ? 'пакет для Internal' : 'пакет'}</Button>
<div><small>{settings.outputDirectory || 'Папка экспорта не выбрана: откройте Settings'}</small><div role="status" style={{ color: 'var(--danger)', fontSize: 12 }}>{[busy ? 'Операция выполняется' : '', analysis.findings.some(f => !kept.includes(f.id)) ? `Без решения: ${analysis.findings.filter(f => !kept.includes(f.id)).length}. Выберите «Оставить», замените значение или игнорируйте все без решения.` : '', analysis.findings.some(f => f.severity === 'block') && !override ? 'Подтвердите разрешение на экспорт оставшихся secrets.' : ''].filter(Boolean).join(' ')}</div></div>
</ExportActions>
            </Card>
          </>}
          {exported.length > 0 && <Card>
<h2>Файлы пакета</h2>{exported.map(name => <p key={name}>
<code>{name}</code>
</p>)}</Card>}
        </>}
      </>}
      {tab === 'import' && <>
<Card>
<Form>
<label>Профиль синхронизации<select value={selected} onChange={e => { setSelected(e.target.value); reset(); }}>
<option value="">Выберите профиль</option>{settings.profiles.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
</label>
<label>Markdown package<Row>
<input readOnly value={packagePath} placeholder="Выберите любую часть .md" style={{ flex: 1 }} />
<Button onClick={() => void run(async () => { const name = await api.choosePackage(); if (name) { setPackagePath(name); setImportPreview(null); } })}>Выбрать .md</Button>
</Row>
</label>
<label>Target Git repository<Row>
<input readOnly value={target} placeholder="Папка существующего локального Git repository" style={{ flex: 1 }} />
<Button onClick={() => void run(async () => { const name = await api.chooseDirectory(); if (name) { setTarget(name); setImportPreview(null); } })}>Выбрать папку</Button>
</Row>
</label>
<Row>
<Button $primary disabled={!selected || !target || !packagePath} onClick={() => void run(async () => { setImportPreview(null); setImportPreview(await api.preflight(packagePath, target, selected)); })}>Analyse package</Button>
</Row>
</Form>
</Card>
        {importPreview && <Card>
<h2>Preview импорта</h2>
<Row>
<Badge>✓ Integrity</Badge>
<Badge>✓ Baseline</Badge>
<Badge>✓ Patches</Badge>
<Badge>✓ Safe paths</Badge>
</Row>
<p>
<code>{short(importPreview.sourceState)} → {short(importPreview.targetState)}</code>
</p>
<Grid>{Object.entries(importPreview.changes).map(([key, value]) => <Stat key={key}>
<span>{key}</span>
<strong>{value}</strong>
</Stat>)}</Grid>
<div style={{ marginTop: 20 }}>
<ChangeTable entries={importPreview.entries} />
</div>
<Notice style={{ marginTop: 20 }}>Будут изменены локальные файлы. Перед применением RepoSync сохранит backup. Закройте редакторы и процессы, изменяющие target repository.</Notice>
<Button $primary onClick={() => void run(async () => { setSettings(await api.applyImport(importPreview.token)); setImportPreview(null); setNotice('Импорт завершён. Хеши проверены, synchronized state обновлён. Backup сохранён локально.'); })}>Применить с backup</Button>
</Card>}
      </>}
      {tab === 'settings' && <>
<Card>
<h2>Режим среды</h2>
<Muted>В Internal доступны только локальные источники; Remote Git скрыт и заблокирован в Main.</Muted>
<Row>
<Button $primary={mode === 'internal'} onClick={() => void run(() => changeEnvironment('internal'))}>🏢 Internal</Button>
<Button $primary={mode === 'global'} onClick={() => void run(() => changeEnvironment('global'))}>🌐 Global</Button>
</Row>
</Card>
<Card>
<h2>Папка экспорта</h2>
<p>
<code>{settings.outputDirectory || 'Не выбрана'}</code>
</p>
<Button onClick={() => void run(async () => { const name = await api.chooseDirectory(); if (name) { setSettings(await api.setOutputDirectory(name)); reset(); } })}>Выбрать папку</Button>
</Card>
<Card>
<h2>Конфиденциальность</h2>
<Muted>Без telemetry и облачной аналитики. Credentials обрабатывает системный Git / SSH Agent / Credential Manager. Найденные значения не сохраняются в настройках и логах.</Muted>
<small>Security Scan не гарантирует обнаружение всех secrets. Проверяйте preview перед передачей.</small>
</Card>
</>}
      </fieldset>
    </Main>
  </Layout>;
  const draftSource: Source | undefined = mode && draft ? draft.sources[mode] ?? { kind: 'local', location: '', branch: 'main' } : undefined;
  function updateSource(patch: Partial<Source>): void {
    if (!draft || !mode || !draftSource) return;
    const sourceChanged = (patch.location !== undefined && patch.location !== draftSource.location) || (patch.kind !== undefined && patch.kind !== draftSource.kind);
    const branchChanged = patch.branch !== undefined && patch.branch !== draftSource.branch;
    if (sourceChanged) { setBranches([]); setBaseCommits([]); }
    if (sourceChanged || branchChanged) setCommits([]);
    setDraft({ ...draft, sources: { ...draft.sources, [mode]: { ...draftSource, ...((sourceChanged || branchChanged) ? { commit: '' } : {}), ...(sourceChanged ? { base: undefined } : {}), ...patch } } });
  }
  async function loadOptions(current: Source): Promise<void> {
    const available = await api.listBranches({ ...current, commit: '' });
    setBranches(available);
    const branch = available.includes(current.branch) ? current.branch : current.commit ? current.branch : available[0];
    if (!branch) { setCommits([]); throw new Error('В репозитории нет веток'); }
    if (branch !== current.branch) {
      setDraft(previous => previous && mode ? { ...previous, sources: { ...previous.sources, [mode]: { ...current, branch, commit: '' } } } : previous);
    }
    setCommits(await api.listCommits({ ...current, branch, commit: '' }));
    if (current.base) setBaseCommits(await api.listCommits({ ...current, ...current.base, commit: '', base: undefined }));
  }
  function selectBranch(branch: string): void {
    if (!draftSource) return;
    updateSource({ branch });
    void run(async () => setCommits(await api.listCommits({ ...draftSource, branch, commit: '' })));
  }
  return <>
<GlobalStyle /><AppearanceStyle $appearance={appearance} />{content}{draft && draftSource && <Overlay>
<ProfileModal role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
<ModalHeader><h2 id="profile-modal-title">{settings?.profiles.some(p => p.id === draft.id) ? 'Настройка профиля' : 'Новый профиль'}</h2><CloseButton aria-label="Закрыть" disabled={busy || previewBusy} onClick={() => setDraft(null)}>×</CloseButton></ModalHeader>
<ProfileBody>
<fieldset disabled={busy}>
<Form>
<label>Название<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Core App" />
</label>{mode === 'global' && <label>Источник Global<select value={draftSource.kind} onChange={e => updateSource({ kind: e.target.value as Source['kind'], location: '' })}>
<option value="local">Local Git repository</option>
<option value="remote">Remote Git repository</option>
</select>
</label>}<label>{draftSource.kind === 'remote' ? 'Repository URL (HTTPS / SSH)' : 'Local Git repository'}<Row>
<input value={draftSource.location} onBlur={() => { if (draftSource.location && branches.length === 0 && !busy) void run(() => loadOptions(draftSource)); }} onChange={e => updateSource({ location: e.target.value })} style={{ flex: 1 }} placeholder={draftSource.kind === 'remote' ? 'https://github.com/user/core-app.git' : '/path/to/repository'} />{draftSource.kind === 'local' && <Button onClick={() => void run(async () => { const name = await api.chooseDirectory(); if (name) { updateSource({ location: name }); await loadOptions({ ...draftSource, location: name, commit: '' }); } })}>Выбрать</Button>}</Row>
</label>
<Grid>
<label>Целевая ветка (до){branches.length > 0 ? <BranchPicker key={`${draftSource.location}:target`} label="Целевая ветка" branches={branches} value={draftSource.branch} onChange={selectBranch} /> : <input value={draftSource.branch} onChange={e => updateSource({ branch: e.target.value })} onBlur={() => { if (draftSource.location && draftSource.branch) selectBranch(draftSource.branch); }} />}
<Button disabled={!draftSource.location} onClick={() => void run(async () => { if (draftSource.kind === 'remote') { const update = await api.refreshSource(draftSource); setBranches(update.branches); setCommits(update.commits); setBaseCommits(update.baseCommits); setRemoteVersion(value => value + 1); setRemoteStatus('Ветки обновлены'); } else await loadOptions(draftSource); })}>Обновить ветки и коммиты</Button>
</label>
<label>Maximum part size, MB<input type="number" min={1} max={512} value={draft.maxPartMB} onChange={e => setDraft({ ...draft, maxPartMB: Number(e.target.value) })} />
</label>
</Grid>
<label>Целевой коммит (до)
<Row>
<select style={{ flex: 1 }} value={draftSource.commit ?? ''} onChange={e => updateSource({ commit: e.target.value })}>
<option value="">Последний коммит выбранной ветки</option>
{draftSource.commit && !commits.some(c => c.sha === draftSource.commit) && <option value={draftSource.commit}>{short(draftSource.commit)} — выбранный коммит</option>}
{commits.map(commit => <option key={commit.sha} value={commit.sha}>{short(commit.sha)} · {commit.date}</option>)}
</select>
<Button disabled={!draftSource.location || !draftSource.branch} onClick={() => void run(async () => setCommits(await api.listCommits({ ...draftSource, commit: '' })))}>Загрузить коммиты</Button>
</Row>
<input aria-label="Полный SHA выбранного коммита" value={draftSource.commit ?? ''} onChange={e => updateSource({ commit: e.target.value.trim() })} placeholder="Или вставьте полный SHA конкретного коммита" />
<small>Загружено коммитов: {commits.length}. Список содержит историю выбранной ветки; конкретный коммит также можно указать полным SHA. Выбор хранится отдельно для Internal и Global.</small>
</label>
<Check><input type="checkbox" checked={!!draftSource.base} onChange={e => {
  const base = e.target.checked ? { branch: branches.includes('main') ? 'main' : draftSource.branch, commit: '' } : undefined;
  updateSource({ base }); setBaseCommits([]);
  if (base && draftSource.location) void run(async () => setBaseCommits(await api.listCommits({ ...draftSource, ...base, base: undefined })));
}} />Сравнить два выбранных коммита вместо последнего синхронизированного состояния</Check>
{draftSource.base && <>
<label>Исходная ветка (от){branches.length ? <BranchPicker key={`${draftSource.location}:base`} label="Исходная ветка" branches={branches} value={draftSource.base.branch} onChange={branch => {
  const base = { branch, commit: '' }; updateSource({ base }); setBaseCommits([]);
  void run(async () => setBaseCommits(await api.listCommits({ ...draftSource, ...base, base: undefined })));
}} /> : <input value={draftSource.base.branch} onChange={e => { updateSource({ base: { branch: e.target.value, commit: '' } }); setBaseCommits([]); }} />}</label>
<label>Исходный коммит (от)
<Row><select style={{ flex: 1 }} value={draftSource.base.commit ?? ''} onChange={e => updateSource({ base: { ...draftSource.base!, commit: e.target.value } })}>
<option value="">Последний коммит исходной ветки</option>
{draftSource.base.commit && !baseCommits.some(c => c.sha === draftSource.base?.commit) && <option value={draftSource.base.commit}>{short(draftSource.base.commit)} — выбранный коммит</option>}
{baseCommits.map(commit => <option key={commit.sha} value={commit.sha}>{short(commit.sha)} · {commit.date}</option>)}
</select><Button disabled={!draftSource.location || !draftSource.base.branch} onClick={() => void run(async () => setBaseCommits(await api.listCommits({ ...draftSource, ...draftSource.base!, commit: '', base: undefined })))}>Загрузить коммиты</Button></Row>
<input aria-label="Полный SHA исходного коммита" value={draftSource.base.commit ?? ''} onChange={e => updateSource({ base: { ...draftSource.base!, commit: e.target.value.trim() } })} placeholder="Или полный SHA исходного коммита" />
<small>Загружено: {baseCommits.length}. Diff содержит изменения от исходного состояния до целевого. Коммиты могут быть из разных веток.</small>
</label></>}
<label>RepoSync exclusions — по одному glob в строке<textarea rows={4} value={draft.exclusions.join('\n')} onChange={e => setDraft({ ...draft, exclusions: e.target.value.split('\n') })} placeholder={'**/*.test.*\n**/__mocks__/**'} />
</label>{draft.includeIgnored.length > 0 && <label>Вручную возвращённые ignored-файлы<textarea rows={3} value={draft.includeIgnored.join('\n')} onChange={e => setDraft({ ...draft, includeIgnored: e.target.value.split('\n').filter(Boolean) })} />
<small>Эти файлы читаются из working tree и проходят Security Scan.</small>
</label>}<small>Git ignore rules применяются к untracked files. Tracked files остаются частью committed state.</small>{error && <Notice $error>{error}</Notice>}
</Form>
</fieldset>
<Comparison profile={draft} revision={remoteVersion} status={remoteStatus} busy={busy} onBusy={setPreviewBusy} request={previewRequest} />
</ProfileBody>
<ModalFooter disabled={busy || previewBusy}><Row>
<Button $primary onClick={() => void run(async () => { setSettings(await api.saveProfile(draft)); setSelected(draft.id); if (draftSource.base) setPackageType('diff'); setDraft(null); reset(); })}>Сохранить</Button>
<Button onClick={() => setDraft(null)}>Отмена</Button>{settings?.profiles.some(p => p.id === draft.id) && <Button $danger onClick={() => void run(async () => { const next = await api.deleteProfile(draft.id); setSettings(next); setSelected(next.profiles[0]?.id ?? ''); setDraft(null); reset(); })}>Удалить профиль</Button>}</Row>
</ModalFooter>
</ProfileModal>
</Overlay>}{replacement && <Overlay>
<Modal role="dialog" aria-modal="true" aria-labelledby="replacement-modal-title">
<ModalHeader><h2 id="replacement-modal-title">Preview замены</h2><CloseButton aria-label="Закрыть" disabled={busy} onClick={() => setReplacement(null)}>×</CloseButton></ModalHeader>
<ModalBody>
<p>
<code>{replacement.path}:{replacement.line}</code>
</p>
<p>
<code>{replacement.preview} → {replacement.replacement}</code>
</p>
<Notice $error>Изменится исходный локальный файл. После замены потребуется ваш Git commit и выбор исправленного commit в профиле; RepoSync не коммитит автоматически.</Notice>
</ModalBody>
<ModalFooter disabled={busy}><Row>
<Button $primary disabled={busy} onClick={() => void run(async () => { await api.applyReplacement(replacement.token); setReplacement(null); await compare(); setNotice('Span заменён в working tree. Git analysis и Security Scan выполнены заново. Закоммитьте исправление, выберите исправленный commit в профиле и повторите Compare.'); })}>Изменить исходный файл</Button>
<Button disabled={busy} onClick={() => setReplacement(null)}>Отмена</Button>
</Row></ModalFooter>
</Modal>
</Overlay>}</>;
}
