import type { ReactNode } from 'react';
import styled from 'styled-components';
import { Icon, type Appearance } from '../Appearance';
import { Button, IconButton, Row } from './components';
const Top = styled('header')({ height: 70, padding: '0 32px', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 });
const Main = styled('main')({ padding: '32px 36px', maxWidth: 1500, margin: '0 auto' });
export function AppShell({ children, appearance, toggleTheme, repositories, settings, disabled }: { children: ReactNode; appearance: Appearance; toggleTheme: () => void; repositories: () => void; settings: () => void; disabled: boolean }): React.JSX.Element {
  return <><Top><Row><Icon name="sync" /><strong style={{ fontSize: 20, letterSpacing: '-0.6px' }}>RepoSync</strong><Button disabled={disabled} style={{ marginLeft: 20, background: 'transparent' }} onClick={repositories}>Репозитории</Button></Row><Row><IconButton aria-label="Сменить тему" onClick={toggleTheme}><Icon name={appearance === 'dark' ? 'sun' : 'moon'} /></IconButton><IconButton aria-label="Настройки приложения" disabled={disabled} onClick={settings}><Icon name="settings" /></IconButton></Row></Top><Main>{children}</Main></>;
}
