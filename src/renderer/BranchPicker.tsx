import { useState } from 'react';

export function BranchPicker({ branches, value, onChange, label }: { branches: string[]; value: string; onChange: (branch: string) => void; label: string }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const available = value && !branches.includes(value) ? [value, ...branches] : branches;
  const matches = available.filter(branch => branch.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
    <input type="search" aria-label={`Поиск: ${label}`} placeholder="Найти ветку…" value={query} onChange={event => setQuery(event.target.value)} />
    <select aria-label={label} size={8} value={matches.includes(value) ? value : ''} onChange={event => { if (event.target.value) onChange(event.target.value); }} style={{ height: 224, maxHeight: 224, overflowY: 'auto', overscrollBehavior: 'contain', padding: 4 }}>
      {!matches.includes(value) && <option value="" disabled>{matches.length ? 'Выберите ветку' : 'Ветки не найдены'}</option>}
      {matches.map(branch => <option key={branch} value={branch} style={{ padding: '6px 8px' }}>{branch}{!branches.includes(branch) ? ' (кэш)' : ''}</option>)}
    </select>
    <small>Выбрана: <code>{value || '—'}</code> · Найдено: {matches.length} / {available.length}</small>
  </div>;
}
