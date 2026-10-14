import { useState } from 'react';
import type { BranchContext, CommitOption, IncomingSelection } from '../../shared/types';
import { Button, Muted, Row, SourceForm, WorkflowActions } from '../ui/components';

export function IncomingSource({ branch, context, selection, commits, busy, change, compare, reload }: { branch: string; context: BranchContext; selection: IncomingSelection; commits: CommitOption[]; busy: boolean; change: (selection: IncomingSelection) => void; compare: (selection: IncomingSelection) => void; reload: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const { mode, baseBranch, from } = selection;
  const selected = selection.commit || commits[0]?.sha || '';
  const choices = commits.filter(item => item.sha === selected || item.sha === from || `${item.sha} ${item.subject ?? ''} ${item.date}`.toLowerCase().includes(query.toLowerCase()));
  const items = choices.map(item => <option key={item.sha} value={item.sha}>{item.date} · {item.sha.slice(0, 10)} · {item.subject ?? ''}</option>);
  const invalidBase = (mode === 'branch' || mode === 'branches') && (!baseBranch || baseBranch === (selection.branch ?? branch));
  const explanation = {
    branch: 'Изменения от общего предка основной и выбранной веток. Новые коммиты основной ветки не переносятся обратно.',
    branches: 'Различия между вершинами двух внешних веток: A → B. Общий предок и незакоммиченные изменения не учитываются.',
    commit: 'Изменения одного коммита относительно его первого родителя.',
    range: 'Различия между двумя коммитами: A → B, независимо от их родства и порядка.',
    repositories: 'Полное сравнение локальной и внешней веток. Локальные файлы, которых нет снаружи, будут предложены к удалению.',
    zero: 'Все внешние файлы предлагаются к добавлению. Выбранные существующие файлы получат входящую версию после проверки.',
  }[mode];
  return <SourceForm aria-label="Источник изменений">
    <Row style={{ justifyContent: 'space-between', marginBottom: 24 }}><strong>Внешний Git</strong><Button disabled={busy} onClick={reload}>Обновить ветки</Button></Row>
    <fieldset disabled={busy}>
      <label style={{ gridColumn: '1 / -1' }}>Что сравнить<select value={mode} onChange={event => change({ mode: event.target.value as IncomingSelection['mode'], branch: selection.branch ?? branch, baseBranch })}><optgroup label="Обычные способы"><option value="branch">Изменения ветки</option><option value="branches">Две ветки</option><option value="commit">Один коммит</option></optgroup><optgroup label="Дополнительные способы"><option value="range">Два коммита</option><option value="repositories">Репозитории целиком</option><option value="zero">Все внешние файлы</option></optgroup></select><small>{explanation}</small></label>
      {(mode === 'branch' || mode === 'branches') && <label>{mode === 'branches' ? 'Исходная ветка A' : 'Основная ветка'}<select value={baseBranch ?? ''} onChange={event => change({ ...selection, baseBranch: event.target.value || undefined })}><option value="">Выберите ветку</option>{context.branches.map(name => <option key={name}>{name}</option>)}</select></label>}
      <label>{mode === 'branches' ? 'Конечная ветка B' : 'Внешняя ветка'}<select value={selection.branch ?? branch} onChange={event => { setQuery(''); change({ mode, branch: event.target.value, baseBranch }); }}>{context.branches.map(name => <option key={name}>{name}</option>)}</select></label>
      {(mode === 'commit' || mode === 'range') && <>
        <label style={{ gridColumn: '1 / -1' }}>Поиск коммита<input type="search" placeholder="SHA, название или дата" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {mode === 'range' && <label>Исходный коммит A<select value={from ?? ''} onChange={event => change({ ...selection, from: event.target.value || undefined })}><option value="">Выберите коммит</option>{items}</select></label>}
        <label>{mode === 'commit' ? 'Коммит' : 'Конечный коммит B'}<select value={selected} onChange={event => change({ ...selection, commit: event.target.value })}>{!commits.length && <option value="">В этой ветке нет доступных коммитов</option>}{items}</select></label>
      </>}
    </fieldset>
    <WorkflowActions><Muted style={{ margin: 0, maxWidth: 440, fontSize: 13 }}>{invalidBase ? !baseBranch ? 'Выберите основную или исходную ветку.' : 'Выберите две разные ветки.' : 'Далее — выбор файлов и просмотр отличий.'}</Muted><Button $primary disabled={busy || !context.branches.includes(selection.branch ?? branch) || invalidBase || ((mode === 'commit' || mode === 'range') && !selected) || (mode === 'range' && !from)} onClick={() => compare({ ...selection, ...(mode === 'commit' || mode === 'range' ? { commit: selected } : {}) })}>Показать изменения</Button></WorkflowActions>
  </SourceForm>;
}
