import type { UpdateSnapshot } from '@/lib/app-updates';

export const UPDATE_CHECK_INTERVAL = 12 * 60 * 60 * 1000;
export const UPDATE_DISMISS_INTERVAL = 7 * 24 * 60 * 60 * 1000;
export type UpdatePreferences = {
  lastCheckAt: number;
  dismissal?: { version: string; phase: 'available' | 'downloaded'; until: number };
};

export function parseUpdatePreferences(raw: string): UpdatePreferences {
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !Number.isFinite(value.lastCheckAt) || value.lastCheckAt < 0) throw new Error('Invalid update preferences');
  const { dismissal } = value;
  if (dismissal && (typeof dismissal.version !== 'string' || !dismissal.version ||
    !['available', 'downloaded'].includes(dismissal.phase) || !Number.isFinite(dismissal.until) || dismissal.until < 0)) throw new Error('Invalid update dismissal');
  return { lastCheckAt: value.lastCheckAt, ...(dismissal ? { dismissal } : {}) };
}

export function updateCheckDue(lastCheckAt: number, now: number) {
  return !lastCheckAt || now < lastCheckAt || now - lastCheckAt >= UPDATE_CHECK_INTERVAL;
}

export function updateNotice(snapshot: UpdateSnapshot, preferences: UpdatePreferences, now: number) {
  if (snapshot.phase !== 'available' && snapshot.phase !== 'downloaded') return undefined;
  const dismissal = preferences.dismissal;
  if (dismissal && dismissal.version === (snapshot.version ?? 'downloaded') && dismissal.phase === snapshot.phase && now < dismissal.until) return undefined;
  return snapshot;
}
