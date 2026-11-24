import type { BranchContext, IncomingSelection, Profile } from '../../shared/types';

const key = (profile: Profile): string => `reposync-incoming:${profile.id}`;
function sourceKey(profile: Profile): string {
  const source = profile.sources.global;
  return JSON.stringify([source?.kind, source?.location, source?.branch, source?.base?.branch]);
}

export function defaultIncomingSelection(profile: Profile, context: BranchContext): IncomingSelection {
  return { mode: 'branch', branch: profile.sources.global?.branch, baseBranch: context.defaultBranch };
}

export function readIncomingSelection(profile: Profile, context: BranchContext): IncomingSelection {
  const defaults = defaultIncomingSelection(profile, context);
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(profile)) ?? 'null');
    if (!value || typeof value !== 'object' || !('source' in value) || value.source !== sourceKey(profile) || !('mode' in value)) return defaults;
    const mode = value.mode;
    if (mode !== 'branch' && mode !== 'branches' && mode !== 'commit' && mode !== 'range' && mode !== 'repositories' && mode !== 'zero') return defaults;
    return {
      mode,
      branch: 'branch' in value && typeof value.branch === 'string' && context.branches.includes(value.branch) ? value.branch : defaults.branch,
      baseBranch: 'baseBranch' in value && typeof value.baseBranch === 'string' && context.branches.includes(value.baseBranch) ? value.baseBranch : defaults.baseBranch,
    };
  } catch { return defaults; }
}

export function rememberIncomingSelection(profile: Profile, selection: IncomingSelection): void {
  try {
    localStorage.setItem(key(profile), JSON.stringify({ source: sourceKey(profile), mode: selection.mode, branch: selection.branch, baseBranch: selection.baseBranch }));
  } catch { /* Optional UI preference: an unavailable store must not block Git operations. */ }
}

export function forgetIncomingSelection(profile: Profile): void {
  try { localStorage.removeItem(key(profile)); } catch { /* Optional UI preference. */ }
}
