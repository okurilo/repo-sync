import { useState } from 'react';
import type { BranchContext, CommitOption, IncomingSelection } from '../../shared/types';
import { Button, Muted, Row, SourceForm, WorkflowActions } from '../ui/components';

export function IncomingSource({ branch, context, selection, commits, busy, change, compare, reload, reset }: { branch: string; context: BranchContext; selection: IncomingSelection; commits: CommitOption[]; busy: boolean; change: (selection: IncomingSelection) => void; compare: (selection: IncomingSelection) => void; reload: () => void; reset: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [startQuery, setStartQuery] = useState('');
  const { mode, baseBranch, from } = selection;
  const selected = selection.commit || commits[0]?.sha || '';
  const hasCommit = (sha: string | undefined): boolean => commits.some(item => item.sha === sha);
  const sameCommit = mode === 'range' && !!from && from === selected;
  const pickingCommits = mode === 'range' || mode === 'commit';
  const missingCommit = pickingCommits && (!hasCommit(selected) || (mode === 'range' && !hasCommit(from)));
  function commitPicker(start: boolean): React.JSX.Element {
    const current = start ? from : selected;
    const search = start ? startQuery : query;
    const term = search.trim().toLowerCase();
    const matches = commits.filter(item => `${item.sha} ${item.subject ?? ''} ${item.date}`.toLowerCase().includes(term));
    const chosen = commits.find(item => item.sha === current);
    const options = chosen && !matches.includes(chosen) ? [chosen, ...matches] : matches;
    return <>
      <label style={{ gridColumn: mode === 'commit' ? '1 / -1' : undefined }}>
        {start ? 'Поиск исходного коммита' : mode === 'range' ? 'Поиск итогового коммита' : 'Поиск коммита'}
        <input type="search" placeholder="SHA, название или дата" value={search} onChange={event => (start ? setStartQuery : setQuery)(event.target.value)} />
        <small role="status">{term && !matches.length && (chosen ? 'Совпадений нет. Сохранён текущий выбор.' : 'Совпадений нет.')}</small>
      </label>
      <label>{start ? 'Начало — исходная версия' : mode === 'range' ? 'Конец — итоговая версия' : 'Коммит'}
        <select value={current ?? ''} onChange={event => change({ ...selection, [start ? 'from' : 'commit']: event.target.value || undefined })}>
          {start && <option value="">Выберите исходный коммит</option>}
          {current && !chosen && <option value={current} disabled>{current.slice(0, 10)} · отсутствует в истории</option>}
          {!start && !current && <option value="">В этой ветке нет доступных коммитов</option>}
          {options.map(item => <option key={item.sha} value={item.sha}>{item.date} · {item.sha.slice(0, 10)} · {item.subject ?? ''}</option>)}
        </select>
      </label>
    </>;
  }
  const invalidBase = (mode === 'branch' || mode === 'branches') && (!baseBranch || baseBranch === (selection.branch ?? branch));
  const explanation = {
    branch: 'Изменения от общего предка основной и выбранной веток. Новые коммиты основной ветки не переносятся обратно.',
    branches: 'Различия между вершинами двух удалённых веток: A → B. Общий предок и незакоммиченные изменения не учитываются.',
    commit: 'Изменения одного коммита относительно его первого родителя.',
    range: 'Чтобы получить правки B и C в истории A → B → C, выберите начало A и конец C. Вы увидите, чем файлы в C отличаются от файлов в A.',
    repositories: 'Полное сравнение локальной ветки с удалённой. Локальные файлы, которых нет в удалённом репозитории, будут предложены к удалению.',
    zero: 'Все файлы удалённого репозитория предлагаются к добавлению. Выбранные существующие файлы получат входящую версию после проверки.',
  }[mode];
  let hint = 'Далее — выбор файлов и просмотр отличий.';
  if (invalidBase) hint = baseBranch ? 'Выберите две разные ветки.' : 'Выберите основную или исходную ветку.';
  if (sameCommit) hint = 'Начало и конец совпадают. Выберите другой коммит.';
  if (mode === 'range' && !from) hint = 'Выберите исходную версию перед нужными правками.';
  if (pickingCommits && ((selection.commit && !hasCommit(selection.commit)) || (from && !hasCommit(from)))) hint = 'История обновилась. Замените отсутствующий коммит.';
  if (mode === 'range' && commits.length === 1) hint = 'В истории один коммит. Для переноса всех его файлов выберите «Все файлы удалённого репозитория».';
  return <SourceForm aria-label="Источник изменений">
    <Row style={{ justifyContent: 'space-between', marginBottom: 24 }}><strong>Удалённый Git</strong><Row><Button disabled={busy} onClick={() => { setQuery(''); setStartQuery(''); reset(); }}>Сбросить настройки</Button><Button disabled={busy} onClick={reload}>Обновить ветки</Button></Row></Row>
    <fieldset disabled={busy}>
      <label style={{ gridColumn: '1 / -1' }}>Что сравнить<select value={mode} onChange={event => { setQuery(''); setStartQuery(''); change({ mode: event.target.value as IncomingSelection['mode'], branch: selection.branch ?? branch, baseBranch }); }}><optgroup label="Обычные способы"><option value="branch">Изменения ветки</option><option value="branches">Две ветки</option><option value="commit">Один коммит</option></optgroup><optgroup label="Дополнительные способы"><option value="range">Два коммита</option><option value="repositories">Репозитории целиком</option><option value="zero">Все файлы удалённого репозитория</option></optgroup></select><small>{explanation}</small></label>
      {(mode === 'branch' || mode === 'branches') && <label>{mode === 'branches' ? 'Исходная ветка A' : 'Основная ветка'}<select value={baseBranch ?? ''} onChange={event => change({ ...selection, baseBranch: event.target.value || undefined })}><option value="">Выберите ветку</option>{context.branches.map(name => <option key={name}>{name}</option>)}</select></label>}
      <label style={{ gridColumn: mode === 'range' ? '1 / -1' : undefined }}>{mode === 'branches' ? 'Конечная ветка B' : 'Удалённая ветка'}<select value={selection.branch ?? branch} onChange={event => { setQuery(''); setStartQuery(''); change({ mode, branch: event.target.value, baseBranch }); }}>{context.branches.map(name => <option key={name}>{name}</option>)}</select></label>
      {mode === 'range' && commitPicker(true)}
      {pickingCommits && commitPicker(false)}
      {mode === 'range' && <Button disabled={missingCommit || sameCommit} onClick={() => {
        setStartQuery(query); setQuery(startQuery);
        change({ ...selection, from: selected, commit: from });
      }}>Поменять начало и конец</Button>}
    </fieldset>
    <WorkflowActions><Muted role="status" style={{ margin: 0, maxWidth: 440, fontSize: 13 }}>{hint}</Muted><Button $primary disabled={busy || !context.branches.includes(selection.branch ?? branch) || invalidBase || sameCommit || missingCommit} onClick={() => compare({ ...selection, ...(mode === 'commit' || mode === 'range' ? { commit: selected } : {}) })}>Показать изменения</Button></WorkflowActions>
  </SourceForm>;
}
