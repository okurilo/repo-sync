import { appVersionLabel } from '../../shared/types';
import { useState } from 'react';
import type { AppUpdateState } from '../../shared/types';
import { Button, Row, Status } from '../ui/components';
export function AppUpdate({ state, branch, change, checked, busy, run }: { state: AppUpdateState | null; branch: string; change: (branch: string) => void; checked: (state: AppUpdateState) => void; busy: boolean; run: (operation: () => Promise<void>) => void }): React.JSX.Element {
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const running = working || state?.phase === 'building' || state?.phase === 'checking' || state?.phase === 'restarting';
  const head = state?.heads?.[branch];
  const available = !!state?.installedCommit && !!head && head !== state.installedCommit && state.phase === 'idle';
  const perform = (operation: () => Promise<void>): void => run(async () => {
    setWorking(true); setError('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Проверка обновления не завершена.'); }
    finally { setWorking(false); }
  });
  return <section aria-labelledby="app-update-title" style={{ borderTop: '1px solid var(--line)', paddingTop: 20, display: 'grid', gap: 12 }}>
    <h3 id="app-update-title" style={{ margin: 0 }}>Обновление приложения</h3>
    <span style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>Установлено: {appVersionLabel(state)}</span>
    {!!state?.branches.length && <label>Ветка<select disabled={busy || running} value={branch} onChange={event => { setError(''); change(event.target.value); }}>{state.branches.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
    {!running && !error && !state?.error && state?.checkedAt && <span role="status">{!state.installedCommit ? 'Коммит этой сборки неизвестен. Установите сборку с данными версии.' : !head ? 'Выберите ветку для проверки.' : available ? 'Доступна новая версия.' : 'Приложение обновлено до версии этой ветки.'}</span>}
    <Row><Button disabled={busy || running} onClick={() => perform(async () => checked(await window.reposync.appUpdateInspect()))}>Проверить обновление</Button>{available && <Button $primary disabled={busy || running} onClick={() => perform(() => window.reposync.appUpdate(branch))}>Обновить и перезапустить</Button>}</Row>
    {available && <small>Новая версия будет собрана и запущена автоматически. Предыдущая версия сохранится рядом.</small>}
    {running && <Row><span role="status">{state?.message || 'Проверка обновления…'}</span>{state?.phase !== 'restarting' && <Button onClick={() => { void window.reposync.cancelAppUpdate().catch(cause => setError(cause instanceof Error ? cause.message : 'Не удалось отменить обновление.')); }}>Отменить</Button>}</Row>}
    {(error || state?.error) && <Status $error role="alert" style={{ margin: 0 }}>{error || state?.error}</Status>}
    <details><summary>Подробности обновления</summary>{state?.checkedAt && <p>Проверено: {new Date(state.checkedAt).toLocaleString('ru-RU')}</p>}<p>Текущая сборка: <code>{state?.installedCommit?.slice(0, 8) ?? 'не определена'}</code>{head && <> · Ветка: <code>{head.slice(0, 8)}</code></>}</p>{state?.root && <p style={{ overflowWrap: 'anywhere' }}>Исходники: <code>{state.root}</code></p>}<p>Git, Node.js и npm нужны для сборки. Папка исходников и команда определяются автоматически. Незакоммиченные изменения остановят обновление.</p></details>
  </section>;
}
