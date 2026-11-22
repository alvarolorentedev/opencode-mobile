import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { SessionStatsActivityDay } from '@/shared/protocol/services/session-stats';
import { loadPersistedValue, type PersistenceStorage } from '@/shared/storage/persistence-hydration';
import { missionActivityCacheKey, missionContributionsCacheKey } from '@/shared/storage/keys';

// Only the all-projects default launch view is persisted, and only for the
// fields the charts paint. Project/range variants stay in the Query cache.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_BUCKETS = 8;
const MAX_CONTRIBUTION_DAYS = 31;
const MAX_CHARS = 16_000;

type MissionActivityMetric = { tokens: number; cost: number };
export type MissionActivitySnapshot = {
  total: MissionActivityMetric;
  buckets: MissionActivityMetric[];
};

type StatsCacheStorage = PersistenceStorage & Pick<typeof AsyncStorage, 'setItem' | 'multiRemove'>;
type CachedEnvelope = { cachedAt: number };

const MetricSchema = z.object({
  tokens: z.number().int().nonnegative(),
  cost: z.number().finite().nonnegative(),
});
const ActivitySchema = z.object({
  cachedAt: z.number().finite(),
  total: MetricSchema,
  buckets: z.array(MetricSchema).max(MAX_ACTIVITY_BUCKETS),
});
const DaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.number().int().nonnegative(),
});
const ContributionsSchema = z.object({
  cachedAt: z.number().finite(),
  days: z.array(DaySchema).max(MAX_CONTRIBUTION_DAYS),
});

function parseWith<T>(schema: z.ZodType<T>, raw: string, label: string): T & CachedEnvelope {
  const value = schema.parse(JSON.parse(raw)) as T & CachedEnvelope;
  if (Date.now() - value.cachedAt > CACHE_TTL_MS || value.cachedAt > Date.now()) throw new Error(`${label} cache expired.`);
  return value;
}

const activitySpec = {
  key: missionActivityCacheKey,
  parse: (raw: string) => parseWith(ActivitySchema, raw, 'Mission activity'),
};
const contributionsSpec = {
  key: missionContributionsCacheKey,
  parse: (raw: string) => parseWith(ContributionsSchema, raw, 'Mission contributions'),
};

export async function hydrateMissionActivityCache(
  connectionScope: string,
  apply: (snapshot: MissionActivitySnapshot, cachedAt: number) => void,
  isCurrent: () => boolean,
  storage: StatsCacheStorage = AsyncStorage,
) {
  if (!connectionScope) return;
  await loadPersistedValue(storage, missionActivityCacheKey(connectionScope), activitySpec.parse, (value) => {
    if (isCurrent()) apply({ total: value.total, buckets: value.buckets }, value.cachedAt);
  });
}

export async function persistMissionActivityCache(
  connectionScope: string,
  snapshot: MissionActivitySnapshot,
  storage: Pick<StatsCacheStorage, 'setItem'> = AsyncStorage,
) {
  if (!connectionScope || snapshot.buckets.length > MAX_ACTIVITY_BUCKETS) return;
  const raw = JSON.stringify({ cachedAt: Date.now(), total: snapshot.total, buckets: snapshot.buckets });
  if (raw.length > MAX_CHARS) return;
  await storage.setItem(missionActivityCacheKey(connectionScope), raw).catch(() => undefined);
}

export async function hydrateMissionContributionsCache(
  connectionScope: string,
  apply: (days: SessionStatsActivityDay[], cachedAt: number) => void,
  isCurrent: () => boolean,
  storage: StatsCacheStorage = AsyncStorage,
) {
  if (!connectionScope) return;
  await loadPersistedValue(storage, missionContributionsCacheKey(connectionScope), contributionsSpec.parse, (value) => {
    if (isCurrent()) apply(value.days, value.cachedAt);
  });
}

export async function persistMissionContributionsCache(
  connectionScope: string,
  days: SessionStatsActivityDay[],
  storage: Pick<StatsCacheStorage, 'setItem'> = AsyncStorage,
) {
  if (!connectionScope) return;
  const raw = JSON.stringify({ cachedAt: Date.now(), days: days.slice(-MAX_CONTRIBUTION_DAYS) });
  if (raw.length > MAX_CHARS) return;
  await storage.setItem(missionContributionsCacheKey(connectionScope), raw).catch(() => undefined);
}

export async function migrateMissionStatsCaches(
  previousScope: string,
  nextScope: string,
  storage: Pick<StatsCacheStorage, 'getItem' | 'setItem' | 'removeItem'> = AsyncStorage,
) {
  if (!previousScope || !nextScope || previousScope === nextScope) return;
  for (const spec of [activitySpec, contributionsSpec]) {
    const previousKey = spec.key(previousScope);
    const raw = await storage.getItem(previousKey).catch(() => null);
    if (!raw) continue;
    let value: CachedEnvelope;
    try {
      value = spec.parse(raw);
    } catch {
      await storage.removeItem(previousKey).catch(() => undefined);
      continue;
    }
    const nextKey = spec.key(nextScope);
    let newer = false;
    try {
      const existing = await storage.getItem(nextKey);
      newer = Boolean(existing && spec.parse(existing).cachedAt >= value.cachedAt);
    } catch {
      // A malformed or expired destination is replaced by the valid source.
    }
    if (!newer) await storage.setItem(nextKey, raw).catch(() => undefined);
    await storage.removeItem(previousKey).catch(() => undefined);
  }
}

export async function clearMissionStatsCaches(
  connectionScope: string,
  storage: Pick<StatsCacheStorage, 'multiRemove'> = AsyncStorage,
) {
  if (!connectionScope) return;
  await storage.multiRemove([missionActivityCacheKey(connectionScope), missionContributionsCacheKey(connectionScope)])
    .catch(() => undefined);
}
