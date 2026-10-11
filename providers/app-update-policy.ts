import type { UpdateSnapshot } from '@/lib/app-updates';

export const UPDATE_DISMISS_INTERVAL = 7 * 24 * 60 * 60 * 1000;
export type UpdateCheckPeriod = 'available' | 'daily' | 'weekly';
export const DEFAULT_UPDATE_CHECK_PERIOD: UpdateCheckPeriod = 'available';
export const UPDATE_CHECK_PERIODS: UpdateCheckPeriod[] = ['available', 'daily', 'weekly'];
export const UPDATE_CHECK_INTERVALS: Record<UpdateCheckPeriod, number> = {
  available: 0,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};
export type UpdatePreferences = {
  lastCheckAt: number;
  enabled: boolean;
  checkPeriod: UpdateCheckPeriod;
  dismissal?: { version: string; phase: 'available' | 'downloaded'; until: number };
};

export function parseUpdatePreferences(raw: string): UpdatePreferences {
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !Number.isFinite(value.lastCheckAt) || value.lastCheckAt < 0) throw new Error('Invalid update preferences');
  const enabled = value.enabled === undefined ? true : value.enabled;
  if (typeof enabled !== 'boolean') throw new Error('Invalid update enabled');
  const checkPeriod = value.checkPeriod === undefined ? DEFAULT_UPDATE_CHECK_PERIOD : value.checkPeriod;
  if (!UPDATE_CHECK_PERIODS.includes(checkPeriod)) throw new Error('Invalid update check period');
  const { dismissal } = value;
  if (dismissal && (typeof dismissal.version !== 'string' || !dismissal.version ||
    !['available', 'downloaded'].includes(dismissal.phase) || !Number.isFinite(dismissal.until) || dismissal.until < 0)) throw new Error('Invalid update dismissal');
  return { lastCheckAt: value.lastCheckAt, enabled, checkPeriod, ...(dismissal ? { dismissal } : {}) };
}

export function updateCheckDue(lastCheckAt: number, now: number, interval: number) {
  return !lastCheckAt || now < lastCheckAt || now - lastCheckAt >= interval;
}

export function updateNotice(snapshot: UpdateSnapshot, preferences: UpdatePreferences, now: number) {
  if (snapshot.phase !== 'available' && snapshot.phase !== 'downloaded') return undefined;
  const dismissal = preferences.dismissal;
  if (dismissal && dismissal.version === (snapshot.version ?? 'downloaded') && dismissal.phase === snapshot.phase && now < dismissal.until) return undefined;
  return snapshot;
}
