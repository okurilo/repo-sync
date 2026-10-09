import styled from 'styled-components';
import type { Profile } from '../../shared/types';
import { Icon } from '../Appearance';
import { Badge, Button, Muted, Row, Surface } from '../ui/components';
export const syncDate = (date?: string): string => date ? new Date(date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Ещё не выполнялась';
export const RepositoryGrid = styled('div')({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 20 });
const Route = styled('div')({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 28px minmax(0, 1fr)', gap: 12, padding: 18, margin: '20px 0', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--input)', '& > div': { minWidth: 0 }, '& code': { display: 'block', marginTop: 6 }, '& small': { display: 'block', marginTop: 6 } });
export function repositoryStatus(profile: Profile): string {
  if (!profile.sources.internal || (profile.role === 'internal' && !profile.sources.global)) return 'Нужна настройка';
  if (profile.pending) return 'Пакет ждёт подтверждения';
  if (profile.commitRequired) return 'Нужен коммит';
  return 'Готов к сравнению';
}
export function RepositoryCard({ profile, busy, open, incoming, outgoing, importPackage }: { profile: Profile; busy: boolean; open: () => void; incoming: () => void; outgoing: () => void; importPackage: () => void }): React.JSX.Element {
  const local = profile.sources.internal; const remote = profile.sources.global; const status = repositoryStatus(profile);
  return <Surface style={{ border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minWidth: 0 }}><Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><div><Row><span style={{ padding: 10, background: 'var(--tint)', color: 'var(--accent)', borderRadius: 10 }}><Icon name="folder" /></span><h2 style={{ margin: 0, overflowWrap: 'anywhere' }}>{profile.name}</h2></Row><small style={{ display: 'block', marginTop: 12 }}>{profile.role === 'internal' ? 'Внутренний репозиторий' : 'Внешний репозиторий'}</small></div><Badge style={{ color: status === 'Готов к сравнению' ? 'var(--success)' : 'var(--warning)' }}>{status}</Badge></Row>
    <Route><div><small>{profile.role === 'internal' ? 'Внешний Git' : 'Входящий пакет'}</small><code>{profile.role === 'internal' ? remote?.branch ?? 'Не настроен' : '.md · выбранные файлы'}</code><small>{profile.role === 'internal' ? remote?.location ?? 'Укажите источник' : 'Выбор файлов перед применением'}</small></div><span style={{ alignSelf: 'center', color: 'var(--accent)' }}><Icon name="arrow" /></span><div><small>Локальный Git</small><code>{local?.branch ?? 'Ветка не выбрана'}</code><small>{local?.location ?? 'Укажите локальный репозиторий'}</small></div></Route>
    <Row style={{ justifyContent: 'space-between' }}><small>Изменения: не проверено</small><small>{syncDate(profile.syncedAt)}</small></Row><Muted style={{ fontSize: 13 }}>{profile.pending ? 'Подтвердите применение перед следующим переносом.' : profile.commitRequired ? 'Сохраните применённые изменения коммитом своими Git-инструментами.' : 'Выберите изменения и проверьте результат перед переносом.'}</Muted>
    <Row style={{ marginTop: 'auto' }}>{profile.pending || !local ? <Button $primary disabled={busy} onClick={open}>{profile.pending ? 'Подтвердить пакет' : 'Настроить'}</Button> : profile.role === 'internal' ? <><Button $primary disabled={busy || !remote} onClick={incoming}><Icon name="import" />Получить изменения</Button><Button disabled={busy} onClick={outgoing}>Подготовить пакет</Button></> : <Button $primary disabled={busy} onClick={importPackage}><Icon name="import" />Выбрать пакет</Button>}<Button disabled={busy} onClick={open}>Открыть <Icon name="arrow" /></Button></Row>
  </Surface>;
}
