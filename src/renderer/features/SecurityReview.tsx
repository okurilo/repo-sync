import { useState } from 'react';
import type { Analysis, Finding } from '../../shared/types';
import { Badge, Button, EmptyState, Muted, Row, Surface } from '../ui/components';
interface Props {
  analysis: Analysis; kept: string[]; keep: (ids: string[], retained: boolean) => void;
  exclude: (finding: Finding) => void; replace: (finding: Finding) => void;
  open: (finding: Finding) => void; busy: boolean;
}
export function SecurityReview({ analysis, kept, keep, exclude, replace, open, busy }: Props): React.JSX.Element {
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const findings = analysis.findings;
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) { const group = groups.get(finding.path) ?? []; group.push(finding); groups.set(finding.path, group); }
  const paths = [...groups.keys()];
  const matches = paths.filter(path => path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const path = matches.includes(selected) ? selected : matches[0];
  const items = path ? groups.get(path)! : [];
  const allKept = findings.length > 0 && findings.every(finding => kept.includes(finding.id));
  if (!findings.length) return <EmptyState title="Совпадений не найдено"><Muted>Автоматическая проверка может пропустить чувствительные данные. Просмотрите изменения перед созданием пакета.</Muted></EmptyState>;
  return <Surface style={{ marginTop: 24 }}>
    <Row style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Проверка данных</h2><Badge>Совпадений: {findings.length} · Файлов: {paths.length} · Оставлено: {kept.length}</Badge></Row>
    <Muted>Отмеченные значения сохранятся в пакете без изменений. Исключение файла сохраняется в настройках.</Muted>
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}><input type="checkbox" disabled={busy} checked={allKept} ref={element => { if (element) element.indeterminate = kept.length > 0 && !allKept; }} onChange={event => keep(findings.map(finding => finding.id), event.target.checked)} />Оставить все найденные значения в пакете</label>
    <div style={{ display: 'grid', gridTemplateColumns: '210px minmax(0, 1fr)', gap: 24 }}>
      <nav aria-label="Файлы с найденными данными" style={{ minWidth: 0 }}>
        <input type="search" aria-label="Поиск файла с найденными данными" placeholder="Найти файл…" value={query} onChange={event => setQuery(event.target.value)} />
        <div style={{ maxHeight: '55vh', overflowY: 'auto', marginTop: 12 }}>
          {matches.map(name => {
            const group = groups.get(name)!;
            const remaining = group.filter(finding => !kept.includes(finding.id)).length;
            return <Button key={name} disabled={busy} aria-pressed={path === name} onClick={() => setSelected(name)} style={{ width: '100%', display: 'grid', justifyItems: 'start', textAlign: 'left', marginBottom: 6, background: path === name ? 'var(--tint)' : 'transparent' }}><code style={{ overflowWrap: 'anywhere' }}>{name}</code><small>Совпадений: {group.length} · Не отмечено: {remaining}</small></Button>;
          })}
          {!matches.length && <Muted>Файлы не найдены.</Muted>}
        </div>
      </nav>
      <div style={{ minWidth: 0 }}>
        {path && <><Row style={{ justifyContent: 'space-between', marginBottom: 16 }}><code>{path}</code><Button disabled={busy} onClick={() => exclude(items[0]!)}>Исключить файл</Button></Row>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}><input type="checkbox" disabled={busy} checked={items.every(finding => kept.includes(finding.id))} onChange={event => keep(items.map(finding => finding.id), event.target.checked)} />Оставить все значения в этом файле</label>
          <div style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: 8 }}>
            {items.map(finding => <section key={finding.id} style={{ padding: '16px 0', borderTop: '1px solid var(--line)' }}>
              <Row style={{ justifyContent: 'space-between' }}><label style={{ display: 'flex', alignItems: 'center', gap: 10 }}><input type="checkbox" disabled={busy} checked={kept.includes(finding.id)} onChange={event => keep([finding.id], event.target.checked)} />Оставить в пакете · строка {finding.line}</label><Badge>{finding.severity === 'block' ? 'Данные доступа' : 'Персональные данные'}</Badge></Row>
              <p style={{ margin: '10px 0' }}>{finding.reason}</p>
              <pre style={{ padding: 14, background: 'var(--input)', borderRadius: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}><code>{finding.context ? <>{finding.context.before}<mark style={{ color: 'var(--warning)', background: 'var(--raised)' }}>{finding.context.match}</mark>{finding.context.after}</> : finding.preview}</code></pre>
              <Row>{finding.canReplace && <Button disabled={busy} onClick={() => replace(finding)}>Заменить в исходнике</Button>}<Button disabled={busy} onClick={() => open(finding)}>Показать файл</Button></Row>
            </section>)}
          </div>
        </>}
      </div>
    </div>
  </Surface>;
}
