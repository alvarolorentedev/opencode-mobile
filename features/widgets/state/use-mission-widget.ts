import { useEffect, useRef } from 'react';

import type { MissionOverview } from '@/features/sessions/runtime';
import type { MissionWidgetSnapshot } from '@/shared/contracts/mission-control';
import { useQueryForeground } from '@/shared/server-data/client';
import { homeWidgetSupported, updateMissionWidget } from '@/features/widgets/services/widget-platform';
import { loadMissionWidgetSnapshot, saveMissionWidgetSnapshot } from '@/features/widgets/services/widget-snapshot-storage';

export function useMissionWidget(overview: MissionOverview, sourceKey: string, ready: boolean, language?: string) {
  const foreground = useQueryForeground();
  const last = useRef<{ key: string; snapshot?: MissionWidgetSnapshot; painted: boolean } | undefined>(undefined);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    if (!homeWidgetSupported || !ready || !foreground) return;
    let cancelled = false;
    writes.current = writes.current.catch(() => undefined).then(async () => {
      if (cancelled) return;
      const servers = overview.servers.filter((server) => server.authorized !== false && server.phase !== 'unsupported');
      const checkedServers = servers.filter(({ phase }) => phase === 'ready').length;
      const previous = last.current ? (last.current.key === sourceKey ? last.current.snapshot : undefined)
        : servers.length && servers.length === overview.servers.length ? await loadMissionWidgetSnapshot() : undefined;
      if (cancelled) return;
      const snapshot = overview.checkedAt && servers.length ? {
        checkedAt: overview.checkedAt, checkedServers, totalServers: servers.length, counts: overview.counts, stale: false, language,
      } : previous && servers.length ? { ...previous, stale: true, language } : undefined;
      if (last.current?.key === sourceKey && last.current.painted && JSON.stringify(last.current.snapshot) === JSON.stringify(snapshot)) return;
      if (await saveMissionWidgetSnapshot(snapshot)) {
        last.current = { key: sourceKey, snapshot, painted: !cancelled };
        if (!cancelled) await updateMissionWidget(snapshot);
      }
    });
    return () => { cancelled = true; };
  }, [foreground, language, overview, ready, sourceKey]);
}
