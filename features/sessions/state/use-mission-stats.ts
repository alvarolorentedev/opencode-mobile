import { useQueries } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useQueryForeground } from '@/shared/server-data/client';
import { sessionStatsOptions } from '@/shared/server-data/session-stats';
import type { MissionOverview } from '@/features/sessions/model/mission-control';
import { missionStatsBuckets, sumMissionStats, type MissionStatsHours } from '@/features/sessions/model/mission-stats';

export function useMissionStats(servers: MissionOverview['servers'], projectId: string | null | undefined, hours: MissionStatsHours, visible: boolean, refreshedAt: number) {
  const foreground = useQueryForeground();
  const [focusedAt, setFocusedAt] = useState<number>();
  useFocusEffect(useCallback(() => {
    if (!foreground) return;
    setFocusedAt(Date.now());
    return () => setFocusedAt(undefined);
  }, [foreground]));
  const buckets = useMemo(() => missionStatsBuckets(hours, Math.max(focusedAt ?? 0, refreshedAt)), [focusedAt, hours, refreshedAt]);
  const queries = useQueries({ queries: visible && foreground && focusedAt !== undefined && projectId !== null
    ? servers.flatMap(({ stats }) => stats ? [sessionStatsOptions(stats, projectId, buckets)] : []) : [] });
  const results = queries.flatMap((query) => query.data && !query.isError ? [query.data] : []);
  const unavailable = servers.length > 0 && servers.every(({ phase }) => phase === 'offline' || phase === 'unsupported');
  return {
    buckets,
    series: !unavailable && results.length ? sumMissionStats(results, buckets.length) : undefined,
    checked: results.length,
    total: servers.length,
    loading: queries.some((query) => query.isPending) || servers.some(({ phase, stats }) => phase === 'checking' && !stats),
  };
}
