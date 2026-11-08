import { useEffect, useMemo, useState } from 'react';
import type { ConnectionRecord, WorkspaceCatalog } from '@/shared/contracts/workspace';
import { selectMission } from '@/features/sessions/model/mission-control';

export function useMissionOverview(connections: ConnectionRecord[], catalogs: Record<string, WorkspaceCatalog>) {
  const [now, setNow] = useState(Date.now);
  const overview = useMemo(() => selectMission(connections, catalogs, now), [connections, catalogs, now]);
  useEffect(() => {
    if (!overview.expires) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, overview.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [overview.expires]);
  return overview;
}
