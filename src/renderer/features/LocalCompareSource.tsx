import { useEffect, useState } from 'react';
import type { CommitOption, CompareSelection, Source } from '../../shared/types';
import { Row } from '../ui/components';

interface Props { selection: CompareSelection; branches: string[]; source: Source; workingBranch?: string; change: (selection: CompareSelection) => void }

export function LocalCompareSource({ selection, branches, source, workingBranch, change }: Props): React.JSX.Element {
  const [fromCommits, setFromCommits] = useState<CommitOption[]>([]); const [toCommits, setToCommits] = useState<CommitOption[]>([]);
  const [fromQuery, setFromQuery] = useState(''); const [toQuery, setToQuery] = useState('');
  const [fromError, setFromError] = useState(''); const [toError, setToError] = useState('');
  useEffect(() => { let active = true; setFromCommits([]); setFromError(''); void window.reposync.listCommits({ ...source, branch: selection.fromBranch, commit: undefined }).then(items => { if (active) setFromCommits(items); }).catch(cause => { if (active) setFromError(cause instanceof Error ? cause.message : 'История ветки недоступна.'); }); return () => { active = false; }; }, [source.location, selection.fromBranch]);
  useEffect(() => { let active = true; setToCommits([]); setToError(''); void window.reposync.listCommits({ ...source, branch: selection.toBranch, commit: undefined }).then(items => { if (active) setToCommits(items); }).catch(cause => { if (active) setToError(cause instanceof Error ? cause.message : 'История ветки недоступна.'); }); return () => { active = false; }; }, [source.location, selection.toBranch]);
  const options = (commits: CommitOption[], query: string): CommitOption[] => commits.filter(item => `${item.sha} ${item.subject ?? ''} ${item.date}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const side = (label: string, branch: string, sha: string | undefined, commits: CommitOption[], query: string, setQuery: (value: string) => void, update: (branch: string, sha?: string) => void, error: string, disabled = false): React.JSX.Element => <section style={{ minWidth: 0, padding: '12px 0', borderTop: '1px solid var(--line)' }}>
    <strong>{label}</strong>
    <Row style={{ alignItems: 'start', marginTop: 8 }}>
      <label style={{ flex: 1, minWidth: 180 }}>Ветка<select value={branch} onChange={event => update(event.target.value)}>{branches.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label style={{ flex: 1, minWidth: 220 }}>Коммит · необязательно<input type="search" placeholder="Поиск сообщения или SHA · Enter — выбрать полный SHA" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(query.trim())) { event.preventDefault(); update(branch, query.trim().toLowerCase()); } }} /><select disabled={disabled} value={sha ?? ''} onChange={event => update(branch, event.target.value || undefined)}><option value="">Вершина ветки (HEAD)</option>{sha && !commits.some(item => item.sha === sha) && <option value={sha}>Выбранный SHA · {sha.slice(0, 10)}</option>}{options(commits, query).map(item => <option key={item.sha} value={item.sha}>{item.date} · {item.sha.slice(0, 10)} · {item.subject ?? ''}</option>)}</select>{error && <small role="alert" style={{ color: 'var(--danger)' }}>{error}</small>}</label>
    </Row>
  </section>;
  return <div aria-label="Сравнение версий" style={{ marginTop: 12 }}>
    {side('A · Исходная версия', selection.fromBranch, selection.fromCommit, fromCommits, fromQuery, setFromQuery,
      (fromBranch, fromCommit) => change({ ...selection, fromBranch, fromCommit }), fromError)}
    {side('B · Конечная версия', selection.toBranch, selection.toCommit, toCommits, toQuery, setToQuery,
      (toBranch, toCommit) => change({ ...selection, toBranch, toCommit, toWorking: false }), toError, !!selection.toWorking)}
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}><input type="checkbox" disabled={workingBranch !== selection.toBranch} checked={!!selection.toWorking} onChange={event => change({ ...selection, toCommit: undefined, toWorking: event.target.checked })} />Взять B из текущей рабочей копии выбранной ветки{workingBranch !== selection.toBranch && <small> · сейчас открыта «{workingBranch ?? 'неизвестная ветка'}»</small>}</label>
    <small>Выберите две версии внутреннего Git. Если коммит не выбран, берётся вершина ветки. SHA проверяется по истории выбранной ветки. A → B попадёт в пакет.</small>
  </div>;
}
