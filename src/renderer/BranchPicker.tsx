import { useEffect, useId, useRef, useState } from 'react';
import { Button, Row } from './ui/components';

interface Props {
  value: string;
  label: string;
  configured: boolean;
  disabled: boolean;
  sourceHint: string;
  load: () => Promise<string[]>;
  onChange: (branch: string) => void;
}
export function BranchPicker({ value, label, configured, disabled, sourceHint, load, onChange }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const id = useId();
  const active = useRef(true);
  const keyboardSelection = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const locked = disabled || loading;
  const matches = (names ?? []).filter(branch => branch.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function refresh(): Promise<void> {
    if (locked || !configured) return;
    setLoading(true); setError('');
    try {
      const result = await load();
      if (active.current) setNames(result);
    } catch (cause) {
      if (active.current) { setNames(null); setError(cause instanceof Error ? cause.message : 'Не удалось загрузить ветки. Повторите попытку.'); }
    } finally { if (active.current) setLoading(false); }
  }
  function close(): void { keyboardSelection.current = false; setOpen(false); trigger.current?.focus(); }
  const status = !configured ? sourceHint : loading ? 'Загрузка веток…' : error ? error : names === null ? 'Список ещё не загружен. Откройте выбор ветки.' : !names.length ? 'В репозитории нет веток.' : !names.includes(value) ? `Ветка «${value}» не найдена в загруженном списке. Выберите другую.` : `Ветка выбрана · В списке: ${names.length}`;
  return <div style={{ display: 'grid', gap: 8, minWidth: 0 }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <span id={`${id}-label`}>{label}</span>
    <Button ref={trigger} type="button" aria-label={`Выбрать: ${label.toLocaleLowerCase()}`} aria-expanded={open} aria-controls={`${id}-list`} aria-describedby={`${id}-status`} disabled={locked || !configured}
      style={{ width: '100%', justifyContent: 'space-between', minWidth: 0, border: '1px solid var(--line)', background: 'var(--input)' }}
      onClick={() => { setOpen(!open); if (!open && names === null && !error) void refresh(); }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>{value || 'Выберите ветку'}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </Button>
    <small id={`${id}-status`} role={error ? 'alert' : 'status'} style={{ color: error ? 'var(--danger)' : names && !names.includes(value) ? 'var(--warning)' : 'var(--muted)', overflowWrap: 'anywhere' }}>{status}</small>
    {open && <div id={`${id}-list`} aria-labelledby={`${id}-label`} aria-busy={loading} style={{ display: 'grid', gap: 8, padding: 12, background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 8 }}>
      <input type="search" aria-label={`Поиск: ${label.toLocaleLowerCase()}`} placeholder="Найти ветку…" disabled={locked || names === null} value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label={label} size={8} disabled={locked || !matches.length} value={matches.includes(value) ? value : ''}
        onKeyDown={event => { keyboardSelection.current = true; if (event.key === 'Enter') { event.preventDefault(); close(); } }} onPointerDown={() => { keyboardSelection.current = false; }}
        onChange={event => { if (event.target.value) { onChange(event.target.value); if (!keyboardSelection.current) close(); } }} style={{ height: 224, maxHeight: 224, overflowY: 'auto', overscrollBehavior: 'contain', padding: 4 }}>
        {!matches.includes(value) && <option value="" disabled>{loading ? 'Загрузка…' : error ? 'Список недоступен' : names === null ? 'Загрузите ветки' : matches.length ? 'Выберите ветку' : names.length ? 'Нет совпадений' : 'Веток нет'}</option>}
        {matches.map(branch => <option key={branch} value={branch} style={{ padding: '6px 8px' }}>{branch}</option>)}
      </select>
      <Row style={{ justifyContent: 'space-between' }}><small>{names !== null && !loading ? `Найдено: ${matches.length} / ${names.length}` : 'Список веток репозитория'}</small><Button type="button" disabled={locked} onClick={() => void refresh()}>{loading ? 'Загрузка…' : error ? 'Повторить' : 'Загрузить ветки'}</Button></Row>
    </div>}
  </div>;
}
