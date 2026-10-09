import { tokens } from './theme/tokens';
import styled, { createGlobalStyle, css } from 'styled-components';

export type Appearance = 'dark' | 'light';
export const reveal = 'reposync-reveal';
const progress = 'reposync-progress';
export const AppearanceStyle = createGlobalStyle<{ $appearance: Appearance }>(({ $appearance }) => ({
  '@keyframes reposync-reveal': { from: { opacity: 1 }, to: { opacity: 1 } },
  '@keyframes reposync-progress': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(300%)' } },
  '@keyframes reposync-pulse': { '0%, 100%': { opacity: 0.45 }, '50%': { opacity: 0.85 } },
  '.reposync-skeleton': { borderRadius: 10, background: 'var(--raised)', animation: 'reposync-pulse 1.4s ease-in-out infinite' },
  ':root': { colorScheme: $appearance, ...Object.fromEntries(Object.entries(tokens.colors[$appearance]).map(([key, value]) => [`--${key}`, value])) },
  body: { background: 'var(--bg)', color: 'var(--text)' },
  '::selection': { background: 'var(--tint)', color: 'var(--text)' },
  'button, input, select, textarea, summary': { transition: 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease', accentColor: 'var(--accent)' },
  'button:not(:disabled):hover': { borderColor: 'var(--accent)', filter: 'brightness(1.08)' },
  'button:not(:disabled):active': { transform: 'translateY(1px)' },
  'button:disabled': { cursor: 'not-allowed', opacity: 0.48 },
  ':focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 3 },
  'input:hover, textarea:hover, select:hover': { borderColor: 'var(--muted)' },
  'input:focus, textarea:focus, select:focus': { outline: 'none', borderColor: 'var(--accent)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent)' },
  'pre, code': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  mark: { color: 'var(--text)' },
  '::-webkit-scrollbar': { width: 8, height: 8 }, '::-webkit-scrollbar-thumb': { background: 'var(--line)', borderRadius: 8, border: '2px solid var(--surface)' },
  '@media (prefers-reduced-motion: reduce)': { '*, *::before, *::after': { animation: 'none !important', transition: 'none !important' } },
}));
export const BusyNotice = styled('div')({ position: 'relative', padding: '12px 16px', marginBottom: 16, borderRadius: 10, overflow: 'hidden', color: 'var(--accent)', background: 'var(--tint)', '&::after': { content: '""', position: 'absolute', bottom: 0, left: 0, width: '35%', height: 2, background: 'var(--accent)' } }, css`&::after { animation: ${progress} 1.5s ease-in-out infinite; }`);
const paths = { plus: 'M12 5v14M5 12h14', back: 'M19 12H5m6-6-6 6 6 6', close: 'm6 6 12 12M6 18 18 6', folder: 'M3 7V5h6l2 2h10v13H3z', arrow: 'M5 12h14m-6-6 6 6-6 6', check: 'm5 12 4 4 10-10', sync: 'M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4', profiles: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5', import: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', settings: 'M4 7h16M4 17h16M8 4v6m8 4v6', globe: 'M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18', internal: 'M5 21V3h14v18M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1', sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1', moon: 'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12', file: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6' };
export function Icon({ name }: { name: keyof typeof paths }): React.JSX.Element { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: 'middle', flexShrink: 0 }}><path d={paths[name]} />{name === 'globe' && <circle cx="12" cy="12" r="9" />}{name === 'sun' && <circle cx="12" cy="12" r="4" />}</svg>; }
