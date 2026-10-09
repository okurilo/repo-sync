import styled from 'styled-components';
import type { Profile } from '../../shared/types';
import { Icon } from '../Appearance';
import { Badge, Button, Muted, Row, Surface } from '../ui/components';
export const syncDate = (date?: string): string => date ? new Date(date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Ещё не выполнялась';
export const RepositoryGrid = styled('div')({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0 });
const Route = styled('div')({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 28px minmax(0, 1fr)', gap: 12, padding: '0 0 16px', margin: '16px 0 0', background: 'transparent', '& > div': { minWidth: 0 }, '& code': { display: 'block', marginTop: 6 }, '& small': { display: 'block', marginTop: 6 } });
export function repositoryStatus(profile: Profile): string {
  if (!profile.sources.internal || (profile.role === 'internal' && !profile.sources.global)) return 'Нужна настройка';
  if (profile.pending) return 'Пакет ждёт подтверждения';
  if (profile.commitRequired) return 'Нужен коммит';
  return 'Настроен';
}
export function RepositoryCard({ profile, busy, open, incoming, outgoing, importPackage }: { profile: Profile; busy: boolean; open: () => void; incoming: () => void; outgoing: () => void; importPackage: () => void }): React.JSX.Element {
  const local = profile.sources.internal; const remote = profile.sources.global; const status = repositoryStatus(profile);
  return <Surface style={{ borderTop: '1px solid var(--line)', background: 'transparent', padding: '24px 0', display: 'flex', flexDirection: 'column', minWidth: 0 }}><Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><div><Row><h2 style={{ margin: 0, overflowWrap: 'anywhere' }}>{profile.name}</h2></Row><small style={{ display: 'block', marginTop: 4 }}>{profile.role === 'internal' ? 'Внутренний контур' : 'Внешний контур'}</small></div><Badge style={{ color: profile.pending || profile.commitRequired || status === 'Нужна настройка' ? 'var(--warning)' : 'var(--muted)' }}>{status}</Badge></Row>
    <Route><div><small>{profile.role === 'internal' ? 'Внешний Git' : 'Входящий пакет'}</small><code>{profile.role === 'internal' ? remote?.branch ?? 'Не настроен' : '.md · выбранные файлы'}</code><small>{profile.role === 'internal' ? remote?.location ?? 'Укажите источник' : 'Выбор файлов перед применением'}</small></div><span style={{ alignSelf: 'center', color: 'var(--accent)' }}><Icon name="arrow" /></span><div><small>Локальный Git</small><code>{local?.branch ?? 'Ветка не выбрана'}</code><small>{local?.location ?? 'Укажите локальный репозиторий'}</small></div></Route>
    {profile.syncedAt && <small>Последний перенос: {syncDate(profile.syncedAt)}</small>}<Muted style={{ fontSize: 13 }}>{profile.pending ? 'Подтвердите применение перед следующим переносом.' : profile.commitRequired ? 'Сохраните применённые изменения коммитом своими Git-инструментами.' : status === 'Нужна настройка' ? 'Укажите недостающие источники в настройках репозитория.' : profile.role === 'external' ? 'Выберите пакет, затем проверьте файлы перед применением.' : 'Сравните изменения из Git или подготовьте исходящий пакет. Состояние Git проверяется при открытии.'}</Muted>
    <Row style={{ marginTop: 'auto', paddingTop: 8, alignItems: 'stretch' }}>{profile.pending || status === 'Нужна настройка' ? <Button $primary disabled={busy} onClick={open}>{profile.pending ? 'Подтвердить пакет' : 'Настроить'}</Button> : profile.role === 'internal' ? <><Button $primary disabled={busy || !remote} onClick={incoming}><Icon name="import" />Получить изменения из Git</Button><Button disabled={busy} onClick={outgoing}>Подготовить пакет</Button></> : <Button $primary disabled={busy} onClick={importPackage}><Icon name="import" />Выбрать пакет</Button>}<Button disabled={busy} onClick={open}>Открыть <Icon name="arrow" /></Button></Row>
  </Surface>;
}
