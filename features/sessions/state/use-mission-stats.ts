import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MissionOverview } from '@/features/sessions/model/mission-control';
import { missionStatsAlignedAt, missionStatsBuckets, sumMissionStats, type MissionStatsHours } from '@/features/sessions/model/mission-stats';
import { hydrateMissionActivityCache, persistMissionActivityCache } from '@/features/sessions/services/mission-stats-cache';
import { useQueryForeground } from '@/shared/server-data/client';
import { sessionStatsOptions, type SessionStatsSeries } from '@/shared/server-data/session-stats';

const CACHED_DEFAULT_HOURS: MissionStatsHours = 24;

export function useMissionStats(servers: MissionOverview['servers'], projectId: string | null | undefined, hours: MissionStatsHours, visible: boolean, refreshedAt: number) {
  const foreground = useQueryForeground();
  const cache = useQueryClient();
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => { setNow(Date.now()); }, []));
  const alignedAt = missionStatsAlignedAt(Math.max(now, refreshedAt));
  const buckets = useMemo(() => missionStatsBuckets(hours, alignedAt), [alignedAt, hours]);
  const sources = useMemo(() => servers.flatMap(({ stats }) => stats ? [stats] : []), [servers]);
  const queries = useQueries({ queries: visible && foreground && projectId !== null
    ? sources.map((stats) => sessionStatsOptions(stats, projectId, buckets, refreshedAt)) : [] });
  const results = queries.flatMap((query) => query.data && !query.isError ? [query.data] : []);
  const unavailable = servers.length > 0 && servers.every(({ phase }) => phase === 'offline' || phase === 'unsupported');

  const hydrated = useRef(new Set<string>());
  const written = useRef(new Map<string, number>());
  const persistable = projectId === undefined && hours === CACHED_DEFAULT_HOURS;

  useEffect(() => {
    if (!persistable) return;
    for (const stats of sources) {
      const scope = stats.identity.connectionScope;
      if (hydrated.current.has(scope)) continue;
      hydrated.current.add(scope);
      const key = sessionStatsOptions(stats, undefined, buckets).queryKey;
      if (cache.getQueryData(key) !== undefined) continue;
      void hydrateMissionActivityCache(scope, (snapshot, cachedAt) => {
        if (cache.getQueryData(key) !== undefined) return;
        cache.setQueryData<SessionStatsSeries>(key, {
          total: { conversations: 0, ...snapshot.total },
          buckets: snapshot.buckets.map((metric) => ({ conversations: 0, ...metric })),
        }, { updatedAt: cachedAt });
        written.current.set(scope, cachedAt);
      }, () => true);
    }
  }, [buckets, cache, persistable, sources]);

  const updatedAt = queries.map((query) => query.dataUpdatedAt).join(',');
  useEffect(() => {
    if (!persistable) return;
    sources.forEach((stats, index) => {
      const query = queries[index];
      if (!query?.data || query.isError || query.isPlaceholderData) return;
      const scope = stats.identity.connectionScope;
      if ((written.current.get(scope) ?? 0) === query.dataUpdatedAt) return;
      written.current.set(scope, query.dataUpdatedAt);
      void persistMissionActivityCache(scope, {
        total: { tokens: query.data.total.tokens, cost: query.data.total.cost },
        buckets: query.data.buckets.map(({ tokens, cost }) => ({ tokens, cost })),
      });
    });
  }, [persistable, queries, sources, updatedAt]);

  return {
    buckets,
    series: !unavailable && results.length ? sumMissionStats(results, buckets.length) : undefined,
    checked: results.length,
    total: servers.length,
    loading: queries.some((query) => query.isPending) || servers.some(({ phase, stats }) => phase === 'checking' && !stats),
  };
}
