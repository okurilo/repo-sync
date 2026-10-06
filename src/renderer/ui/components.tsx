import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import styled, { createGlobalStyle, css } from 'styled-components';
import { tokens } from '../theme/tokens';
export const GlobalStyle = createGlobalStyle({
  '*': { boxSizing: 'border-box' }, body: { margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: tokens.typography.body, background: 'var(--bg)', color: 'var(--text)' },
  'button, input, textarea, select': { font: 'inherit' }, button: { cursor: 'pointer' }, 'button:disabled': { cursor: 'not-allowed', opacity: 0.45 },
  'input, textarea, select': { width: '100%', minWidth: 0, color: 'var(--text)', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' },
  'input[type=checkbox]': { width: 'auto' }, label: { display: 'grid', gap: 8 }, fieldset: { border: 0, minWidth: 0, margin: 0, padding: 0 },
  h1: { fontSize: 30, letterSpacing: '-0.8px', margin: '0 0 10px' }, h2: { fontSize: 20, margin: '0 0 16px' }, h3: { margin: '0 0 12px' }, p: { lineHeight: 1.6 }, small: { color: 'var(--muted)' },
  'pre, code': { fontFamily: tokens.typography.mono, fontSize: 12, overflowWrap: 'anywhere' }, 'a, summary': { cursor: 'pointer', color: 'var(--accent)' },
  table: { width: '100%', borderCollapse: 'collapse' }, th: { textAlign: 'left', padding: 8, color: 'var(--muted)' },
});
const enter = css`animation: reposync-reveal ${tokens.motion.duration} ${tokens.motion.easing};`;
export const Button = styled('button')<{ $primary?: boolean; $danger?: boolean }>(({ $primary, $danger }) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', borderRadius: tokens.radius.control, border: '1px solid transparent', background: $primary ? 'var(--accent)' : 'var(--raised)', color: $primary ? 'var(--bg)' : $danger ? 'var(--danger)' : 'var(--text)', fontWeight: 600 }));
export const IconButton = styled(Button)({ padding: 9, background: 'transparent' });
export const Row = styled('div')({ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' });
export const Surface = styled('section')({ background: 'var(--surface)', borderRadius: tokens.radius.surface, padding: 24 });
export const Badge = styled('span')({ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '5px 9px', borderRadius: 6, background: 'var(--raised)', color: 'var(--muted)', fontSize: 11, fontWeight: 650, letterSpacing: '0.6px' });
export const Status = styled('div')<{ $error?: boolean }>(({ $error }) => ({ margin: '16px 0', padding: '12px 16px', background: $error ? 'var(--removed)' : 'var(--tint)', color: $error ? 'var(--danger)' : 'var(--text)', borderRadius: 8, lineHeight: 1.5, overflowWrap: 'anywhere' }));
export const Muted = styled('p')({ color: 'var(--muted)' });
export const Overlay = styled('div')({ position: 'fixed', inset: 0, background: '#00000070', zIndex: 20, display: 'grid', placeItems: 'center', padding: 24 });
function DialogFrame({ children, onClose, locked, ...props }: HTMLAttributes<HTMLElement> & { onClose?: () => void; locked?: boolean }): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLElement>('input:not(:disabled)') ?? ref.current?.querySelector<HTMLElement>('button:not(:disabled)'); first?.focus();
    return () => previous?.focus();
  }, []);
  return <section {...props} ref={ref} onKeyDown={event => {
    if (event.key === 'Escape' && !locked && onClose) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const elements = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])].filter(element => element.offsetParent !== null);
    const first = elements[0]; const last = elements.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>{children}</section>;
}
export const Dialog = styled(DialogFrame)({ display: 'flex', flexDirection: 'column', maxHeight: '90vh', width: 600, maxWidth: '100%', borderRadius: 16, background: 'var(--surface)', boxShadow: tokens.shadows.dialog }, enter);
export const Sheet = styled(Dialog)({ width: 560, marginLeft: 'auto', height: 'calc(100dvh - 48px)', maxHeight: 'calc(100dvh - 48px)' });
export const DialogHeader = styled(Row)({ flexShrink: 0, padding: '24px 28px', justifyContent: 'space-between', '& h2': { margin: 0 } });
export const DialogBody = styled('div')({ padding: '0 28px 24px', overflowY: 'auto', display: 'grid', gap: 18, minHeight: 0 });
export const DialogFooter = styled(Row)({ flexShrink: 0, padding: '20px 28px', background: 'var(--raised)', borderRadius: '0 0 16px 16px' });
export function SegmentedControl<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }): React.JSX.Element {
  return <Row role="group" style={{ padding: 4, background: 'var(--raised)', borderRadius: 10, gap: 4 }}>{options.map(option => <Button type="button" key={option.value} aria-label={option.label} aria-pressed={value === option.value} style={{ flex: 1, background: value === option.value ? 'var(--surface)' : 'transparent', color: value === option.value ? 'var(--accent)' : 'var(--muted)' }} onClick={() => onChange(option.value)}>{option.label}</Button>)}</Row>;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return <Surface style={{ textAlign: 'center', padding: '72px 24px' }}><h2>{title}</h2>{children}</Surface>;
}
export function StepIndicator({ steps, current }: { steps: string[]; current: number }): React.JSX.Element {
  return <Row aria-label="Этапы синхронизации" style={{ margin: '24px 0', gap: 24 }}>{steps.map((step, index) => <span key={step} aria-current={index === current ? 'step' : undefined} style={{ color: index === current ? 'var(--accent)' : 'var(--muted)', fontWeight: index === current ? 650 : 400 }}><span style={{ marginRight: 8 }}>{index < current ? '✓' : index + 1}</span>{step}</span>)}</Row>;
}
