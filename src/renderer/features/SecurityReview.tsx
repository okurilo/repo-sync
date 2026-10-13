import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Analysis, Finding } from '../../shared/types';
import { Button, EmptyState, Muted, Row, Status } from '../ui/components';
interface Props {
  analysis: Analysis; kept: string[]; keep: (ids: string[], retained: boolean) => void;
  selectedPaths: string[]; redactedIds: string[]; redact: (ids: string[], enabled: boolean) => void;
  exclude: (finding: Finding) => void; open: (finding: Finding) => void; busy: boolean; fileFilters?: ReactNode;
}
export function SecurityReview({ analysis, kept, keep, selectedPaths, redactedIds, redact, exclude, open, busy, fileFilters }: Props): React.JSX.Element {
  const [query, setQuery] = useState(''); const [limit, setLimit] = useState(20); const sentinel = useRef<HTMLDivElement>(null);
  const selectedSet = new Set(selectedPaths); const keptSet = new Set(kept); const maskedSet = new Set(redactedIds); const entryRules = new Map(analysis.entries.map(entry => [entry.path, entry.excludedBy]));
  const findings = analysis.findings; const groups = new Map<string, Finding[]>(); const term = query.trim().toLocaleLowerCase();
  for (const finding of findings) {
    if (term && !`${finding.path} ${finding.reason} ${finding.preview} ${finding.context?.before ?? ''} ${finding.context?.after ?? ''}`.toLocaleLowerCase().includes(term)) continue;
    const group = groups.get(finding.path) ?? []; group.push(finding); groups.set(finding.path, group);
  }
  for (const group of groups.values()) group.sort((a, b) => a.line - b.line || a.reason.localeCompare(b.reason));
  const paths = [...groups.keys()]; const active = findings.filter(f => selectedSet.has(f.path));
  const undecided = active.filter(f => !keptSet.has(f.id) && !maskedSet.has(f.id)).length;
  const excluded = analysis.entries.filter(entry => !selectedSet.has(entry.path));
  const shownActive = [...groups.values()].flat().filter(f => selectedSet.has(f.path));
  useEffect(() => { setLimit(20); }, [query]);
  useEffect(() => { const node = sentinel.current; if (!node || typeof IntersectionObserver === 'undefined') return; const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setLimit(previous => previous + 20); }, { rootMargin: '600px' }); observer.observe(node); return () => observer.disconnect(); }, [limit, paths.length]);
  if (!findings.length) return <EmptyState title="Совпадений не найдено"><Muted>Автоматическая проверка может пропустить чувствительные данные. Просмотрите изменения перед созданием пакета.</Muted>{fileFilters}</EmptyState>;
  return <div style={{ marginTop: 24, minWidth: 0 }}>
    <h2>Проверка данных</h2><Muted>Просмотрите найденные значения. Решения меняют только выгрузку; исходные файлы сохраняются.</Muted>
    <details><summary>Фильтры переноса</summary>{fileFilters}</details>
    <Row style={{ margin: '16px 0', alignItems: 'end' }}><label style={{ flex: '1 1 280px' }}>Поиск по папке, файлу или данным<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Путь, причина или найденное значение…" /></label><Button disabled={busy || !shownActive.length} onClick={() => { redact(shownActive.map(f => f.id), false); keep(shownActive.map(f => f.id), true); }}>Оставить {query ? 'найденные' : 'все'}</Button><Button disabled={busy || !shownActive.some(f => f.canReplace)} onClick={() => redact(shownActive.filter(f => f.canReplace).map(f => f.id), true)}>Заменить {query ? 'найденные' : 'все'} на *</Button></Row>
    {!paths.length && <Status>Совпадений не найдено по запросу. Измените поиск; принятые решения сохранены.</Status>}
    {paths.slice(0, limit).map(name => {
      const items = groups.get(name)!; const included = selectedSet.has(name); const rule = entryRules.get(name);
      return <section key={name} style={{ borderTop: '1px solid var(--line)', padding: '20px 0', contentVisibility: 'auto', containIntrinsicSize: 'auto 320px' }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}><div style={{ minWidth: 0 }}><code style={{ overflowWrap: 'anywhere', color: included ? 'var(--text)' : 'var(--muted)' }}>{name}</code><small style={{ display: 'block' }}>{items.length} совпадений · {rule ? `Исключено правилом ${rule}` : included ? 'Входит в выгрузку' : 'Исключён из выгрузки'}</small></div><Row><Button disabled={busy || !!rule} onClick={() => exclude(items[0]!)}>{included ? 'Исключить файл' : 'Вернуть файл'}</Button><Button disabled={busy} onClick={() => open(items[0]!)}>Показать файл</Button></Row></Row>
        <div style={{ color: included ? 'var(--text)' : 'var(--muted)' }}>
          {items.map(finding => {
            const masked = maskedSet.has(finding.id); const retained = keptSet.has(finding.id); const ctx = finding.context;
            return <div key={finding.id} style={{ padding: '12px 0', borderTop: '1px solid var(--line)' }}>
              <Row style={{ justifyContent: 'space-between' }}><div><strong>{finding.reason}</strong><small style={{ display: 'block' }}>Строка {finding.line} · {finding.severity === 'block' ? 'Данные доступа' : 'Персональные данные'}</small></div><label>В выгрузке<select aria-label={`Решение: ${name}, строка ${finding.line}, ${finding.reason}`} disabled={busy || !included} value={masked ? 'mask' : retained ? 'keep' : 'undecided'} onChange={event => { const choice = event.target.value; keep([finding.id], choice === 'keep'); redact([finding.id], choice === 'mask'); }}><option value="undecided">Не решено</option><option value="keep">Оставить значение</option>{finding.canReplace && <option value="mask">Заменить на *</option>}</select></label></Row>
              <pre style={{ padding: 12, background: 'var(--input)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6, margin: '10px 0' }}><code>{ctx ? <>{ctx.before}<mark style={{ color: included ? 'var(--warning)' : 'var(--muted)', background: 'var(--raised)' }}>{ctx.match}</mark>{ctx.after}</> : finding.preview}</code></pre>
              {masked && <small>В выгрузке: <code>{(ctx?.match ?? finding.preview).replace(/[^\r\n]/gu, '*')}</code> · исходник без изменений</small>}
              {!included && <small>Файл пропущен. Решение сохранено и восстановится при возврате файла.</small>}
            </div>;
          })}
        </div>
      </section>;
    })}
    {paths.length > limit && <div ref={sentinel}><Button onClick={() => setLimit(previous => previous + 20)}>Показать ещё · осталось {paths.length - limit}</Button></div>}
    <div role="status" style={{ position: 'sticky', bottom: 0, background: 'var(--raised)', padding: '14px 16px', borderTop: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums', zIndex: 2 }}><Row><strong>Выгрузка: {selectedPaths.length} файлов</strong><span>Исключено: {excluded.length} · масками: {excluded.filter(entry => entry.excludedBy).length}</span><span>Оставлено значений: {active.filter(f => keptSet.has(f.id)).length}</span><span>Заменено: {active.filter(f => maskedSet.has(f.id)).length}</span><strong style={{ color: undecided ? 'var(--warning)' : 'var(--text)' }}>Не решено: {undecided}</strong></Row></div>
  </div>;
}
