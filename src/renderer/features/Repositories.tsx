import styled from 'styled-components';
import type { Profile, ProjectGitSummary } from '../../shared/types';
import { Icon } from '../Appearance';
import { Badge, Button, Row, Surface } from '../ui/components';
export const syncDate = (date?: string): string => date ? new Date(date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Ещё не выполнялась';
export const RepositoryGrid = styled('div')({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0 });
const GitLine = styled('div')({ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', fontSize: 13, '& > strong': { minWidth: 100 }, '& code': { fontSize: 13 }, '& small': { fontSize: 12 } });
export function repositoryStatus(profile: Profile): string {
  if (!profile.sources.internal || (profile.role === 'internal' && !profile.sources.global)) return 'Нужна настройка';
  if (profile.pending) return 'Пакет ждёт подтверждения';
  if (profile.commitRequired) return 'Нужен коммит';
  return 'Настроен';
}
export function RepositoryCard({ profile, gitSummary, refreshGit, busy, open, incoming, outgoing, importPackage }: { profile: Profile; gitSummary?: ProjectGitSummary; refreshGit: () => void; busy: boolean; open: () => void; incoming: () => void; outgoing: () => void; importPackage: () => void }): React.JSX.Element {
  const local = profile.sources.internal; const remote = profile.sources.global; const status = repositoryStatus(profile);
  const observed = gitSummary?.local;
  const changes = observed ? observed.workingChanges.staged + observed.workingChanges.unstaged + observed.workingChanges.untracked : 0;
  const update = gitSummary?.remote?.availableHead !== undefined && gitSummary.remote.availableHead !== gitSummary.remote.head;
  return <Surface style={{ borderTop: '1px solid var(--line)', background: 'transparent', padding: '24px 0', minWidth: 0, overflowWrap: 'anywhere' }}>
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
      <div><Row style={{ gap: 12 }}><h2 style={{ margin: 0 }}>{profile.name}</h2>{status !== 'Настроен' && <Badge style={{ color: 'var(--warning)' }}>{status}</Badge>}</Row><small style={{ display: 'block', marginTop: 4 }}>{profile.role === 'internal' ? 'Внутренний контур' : 'Внешний контур'}</small></div>
      <Row style={{ gap: 8 }}>{profile.pending || status === 'Нужна настройка' ? <Button $primary disabled={busy} onClick={open}>{profile.pending ? 'Подтвердить пакет' : 'Настроить'}</Button> : profile.role === 'internal' ? <><Button $primary disabled={busy || !remote} onClick={incoming}><Icon name="import" />Получить изменения из Git</Button><Button disabled={busy} onClick={outgoing}>Подготовить пакет</Button></> : <Button $primary disabled={busy} onClick={importPackage}><Icon name="import" />Выбрать пакет</Button>}<Button disabled={busy} onClick={open}>Открыть <Icon name="arrow" /></Button></Row>
    </Row>
    <div style={{ display: 'grid', gap: 8, marginTop: 18 }}>
      <GitLine><strong>Локальный Git</strong>{observed ? <><code>{observed.branch ?? 'detached HEAD'}</code><small>{gitSummary?.localDate ? syncDate(gitSummary.localDate) : 'Нет коммитов'}</small><small>{changes ? `${changes} изменений` : 'Чистая рабочая копия'}</small></> : <small>{gitSummary?.localError ?? (!local ? 'Не настроен' : 'Чтение состояния…')}</small>}</GitLine>
      {observed?.issue && <div style={{ fontSize: 13, color: 'var(--warning)' }}>{observed.issue}</div>}
      {remote && <GitLine><strong>Внешний Git</strong><code>{remote.branch}</code><small>{gitSummary?.remote?.date ? syncDate(gitSummary.remote.date) : 'Не загружен'}</small>{update && <><strong style={{ color: 'var(--warning)', minWidth: 0 }}>{gitSummary?.remote?.availableHead ? 'Есть обновление' : 'Ветка отсутствует на сервере'}</strong>{gitSummary?.remote?.availableHead && <Button disabled={busy} onClick={refreshGit}>Обновить</Button>}</>}{gitSummary?.remote?.error && <span style={{ color: 'var(--warning)' }}>Не удалось проверить обновления</span>}</GitLine>}
      <small>{profile.lastAction ? <>{profile.lastAction.type} · {syncDate(profile.lastAction.at)}</> : profile.syncedAt ? <>Последний перенос · {syncDate(profile.syncedAt)}</> : 'Действий пока нет'}</small>
    </div>
    <details style={{ marginTop: 12, fontSize: 12 }}><summary>Подробности проекта</summary><div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      <div>Локальный репозиторий: <code>{local?.location ?? 'Не настроен'}</code></div>
      {local && <div>Ветка для применения: <code>{local.branch}</code> · HEAD: <code>{observed?.head ?? 'Не проверен'}</code></div>}
      {remote && <><div>Внешний репозиторий: <code>{remote.location}</code></div><div>HEAD кэша: <code>{gitSummary?.remote?.head ?? 'Не загружен'}</code></div><div>{gitSummary?.remote?.error ? `Проверка не выполнена: ${gitSummary.remote.error}` : gitSummary?.remote?.checkedAt ? `Проверено: ${syncDate(gitSummary.remote.checkedAt)}` : 'Ожидает проверки обновлений'}</div></>}
      {profile.syncedAt && profile.lastAction && <div>Последний перенос: {syncDate(profile.syncedAt)}</div>}
      {profile.commitRequired && <div>Сохраните применённые изменения коммитом в своём Git-клиенте.</div>}
    </div></details>
  </Surface>;
}
