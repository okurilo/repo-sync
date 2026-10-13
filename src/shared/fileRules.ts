import { minimatch } from 'minimatch';
import type { Profile, Settings } from './types';
export function effectiveRules(settings: Settings, profile: Profile): string[] {
  return [...new Set([...settings.globalExclusions.filter(rule => !profile.filters?.disabled.includes(rule)), ...(profile.filters?.extra ?? profile.exclusions)])];
}
export function excludedRule(name: string, oldPath: string | undefined, rules: string[]): string | undefined {
  return rules.find(rule => minimatch(name, rule, { dot: true, nonegate: true }) || !!oldPath && minimatch(oldPath, rule, { dot: true, nonegate: true }));
}
