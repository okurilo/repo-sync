import { useState } from 'react';
import type { Profile, ProjectFilters, Settings } from '../../shared/types';
import { Button, Muted, Row } from '../ui/components';
interface Props { settings: Settings; profile?: Profile; busy: boolean; save: (global: string[] | null, filters?: ProjectFilters) => Promise<void> }
export function FileFilters({ settings, profile, busy, save }: Props): React.JSX.Element {
  const [text, setText] = useState((profile ? profile.filters?.extra ?? profile.exclusions : settings.globalExclusions).join('\n'));
  const [disabled, setDisabled] = useState(profile?.filters?.disabled ?? []);
  const rules = text.split('\n').map(rule => rule.trim()).filter(Boolean);
  const changed = text !== (profile ? profile.filters?.extra ?? profile.exclusions : settings.globalExclusions).join('\n') || JSON.stringify(disabled) !== JSON.stringify(profile?.filters?.disabled ?? []);
  return <div style={{ display: 'grid', gap: 10, margin: '14px 0', maxWidth: 680 }}>
    <h3 style={{ margin: 0 }}>{profile ? 'Исключения из переноса' : 'Шаблон исключений'}</h3>
    <Muted style={{ margin: 0 }}>{profile ? 'Совпавшие файлы видны отключёнными и не переносятся. Настройки сохраняются для этого проекта.' : 'Общие маски наследуются всеми проектами. В фильтрах проекта можно отключить отдельные правила и добавить свои.'}</Muted>
    {profile && settings.globalExclusions.length > 0 && <fieldset disabled={busy} style={{ display: 'grid', gap: 8, border: 0, padding: 0 }}><legend>Общие правила</legend>{settings.globalExclusions.map(rule => <label key={rule} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!disabled.includes(rule)} onChange={event => setDisabled(event.target.checked ? disabled.filter(item => item !== rule) : [...disabled, rule])} /><code style={{ overflowWrap: 'anywhere' }}>{rule}</code></label>)}</fieldset>}
    <label>{profile ? 'Дополнительные маски проекта' : 'Glob-маски — одна на строку'}<textarea rows={3} disabled={busy} value={text} onChange={event => setText(event.target.value)} placeholder={'**/*.test.*\n**/*.snapshot\n**/__snapshots__/**'} spellCheck={false} /></label>
    <small>Пути относительно корня. ** — вложенные папки, * — часть имени. Без отрицания !. Правило переименования проверяет оба пути.</small>
    <Row><Button disabled={busy || !changed} onClick={() => void save(profile ? null : rules, profile ? { extra: rules, disabled } : undefined)}>Применить правила</Button>{profile && <Button disabled={busy} onClick={() => { setText(''); setDisabled([]); void save(null, { extra: [], disabled: [] }); }}>Сбросить настройки проекта</Button>}</Row>
  </div>;
}
