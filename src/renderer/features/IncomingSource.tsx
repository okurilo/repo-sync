import { useState } from 'react';
import type { CommitOption, IncomingSelection } from '../../shared/types';
import { Button, Muted, Row, Status, Surface } from '../ui/components';

export function IncomingSource({ branch, commits, busy, error, compare, reload, close }: { branch: string; commits: CommitOption[]; busy: boolean; error: string; compare: (selection: IncomingSelection) => void; reload: () => void; close: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<IncomingSelection['mode']>('commit');
  const [commit, setCommit] = useState(''); const [from, setFrom] = useState(''); const [query, setQuery] = useState('');
  const selected = commit || commits[0]?.sha || '';
  const choices = commits.filter(item => item.sha === selected || item.sha === from || `${item.sha} ${item.subject ?? ''} ${item.date}`.toLowerCase().includes(query.toLowerCase()));
  const items = choices.map(item => <option key={item.sha} value={item.sha}>{item.date} · {item.sha.slice(0, 10)} · {item.subject ?? ''}</option>);
  return <Surface><h2>Входящие изменения</h2><Muted>Внешняя ветка: {branch}. Выберите изменения для применения во внутреннем репозитории.</Muted>
    <fieldset disabled={busy} style={{ display: 'grid', gap: 16 }}><label>Способ сравнения<select value={mode} onChange={event => setMode(event.target.value as IncomingSelection['mode'])}><option value="commit">По коммиту</option><option value="range">Между двумя коммитами</option><option value="repositories">Сравнить репозитории целиком</option><option value="zero">От нулевого состояния</option></select></label>
      {(mode === 'commit' || mode === 'range') && <><input aria-label="Поиск коммита" placeholder="Найти по SHA, названию или дате…" value={query} onChange={event => setQuery(event.target.value)} />{mode === 'range' && <label>Исходное состояние A<select value={from} onChange={event => setFrom(event.target.value)}><option value="">Выберите начальный коммит</option>{items}</select></label>}<label>{mode === 'commit' ? 'Коммит' : 'Конечное состояние B'}<select value={selected} onChange={event => setCommit(event.target.value)}>{!commits.length && <option value="">История не загружена</option>}{items}</select></label><small>{mode === 'commit' ? 'Будут взяты только изменения выбранного коммита относительно первого родителя. Для merge-коммита сравнение идёт с первым родителем.' : 'Будет взят точный diff файлов A → B, независимо от родства и порядка коммитов. Локальная история не участвует в построении diff.'}</small></>}
      {mode === 'repositories' && <Status>Полное сравнение локальной и внешней веток. Внутренние отличия будут показаны для замены, локальные файлы, отсутствующие снаружи, — для удаления. Проверьте результат перед применением.</Status>}
      {mode === 'zero' && <Status>Полный перенос внешней ветки как новых файлов. Отличающиеся существующие файлы вызовут конфликт; остальные внутренние файлы сохранятся.</Status>}
    </fieldset>{error && <Status $error role="alert">{error}</Status>}<Row style={{ justifyContent: 'space-between', marginTop: 20 }}><Row><Button disabled={busy} onClick={close}>Закрыть</Button><Button disabled={busy} onClick={reload}>Обновить историю</Button></Row><Button $primary disabled={busy || ((mode === 'commit' || mode === 'range') && !selected) || (mode === 'range' && !from)} onClick={() => compare({ mode, ...(mode === 'commit' || mode === 'range' ? { commit: selected } : {}), ...(mode === 'range' ? { from } : {}) })}>Показать изменения</Button></Row>
  </Surface>;
}
