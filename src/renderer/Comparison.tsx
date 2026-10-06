import { Icon, reveal } from './Appearance';
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from 'diff';
import styled, { css } from 'styled-components';
import type { CodeComparison, CodePreview } from '../shared/types';

const Panel = styled('section')({ minWidth: 0, display: 'flex', flexDirection: 'column', height: 'max(260px, calc(100dvh - 430px))', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }, css`animation: ${reveal} 180ms ease-out;`);
const Bar = styled('div')({ padding: '12px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0, '& p': { margin: '5px 0', fontSize: 12 }, '& h3': { margin: 0 }, background: 'var(--raised)' });
const Workspace = styled('div')({ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', flex: 1, minHeight: 0, '@media (max-width: 700px)': { gridTemplateColumns: 'minmax(0, 1fr)' } });
const Tree = styled('nav')({ overflow: 'auto', width: 210, minWidth: 130, maxWidth: 380, resize: 'horizontal', '@media(max-width: 700px)': { width: '100%', maxWidth: 'none', maxHeight: 180, resize: 'none' }, borderRight: '1px solid var(--line)', padding: 10, fontSize: 12, '& summary': { padding: '5px 0', whiteSpace: 'nowrap' }, '& details > div': { paddingLeft: 12 } });
const File = styled('button')<{ $selected: boolean }>(({ $selected }) => ({ display: 'block', width: '100%', border: 0, boxShadow: $selected ? 'inset 2px 0 var(--accent)' : 'none', background: $selected ? 'var(--tint)' : 'transparent', textAlign: 'left', padding: '6px 4px', whiteSpace: 'nowrap', color: 'var(--text)', borderRadius: 4 }));
const Switch = styled('button')<{ $active: boolean }>(({ $active }) => ({ border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px', background: $active ? 'var(--tint)' : 'var(--surface)', color: $active ? 'var(--accent)' : 'var(--muted)', fontSize: 11 }));
const Code = styled('div')({ overflow: 'auto', minWidth: 0, background: 'var(--input)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, '& table': { width: '100%', fontSize: 12 }, '& td': { border: 0, padding: '2px 6px', whiteSpace: 'pre' }, '& td:last-child': { width: '100%' }, '& .syntax-keyword': { color: 'var(--accent)' }, '& .syntax-string': { color: 'var(--success)' }, '& .syntax-comment': { color: 'var(--muted)', fontStyle: 'italic' }, '& .syntax-number': { color: 'var(--warning)' }, '& .split td': { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', verticalAlign: 'top', borderRight: '1px solid var(--line)' }, '& .split td:nth-child(even)': { width: '50%' }, '& .split td:nth-child(odd)': { color: 'var(--muted)', width: 36, userSelect: 'none' } });
const Line = styled('tr')<{ $kind: string }>(({ $kind }) => ({ background: $kind === '+' ? 'var(--added)' : $kind === '-' ? 'var(--removed)' : 'transparent', '& td:not(:last-child)': { color: 'var(--muted)', textAlign: 'right', userSelect: 'none' } }));
function lines(preview: CodePreview): { old: number | string; next: number | string; kind: string; text: string }[] {
  const changes = diffLines(preview.before, preview.after, { timeout: 1000 });
  if (!changes) return [{ old: '', next: '', kind: '', text: 'Не удалось показать различия: сравнение слишком сложное.' }];
  const rows: ReturnType<typeof lines> = []; let old = 1; let next = 1;
  for (const change of changes) {
    const text = change.value.split('\n'); if (text.at(-1) === '') text.pop();
    for (let i = 0; i < text.length; i++) {
      const oldLine = change.added ? '' : old++; const nextLine = change.removed ? '' : next++;
      if (!change.added && !change.removed && text.length > 10 && i >= 3 && i < text.length - 3) {
        if (i === 3) rows.push({ old: '', next: '', kind: '', text: `⋯ ${text.length - 6} строк без изменений` });
        continue;
      }
      rows.push({ old: oldLine, next: nextLine, kind: change.added ? '+' : change.removed ? '-' : ' ', text: text[i] ?? '' });
      if (rows.length >= 2000) return [...rows, { old: '', next: '', kind: '', text: '⋯ Показаны первые 2000 строк diff' }];
    }
  }
  return rows;
}
function syntax(text: string): React.ReactNode[] {
  return text.split(/(\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|\b(?:const|let|var|function|return|if|else|import|export|from|type|interface|class|async|await|new|null|true|false|throw|try|catch)\b|\b\d+(?:\.\d+)?\b)/g).map((token, index) => <span key={index} className={token.startsWith('//') ? 'syntax-comment' : /^["'`]/.test(token) ? 'syntax-string' : /^\d/.test(token) ? 'syntax-number' : /^(?:const|let|var|function|return|if|else|import|export|from|type|interface|class|async|await|new|null|true|false|throw|try|catch)$/.test(token) ? 'syntax-keyword' : undefined}>{token}</span>);
}
function paired(rows: ReturnType<typeof lines>): { left?: ReturnType<typeof lines>[number]; right?: ReturnType<typeof lines>[number] }[] {
  const result: ReturnType<typeof paired> = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index]!;
    if (row.kind === '-') { const removed = []; const added = []; while (rows[index]?.kind === '-') removed.push(rows[index++]!); while (rows[index]?.kind === '+') added.push(rows[index++]!); for (let i = 0; i < Math.max(removed.length, added.length); i++) result.push({ left: removed[i], right: added[i] }); }
    else { result.push(row.kind === '+' ? { right: row } : { left: row, right: row }); index++; }
  }
  return result;
}
export function Comparison({ comparison, busy, onBusy, request }: { comparison: CodeComparison; busy: boolean; onBusy: (value: boolean) => void; request: React.MutableRefObject<Promise<void> | null> }): React.JSX.Element {
  const pending = request;
  const generation = useRef(0);
  const [sideBySide, setSideBySide] = useState(false);
  const [preview, setPreview] = useState<CodePreview | null>(null);
  const [selected, setSelected] = useState(''); const [error, setError] = useState('');
  const [loading, setLoading] = useState(false); const [query, setQuery] = useState('');
  useEffect(() => {
    const current = ++generation.current; let active = true;
    setPreview(null); setError(''); setSelected(comparison.entries[0]?.path ?? '');
    const first = comparison.entries[0];
    if (!first) return;
    onBusy(true); setLoading(true);
    const previous = pending.current;
    const task = (async (): Promise<void> => {
      await previous;
      if (!active) return;
      try { const result = await window.reposync.previewCode(comparison.token, first.path); if (active && generation.current === current) setPreview(result); }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Ошибка предпросмотра'); }
      finally { if (active) setLoading(false); onBusy(false); }
    })(); pending.current = task;
    return () => { active = false; onBusy(false); };
  }, [comparison.token, onBusy, pending]);
  async function open(name: string): Promise<void> {
    if (!comparison || loading) return; setSelected(name); setPreview(null); setError(''); setLoading(true); onBusy(true);
    const current = generation.current;
    const task = (async (): Promise<void> => {
      try { const result = await window.reposync.previewCode(comparison.token, name); if (generation.current === current) setPreview(result); }
      catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : 'Не удалось прочитать файл'); }
      finally { if (generation.current === current) setLoading(false); onBusy(false); }
    })();
    pending.current = task; await task;
  }
  const entries = comparison?.entries.filter(entry => entry.path.toLowerCase().includes(query.toLowerCase())) ?? [];
  function tree(items: CodeComparison['entries'], prefix = ''): React.JSX.Element[] {
    const folders = new Map<string, CodeComparison['entries']>(); const files: CodeComparison['entries'] = [];
    for (const item of items) { const tail = item.path.slice(prefix.length); const slash = tail.indexOf('/');
      if (slash < 0) files.push(item); else { const folder = tail.slice(0, slash); folders.set(folder, [...(folders.get(folder) ?? []), item]); }
    }
    return [...[...folders].map(([folder, nested]) => <details key={folder} open><summary>{folder}/</summary><div>{tree(nested, `${prefix}${folder}/`)}</div></details>), ...files.map(entry => <File key={entry.path} $selected={entry.path === selected} disabled={loading || busy} title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path} onClick={() => void open(entry.path)}>{entry.operation === 'ADD' ? '+' : entry.operation === 'DELETE' ? '−' : '~'} {entry.path.slice(prefix.length)}</File>)];
  }
  const rows = useMemo(() => preview && !preview.message ? lines(preview) : [], [preview]);
  return <Panel aria-label="Просмотр изменений"><Bar><h3>Изменения файлов</h3><div style={{ margin: '5px 0', fontSize: 12 }}>Изменено файлов: {comparison.entries.length} {comparison.lineChanges && <span>· <span style={{ color: 'var(--success)' }}>+{comparison.lineChanges.added}</span> <span style={{ color: 'var(--danger)' }}>−{comparison.lineChanges.removed}</span> строк текста </span>}· <details style={{ display: 'inline' }}><summary>Подробности</summary><code>{comparison.from ?? 'Первичная синхронизация'} → {comparison.to}</code></details></div><small>Красным отмечены удаления, зелёным — добавления. Найденные чувствительные значения скрыты только в просмотре.</small></Bar>
    {error && <Bar role="alert">{error}</Bar>}
    <Workspace><Tree><input aria-label="Поиск файла в изменениях" placeholder="Найти файл…" value={query} onChange={event => setQuery(event.target.value)} />{tree(entries.slice(0, 1000))}{entries.length > 1000 && <p>Показаны первые 1000 файлов. Уточните поиск.</p>}</Tree><Code><Bar style={{ position: 'sticky', top: 0, zIndex: 1 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><Icon name="file" /><span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{selected || (comparison?.entries.length === 0 ? 'Изменений нет' : 'Выберите файл')}</span><Switch $active={!sideBySide} onClick={() => setSideBySide(false)}>В одном списке</Switch><Switch $active={sideBySide} onClick={() => setSideBySide(true)}>Рядом</Switch></div>{loading && <p>Загрузка…</p>}</Bar>{preview?.message ? <Bar>{preview.message}</Bar> : sideBySide ? <table className="split" aria-label="Сравнение рядом"><thead><tr><th colSpan={2}>До</th><th colSpan={2}>После</th></tr></thead><tbody>{paired(rows).map((row, index) => <tr key={index}><td style={{ background: row.left?.kind === '-' ? 'var(--removed)' : undefined }}>{row.left?.old}</td><td style={{ background: row.left?.kind === '-' ? 'var(--removed)' : undefined }}>{syntax(row.left?.text ?? '')}</td><td style={{ background: row.right?.kind === '+' ? 'var(--added)' : undefined }}>{row.right?.next}</td><td style={{ background: row.right?.kind === '+' ? 'var(--added)' : undefined }}>{syntax(row.right?.text ?? '')}</td></tr>)}</tbody></table> : <table aria-label="Построчное сравнение"><tbody>{rows.map((row, i) => <Line key={i} $kind={row.kind}><td>{row.old}</td><td>{row.next}</td><td>{row.kind}</td><td>{syntax(row.text || ' ')}</td></Line>)}</tbody></table>}</Code></Workspace>
  </Panel>;
}
