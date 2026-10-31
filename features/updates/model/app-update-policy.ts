import { z } from 'zod';

import type { UpdateSnapshot } from '@/shared/platform/app-updates';

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
  dismissal?: { version: string; phase: 'available' | 'downloaded'; until: number; attempted?: boolean };
};

const UpdateDismissalSchema = z.object({
  version: z.string().min(1),
  phase: z.enum(['available', 'downloaded']),
  until: z.number().finite().nonnegative(),
  attempted: z.boolean().optional(),
});
const UpdatePreferencesSchema = z.object({
  lastCheckAt: z.number().finite().nonnegative(),
  enabled: z.boolean().default(true),
  checkPeriod: z.enum(UPDATE_CHECK_PERIODS).default(DEFAULT_UPDATE_CHECK_PERIOD),
  dismissal: UpdateDismissalSchema.nullish().transform((value) => value ? { ...value, phase: 'available' as const } : undefined),
});

export function parseUpdatePreferences(raw: string): UpdatePreferences {
  return UpdatePreferencesSchema.parse(JSON.parse(raw));
}

export function updateCheckDue(lastCheckAt: number, now: number, interval: number) {
  return !lastCheckAt || now < lastCheckAt || now - lastCheckAt >= interval;
}

export function updateNotice(snapshot: UpdateSnapshot, preferences: UpdatePreferences, now: number) {
  if (snapshot.phase !== 'available' && snapshot.phase !== 'inProgress') return undefined;
  const dismissal = preferences.dismissal;
  const recovering = snapshot.phase === 'inProgress';
  if (dismissal && !(recovering && dismissal.attempted) && dismissal.phase === 'available' && now < dismissal.until &&
    (dismissal.version === (snapshot.version ?? 'immediate') || (recovering && (!snapshot.version || snapshot.version === 'immediate')))) return undefined;
  return snapshot;
}
