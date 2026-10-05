import styled, { createGlobalStyle } from 'styled-components';

export type Appearance = 'dark' | 'light';
export const reveal = 'reposync-reveal';
const progress = 'reposync-progress';
export const AppearanceStyle = createGlobalStyle<{ $appearance: Appearance }>(({ $appearance }) => ({
  '@keyframes reposync-reveal': { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
  '@keyframes reposync-progress': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(300%)' } },
  ':root': $appearance === 'dark' ? {
    colorScheme: 'dark', '--bg': '#0b0f17', '--surface': '#121925', '--raised': '#192232', '--input': '#0e1521', '--text': '#e7edf8', '--muted': '#9aa8bf', '--line': '#2b3649', '--accent': '#8ba9ff', '--tint': '#202e4a', '--success': '#81dbb7', '--success-bg': '#142e29', '--danger': '#ff96a8', '--danger-bg': '#351d29', '--warning': '#eabd72', '--warning-bg': '#352d1d', '--added': '#14352b', '--removed': '#39212b',
  } : {
    colorScheme: 'light', '--bg': '#eef2f8', '--surface': '#ffffff', '--raised': '#f5f7fc', '--input': '#ffffff', '--text': '#182238', '--muted': '#5f6e85', '--line': '#dce3ef', '--accent': '#3654bd', '--tint': '#eaf0ff', '--success': '#176b4e', '--success-bg': '#eaf7f0', '--danger': '#aa2844', '--danger-bg': '#fff0f3', '--warning': '#8a591b', '--warning-bg': '#fff4de', '--added': '#e5f5eb', '--removed': '#ffe9ed',
  },
  body: { background: 'radial-gradient(ellipse at 80% 0%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 55%), var(--bg)', color: 'var(--text)' },
  '::selection': { background: 'var(--tint)', color: 'var(--text)' },
  'button, input, select, textarea, summary': { transition: 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease', accentColor: 'var(--accent)' },
  'button:not(:disabled):hover': { borderColor: 'var(--accent)', filter: 'brightness(1.08)' },
  'button:not(:disabled):active': { transform: 'translateY(1px)' },
  'button:disabled': { cursor: 'not-allowed', opacity: 0.48 },
  ':focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 3 },
  'input:hover, textarea:hover, select:hover': { borderColor: 'var(--muted)' },
  'input:focus, textarea:focus, select:focus': { outline: 'none', borderColor: 'var(--accent)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent)' },
  'pre, code': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  mark: { color: '#172132' },
  '::-webkit-scrollbar': { width: 8, height: 8 }, '::-webkit-scrollbar-thumb': { background: 'var(--line)', borderRadius: 8, border: '2px solid var(--surface)' },
  '@media (prefers-reduced-motion: reduce)': { '*, *::before, *::after': { animation: 'none !important', transition: 'none !important' } },
}));
export const ScanWorkspace = styled('div')({ display: 'grid', gridTemplateColumns: '230px minmax(0, 1fr)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', '& > nav': { padding: 10, background: 'var(--input)', maxHeight: 390, overflow: 'auto', borderRight: '1px solid var(--line)' }, '& > div': { padding: 12, minWidth: 0 }, '@media(max-width: 800px)': { gridTemplateColumns: 'minmax(0, 1fr)', '& > nav': { maxHeight: 150, borderRight: 0, borderBottom: '1px solid var(--line)' } } });
export const ScanFile = styled('button')<{ $selected: boolean }>(({ $selected }) => ({ width: '100%', border: '1px solid transparent', borderRadius: 8, padding: '10px 8px', marginBottom: 4, textAlign: 'left', background: $selected ? 'var(--tint)' : 'transparent', color: $selected ? 'var(--accent)' : 'var(--text)', '& strong': { display: 'block', fontSize: 12, overflowWrap: 'anywhere' }, '& small': { display: 'block', fontSize: 10, marginTop: 4, color: 'var(--muted)', overflowWrap: 'anywhere' } }));
export const ExportActions = styled('div')({ position: 'sticky', bottom: 12, zIndex: 2, marginTop: 18, padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 8px 30px #00000020', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' });
export const BusyNotice = styled('div')({ position: 'relative', padding: '12px 16px', marginBottom: 16, borderRadius: 10, overflow: 'hidden', color: 'var(--accent)', background: 'var(--tint)', '&::after': { content: '""', position: 'absolute', bottom: 0, left: 0, width: '35%', height: 2, background: 'var(--accent)', animation: `${progress} 1.5s ease-in-out infinite` } });
const paths = { sync: 'M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4', profiles: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5', import: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', settings: 'M4 7h16M4 17h16M8 4v6m8 4v6', globe: 'M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18', internal: 'M5 21V3h14v18M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1', sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1', moon: 'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12', file: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6' };
export function Icon({ name }: { name: keyof typeof paths }): React.JSX.Element { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: 'middle', flexShrink: 0 }}><path d={paths[name]} />{name === 'globe' && <circle cx="12" cy="12" r="9" />}{name === 'sun' && <circle cx="12" cy="12" r="4" />}</svg>; }
