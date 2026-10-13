import { useEffect, useState } from 'react';
import type { AppUpdateState } from '../../shared/types';
import { Button, Row, Status } from '../ui/components';
export function AppUpdate({ busy, run }: { busy: boolean; run: (operation: () => Promise<void>) => void }): React.JSX.Element {
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let valid = true;
    const read = (): void => { void window.reposync.appUpdateStatus().then(next => { if (valid) setState(next); }).catch(() => { /* polling retries while the app stays open */ }); };
    read(); const timer = window.setInterval(read, 1000);
    return () => { valid = false; clearInterval(timer); };
  }, []);
  const inspect = (root?: string): void => run(async () => {
    setWorking(true); setError('');
    try { const next = await window.reposync.appUpdateInspect(root); setState(next); setBranch(next.branches.includes(branch) ? branch : next.branches.includes(next.branch) ? next.branch : next.branches.includes('main') ? 'main' : next.branches[0] ?? ''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось получить ветки.'); }
    finally { setWorking(false); }
  });
  const running = working || state?.phase === 'building' || state?.phase === 'checking' || state?.phase === 'restarting';
  return <section aria-labelledby="app-update-title" style={{ borderTop: '1px solid var(--line)', paddingTop: 20, display: 'grid', gap: 12 }}>
    <h3 id="app-update-title" style={{ margin: 0 }}>Обновление приложения</h3>
    <small>Выберите ветку RepoSync. Приложение загрузит изменения, соберёт новую версию и перезапустится. Предыдущая версия сохранится рядом.</small>
    {state?.root && <small style={{ overflowWrap: 'anywhere' }}>Исходники: <code>{state.root}</code>{state.branch && <> · Сейчас: <code>{state.branch}</code></>}</small>}
    <Row><Button disabled={busy || running} onClick={() => inspect()}>Получить ветки</Button><Button disabled={busy || running} onClick={() => run(async () => { const root = await window.reposync.chooseDirectory(); if (root) { setError(''); setWorking(true); try { const next = await window.reposync.appUpdateInspect(root); setState(next); setBranch(next.branches.includes(next.branch) ? next.branch : next.branches[0] ?? ''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось получить ветки.'); } finally { setWorking(false); } } })}>Выбрать исходники</Button></Row>
    {!!state?.branches.length && <><label>Ветка обновления<select disabled={busy || running} value={branch} onChange={event => setBranch(event.target.value)}><option value="" disabled>Выберите ветку</option>{state.branches.map(name => <option key={name} value={name}>{name}</option>)}</select></label><small>Сценарий сборки определяется из package.json выбранной ветки.</small><Button $primary disabled={busy || running || !branch || state.phase !== 'idle'} onClick={() => run(async () => {
      setWorking(true); setError('');
      try { await window.reposync.appUpdate(branch); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Обновление не завершено.'); }
      finally { setWorking(false); }
    })}>Обновить и перезапустить</Button></>}
    {running && <Row><span role="status">{state?.message || 'Проверка обновления…'}</span>{state?.phase !== 'restarting' && <Button onClick={() => { void window.reposync.cancelAppUpdate().catch(cause => setError(cause instanceof Error ? cause.message : 'Не удалось отменить обновление.')); }}>Отменить обновление</Button>}</Row>}
    {(error || state?.error) && <Status $error role="alert" style={{ margin: 0 }}>{error || state?.error}</Status>}
    <details><summary>Как выполняется обновление</summary><p>Нужны Git, Node.js и npm. Незакоммиченные изменения и расходящаяся история остановят обновление. Сборка выполняется отдельно от работающего приложения; замена происходит после её закрытия.</p>{state?.command && <p>Определённый сценарий: <code>{state.command}</code></p>}<p>Автоматическая замена и перезапуск доступны на macOS и Windows.</p></details>
  </section>;
}
