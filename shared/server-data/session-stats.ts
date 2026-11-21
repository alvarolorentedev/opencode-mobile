import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { SessionStats, SessionStatsRange } from '@/shared/protocol/services/session-stats';
import { connectionQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

// Mission aggregates are historical. Reuse them between tab visits and show
// the previous window while a new one loads instead of a skeleton.
const STATS_STALE_MS = 5 * 60_000;
const STATS_GC_MS = 30 * 60_000;

export type SessionStatsSource = {
  identity: QueryIdentity;
  read: (range: SessionStatsRange, project: string | undefined, signal: AbortSignal, timezone?: string) => Promise<SessionStats>;
};

export type SessionStatsSeries = { total: SessionStats; buckets: SessionStats[] };

export function sessionStatsRangeOptions(source: SessionStatsSource, project: string | undefined, range: SessionStatsRange, timezone: string | undefined, revision = 0) {
  return queryOptions({
    queryKey: [...connectionQueryKey(source.identity, 'v2'), 'server', 'session-stats', project, range.from, range.to, 'total', timezone ?? '', revision],
    gcTime: STATS_GC_MS,
    staleTime: STATS_STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }): Promise<SessionStats> => source.read(range, project, signal, timezone),
  });
}

export function sessionStatsOptions(source: SessionStatsSource, project: string | undefined, buckets: SessionStatsRange[], revision = 0) {
  const range = { from: buckets[0].from, to: buckets[buckets.length - 1].to };
  return queryOptions({
    queryKey: [...connectionQueryKey(source.identity, 'v2'), 'server', 'session-stats', project, range.from, range.to, buckets.length, revision],
    gcTime: STATS_GC_MS,
    staleTime: STATS_STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<SessionStatsSeries> => {
      const total = await source.read(range, project, signal);
      const points: SessionStats[] = [];
      // Keep the server at one stats read at a time, even on long ranges.
      for (const bucket of buckets) {
        if (signal.aborted) throw new Error('Session stats request canceled.');
        points.push(await source.read(bucket, project, signal));
      }
      return { total, buckets: points };
    },
  });
}
