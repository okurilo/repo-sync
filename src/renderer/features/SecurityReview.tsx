import { useMemo, useState, type ReactNode } from 'react';
import styled from 'styled-components';
import type { Analysis, Finding } from '../../shared/types';
import { Button, Muted, Row } from '../ui/components';

interface Props {
  analysis: Analysis; kept: string[]; decide: (ids: string[], choice: 'keep' | 'mask' | 'undecided') => void;
  selectedPaths: string[]; togglePath: (path: string, included: boolean) => void;
  redactedIds: string[]; open: (finding: Finding) => void; busy: boolean;
}
interface FileNode { folders: Map<string, FileNode>; paths: string[] }

const Workspace = styled('div')({ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', minHeight: 480, maxHeight: 'min(72vh, 820px)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', background: 'var(--surface)', '@media(max-width: 700px)': { gridTemplateColumns: 'minmax(0, 1fr)', maxHeight: 'none' } });
const Navigation = styled('nav')({ minHeight: 0, overflowY: 'auto', padding: 14, background: 'var(--raised)', borderRight: '1px solid var(--line)', '@media(max-width: 700px)': { maxHeight: 300, borderRight: 0, borderBottom: '1px solid var(--line)' } });
const Details = styled('section')({ minWidth: 0, minHeight: 0, overflowY: 'auto', padding: '20px 24px', '@media(max-width: 700px)': { minHeight: 360 } });
const PathButton = styled('button')<{ $active: boolean }>(({ $active }) => ({ flex: 1, minWidth: 0, overflowWrap: 'anywhere', textAlign: 'left', border: 0, borderRadius: 4, padding: '6px 8px', background: $active ? 'var(--tint)' : 'transparent', color: $active ? 'var(--text)' : 'var(--muted)', fontSize: 12 }));
const Finding = styled('article')({ padding: '14px 0', borderTop: '1px solid var(--line)', '& pre': { padding: 12, background: 'var(--input)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6, margin: '10px 0' } });

export function SecurityReview({ analysis, kept, decide, selectedPaths, togglePath, redactedIds, open, busy }: Props): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [onlyUndecided, setOnlyUndecided] = useState(false);
  const [selectedPath, setSelectedPath] = useState(() => analysis.findings.find(item => selectedPaths.includes(item.path))?.path ?? selectedPaths[0] ?? analysis.entries[0]?.path ?? '');
  const [limit, setLimit] = useState(1000);
  const selected = new Set(selectedPaths); const keptSet = new Set(kept); const maskedSet = new Set(redactedIds);
  const findingsByPath = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const finding of analysis.findings) { const group = map.get(finding.path) ?? []; group.push(finding); map.set(finding.path, group); }
    for (const group of map.values()) group.sort((a, b) => a.line - b.line || a.reason.localeCompare(b.reason));
    return map;
  }, [analysis.findings]);
  const entryByPath = useMemo(() => new Map(analysis.entries.map(entry => [entry.path, entry])), [analysis.entries]);
  const unresolvedByPath = new Map<string, number>();
  for (const [path, items] of findingsByPath) unresolvedByPath.set(path, items.filter(item => !keptSet.has(item.id) && !maskedSet.has(item.id)).length);
  const term = query.trim().toLocaleLowerCase();
  const visibleEntries = analysis.entries.filter(entry => {
    const items = findingsByPath.get(entry.path) ?? [];
    const matches = !term || `${entry.path} ${items.map(item => `${item.reason} ${item.preview} ${item.context?.before ?? ''} ${item.context?.after ?? ''}`).join(' ')}`.toLocaleLowerCase().includes(term);
    return matches && (!onlyUndecided || (unresolvedByPath.get(entry.path) ?? 0) > 0 || entry.path === selectedPath);
  });
  const treeEntries = visibleEntries.slice(0, limit);
  if (visibleEntries.slice(limit).some(entry => entry.path === selectedPath)) {
    const current = visibleEntries.find(entry => entry.path === selectedPath);
    if (current) treeEntries.push(current);
  }
  const selectedEntry = analysis.entries.find(entry => entry.path === selectedPath);
  const selectedFindings = findingsByPath.get(selectedPath) ?? [];
  const isIncluded = selected.has(selectedPath) && !selectedEntry?.excludedBy;
  const unresolved = selectedFindings.filter(item => !keptSet.has(item.id) && !maskedSet.has(item.id));
  const replaceable = unresolved.filter(item => item.canReplace);
  const totalUndecided = analysis.findings.filter(item => selected.has(item.path) && !keptSet.has(item.id) && !maskedSet.has(item.id)).length;

  const tree = useMemo(() => {
    const root: FileNode = { folders: new Map(), paths: [] };
    for (const entry of visibleEntries) {
      const parts = entry.path.split('/'); let node = root;
      for (const folder of parts.slice(0, -1)) { let next = node.folders.get(folder); if (!next) { next = { folders: new Map(), paths: [] }; node.folders.set(folder, next); } node = next; }
      node.paths.push(entry.path);
    }
    return root;
  }, [treeEntries]);

  function renderTree(node: FileNode, prefix = ''): ReactNode {
    const folders = [...node.folders].sort(([a], [b]) => a.localeCompare(b));
    const files = [...node.paths].sort((a, b) => a.localeCompare(b));
    return <>
      {folders.map(([folder, child]) => <details key={`${prefix}${folder}`} open>
        <summary style={{ padding: '5px 0', overflowWrap: 'anywhere' }}>{folder}/</summary>
        <div style={{ paddingLeft: 10 }}>{renderTree(child, `${prefix}${folder}/`)}</div>
      </details>)}
      {files.map(path => {
        const entry = entryByPath.get(path)!; const items = findingsByPath.get(path) ?? [];
        const pending = unresolvedByPath.get(path) ?? 0; const included = selected.has(path) && !entry.excludedBy;
        const status = entry.excludedBy ? `Исключено правилом ${entry.excludedBy}` : !included ? 'Исключён' : pending ? `Нужно решение · ${pending}` : items.length ? 'Проверен' : 'Без совпадений';
        return <Row key={path} style={{ gap: 4, flexWrap: 'nowrap', alignItems: 'start' }}>
          <input aria-label={`${included ? 'Исключить' : 'Включить'} файл ${path}`} type="checkbox" checked={included} disabled={busy || !!entry.excludedBy} onChange={event => togglePath(path, event.target.checked)} style={{ marginTop: 9 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
          <PathButton type="button" $active={path === selectedPath} aria-current={path === selectedPath ? 'page' : undefined} onClick={() => setSelectedPath(path)}>{path.split('/').at(-1)}</PathButton>
            <small style={{ display: 'block', padding: '0 8px 5px', overflowWrap: 'anywhere' }}>{status}</small>
          </div>
        </Row>;
      })}
    </>;
  }

  function decideFile(choice: 'keep' | 'mask'): void {
    const ids = (choice === 'keep' ? unresolved : replaceable).map(item => item.id);
    if (ids.length) decide(ids, choice);
  }
  function nextUndecided(): void {
    const paths = analysis.entries.filter(entry => selected.has(entry.path) && !entry.excludedBy && (unresolvedByPath.get(entry.path) ?? 0) > 0).map(entry => entry.path);
    if (!paths.length) return;
    const index = paths.indexOf(selectedPath); setSelectedPath(paths[(index + 1 + paths.length) % paths.length]!);
  }

  return <div style={{ marginTop: 24, minWidth: 0 }}>
    <h2>Проверка данных</h2>
    <Muted>Решения относятся к выгрузке. Исходные файлы останутся без изменений.</Muted>
    <Workspace aria-label="Пофайловая проверка данных">
      <Navigation aria-label="Файлы пакета">
        <label style={{ fontSize: 12, marginBottom: 12 }}>Найти файл или совпадение<input type="search" value={query} onChange={event => { setLimit(1000); setQuery(event.target.value); }} placeholder="Путь, причина или значение…" /></label>
        <label style={{ display: 'flex', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 8, margin: '10px 0 14px', fontSize: 12 }}><input type="checkbox" checked={onlyUndecided} onChange={event => { setLimit(1000); setOnlyUndecided(event.target.checked); }} />Только требующие решения</label>
        <small>В пакете: {selectedPaths.length} из {analysis.entries.length}</small>
        <div style={{ marginTop: 8 }}>{renderTree(tree)}</div>
        {visibleEntries.length > limit && <Button style={{ marginTop: 8 }} disabled={busy} onClick={() => setLimit(previous => previous + 1000)}>Показать ещё · осталось {visibleEntries.length - limit}</Button>}
        {!visibleEntries.length && <p>Файлы не найдены. Измените поиск или фильтр.</p>}
      </Navigation>
      <Details aria-label={selectedPath ? `Проверка файла ${selectedPath}` : 'Проверка файла'}>
        {!selectedEntry ? <p>Выберите файл в дереве.</p> : <>
          <Row style={{ justifyContent: 'space-between', alignItems: 'start' }}><div style={{ minWidth: 0 }}><code style={{ overflowWrap: 'anywhere' }}>{selectedPath}</code><small style={{ display: 'block', marginTop: 6 }}>{selectedEntry.excludedBy ? `Исключено правилом ${selectedEntry.excludedBy}` : isIncluded ? 'Входит в пакет' : 'Исключён из пакета'} · совпадений: {selectedFindings.length} · нерешённых: {unresolved.length}</small></div>
            {selectedFindings[0] && <Button disabled={busy} onClick={() => open(selectedFindings[0]!)}>Показать файл</Button>}
          </Row>
          <Row style={{ margin: '16px 0', gap: 8 }}>
            <Button disabled={busy || !unresolved.length || !isIncluded} onClick={() => decideFile('keep')}>Принять файл · {unresolved.length}</Button>
            <Button disabled={busy || !replaceable.length || !isIncluded} onClick={() => decideFile('mask')}>Заменить нерешённые на * · {replaceable.length}</Button>
            <Button disabled={busy || !!selectedEntry.excludedBy} onClick={() => togglePath(selectedPath, !isIncluded)}>{isIncluded ? 'Исключить файл' : 'Вернуть файл'}</Button>
            <Button disabled={busy || !totalUndecided} onClick={nextUndecided}>Следующий нерешённый</Button>
          </Row>
          {selectedFindings.length ? selectedFindings.map(finding => {
            const masked = maskedSet.has(finding.id); const retained = keptSet.has(finding.id); const context = finding.context;
            return <Finding key={finding.id}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'start' }}><div><strong>{finding.reason}</strong><small style={{ display: 'block' }}>Строка {finding.line} · {finding.severity === 'block' ? 'Данные доступа' : 'Персональные данные'}</small></div>
                <label style={{ minWidth: 210 }}>В выгрузке<select aria-label={`Решение: ${selectedPath}, строка ${finding.line}, ${finding.reason}`} disabled={busy || !isIncluded} value={masked ? 'mask' : retained ? 'keep' : 'undecided'} onChange={event => decide([finding.id], event.target.value as 'keep' | 'mask' | 'undecided')}><option value="undecided">Не решено</option><option value="keep">Оставить значение</option>{finding.canReplace && <option value="mask">Заменить на *</option>}</select></label>
              </Row>
              <pre><code>{context ? <>{context.before}<mark style={{ color: isIncluded ? 'var(--warning)' : 'var(--muted)', background: 'var(--raised)' }}>{context.match}</mark>{context.after}</> : finding.preview}</code></pre>
              {masked && <small>В выгрузке: <code>{(context?.match ?? finding.preview).replace(/[^\r\n]/gu, '*')}</code> · исходник без изменений</small>}
              {!isIncluded && <small style={{ display: 'block', marginTop: 8 }}>Файл пропущен. Решение сохранено и восстановится при возврате файла.</small>}
            </Finding>;
          }) : <p>{isIncluded ? 'Совпадений не найдено. Автоматическая проверка может пропустить чувствительные данные; проверьте содержимое файла.' : 'Файл исключён из пакета и не сканировался.'}</p>}
        </>}
      </Details>
    </Workspace>
  </div>;
}
