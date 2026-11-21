import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MissionOverview } from '@/features/sessions/model/mission-control';
import { missionContributionRange, sumMissionActivity } from '@/features/sessions/model/mission-stats';
import { hydrateMissionContributionsCache, persistMissionContributionsCache } from '@/features/sessions/services/mission-stats-cache';
import type { SessionStats } from '@/shared/protocol/services/session-stats';
import { useQueryForeground } from '@/shared/server-data/client';
import { sessionStatsRangeOptions } from '@/shared/server-data/session-stats';

export function useMissionContributions(servers: MissionOverview['servers'], projectId: string | null | undefined, visible: boolean, refreshedAt: number) {
  const foreground = useQueryForeground();
  const cache = useQueryClient();
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => { setNow(Date.now()); }, []));
  const range = useMemo(() => missionContributionRange(Math.max(now, refreshedAt)), [now, refreshedAt]);
  const sources = useMemo(() => servers.flatMap(({ stats }) => stats ? [stats] : []), [servers]);
  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);
  const queries = useQueries({ queries: visible && foreground && projectId !== null
    ? sources.map((stats) => sessionStatsRangeOptions(stats, projectId, range, timezone, refreshedAt)) : [] });
  const results = queries.flatMap((query) => query.data && !query.isError ? [query.data] : []);
  const unavailable = projectId === null || (servers.length > 0 && servers.every(({ phase }) => phase === 'offline' || phase === 'unsupported'));

  const hydrated = useRef(new Set<string>());
  const written = useRef(new Map<string, number>());
  const persistable = projectId === undefined;

  useEffect(() => {
    if (!persistable) return;
    for (const stats of sources) {
      const scope = stats.identity.connectionScope;
      if (hydrated.current.has(scope)) continue;
      hydrated.current.add(scope);
      const key = sessionStatsRangeOptions(stats, undefined, range, timezone).queryKey;
      if (cache.getQueryData(key) !== undefined) continue;
      void hydrateMissionContributionsCache(scope, (days, cachedAt) => {
        if (cache.getQueryData(key) !== undefined) return;
        cache.setQueryData<SessionStats>(key, {
          conversations: 0, tokens: 0, cost: 0,
          ...(days.length ? { activity: days } : {}),
        }, { updatedAt: cachedAt });
        written.current.set(scope, cachedAt);
      }, () => true);
    }
  }, [cache, persistable, range, sources, timezone]);

  const updatedAt = queries.map((query) => query.dataUpdatedAt).join(',');
  useEffect(() => {
    if (!persistable) return;
    sources.forEach((stats, index) => {
      const query = queries[index];
      if (!query?.data || query.isError || query.isPlaceholderData) return;
      const scope = stats.identity.connectionScope;
      if ((written.current.get(scope) ?? 0) === query.dataUpdatedAt) return;
      written.current.set(scope, query.dataUpdatedAt);
      void persistMissionContributionsCache(scope, query.data.activity ?? []);
    });
  }, [persistable, queries, sources, updatedAt]);

  return {
    days: unavailable ? [] : sumMissionActivity(results),
    endDate: range.endDate,
    loading: queries.some((query) => query.isPending) || servers.some(({ phase, stats }) => phase === 'checking' && !stats),
    unavailable,
    partial: !unavailable && results.length < servers.length,
  };
}
