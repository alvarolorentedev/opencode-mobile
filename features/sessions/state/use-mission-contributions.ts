import { useQueries } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import type { MissionOverview } from '@/features/sessions/model/mission-control';
import { sumMissionActivity } from '@/features/sessions/model/mission-stats';
import { useQueryForeground } from '@/shared/server-data/client';
import { sessionStatsRangeOptions } from '@/shared/server-data/session-stats';

const CONTRIBUTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function useMissionContributions(servers: MissionOverview['servers'], projectId: string | null | undefined, visible: boolean, refreshedAt: number) {
  const foreground = useQueryForeground();
  const [focusedAt, setFocusedAt] = useState<number>();
  useFocusEffect(useCallback(() => {
    if (!foreground) return;
    setFocusedAt(Date.now());
    return () => setFocusedAt(undefined);
  }, [foreground]));
  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);
  const range = useMemo(() => {
    const to = Math.max(focusedAt ?? 0, refreshedAt);
    return { from: to - CONTRIBUTION_DAYS * DAY_MS, to };
  }, [focusedAt, refreshedAt]);
  const queries = useQueries({ queries: visible && foreground && focusedAt !== undefined && projectId !== null
    ? servers.flatMap(({ stats }) => stats ? [sessionStatsRangeOptions(stats, projectId, range, timezone)] : []) : [] });
  const results = queries.flatMap((query) => query.data && !query.isError ? [query.data] : []);
  const unavailable = projectId === null || (servers.length > 0 && servers.every(({ phase }) => phase === 'offline' || phase === 'unsupported'));
  return {
    days: unavailable ? [] : sumMissionActivity(results),
    endDate: range.to,
    loading: focusedAt === undefined || queries.some((query) => query.isPending) || servers.some(({ phase, stats }) => phase === 'checking' && !stats),
    unavailable,
    partial: !unavailable && results.length < servers.length,
  };
}
