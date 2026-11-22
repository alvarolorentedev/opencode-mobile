import type { QueryIdentity } from '@/shared/server-data/keys';
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import { getActiveSessions } from '@/features/sessions/model/active-sessions';
import { sessionCatalogOptions } from '@/features/sessions/services/queries';
import { removeCatalogSession } from '@/features/sessions/services/session-catalog-access';

// The snapshot also refreshes on connect and whenever the Chat Library opens,
// so a slow poll is enough to keep the cross-project running list fresh
// without spending data on every project's session list.
const ACTIVE_SESSIONS_POLL_MS = 20000;
export const MAX_ACTIVE_SESSIONS = 4;
const EMPTY_SESSIONS: Session[] = [];
const EMPTY_STATUSES: Record<string, SessionStatus> = {};

// Cross-project session snapshot for the Chat Library "Active" group. The
// unscoped catalog is the single owner of the connection-wide status map;
// project lists read statuses from the same key.
export function useActiveSessions({
  identity,
  catalogClient,
  connected,
  currentSessionId,
  hideSubagentChats,
  visible,
}: {
  identity: QueryIdentity;
  catalogClient: ScopedOpencodeClient;
  connected: boolean;
  currentSessionId?: string;
  hideSubagentChats: boolean;
  visible: boolean;
}) {
  const queryClient = useQueryClient();
  const options = useMemo(() => sessionCatalogOptions(identity, catalogClient), [identity, catalogClient]);
  const selectActive = useCallback((sessions: Session[], statuses: Record<string, SessionStatus>) => getActiveSessions({
    sessions, statuses, currentSessionId, hideSubagentChats, maxTotal: MAX_ACTIVE_SESSIONS,
  }), [currentSessionId, hideSubagentChats]);
  const query = useQuery({ ...options, enabled: connected, refetchInterval: visible ? ({ state }) => {
    if (!state.data) return false;
    const running = selectActive(state.data.sessions, state.data.statuses).some(({ status }) => status.type !== 'idle');
    return running ? ACTIVE_SESSIONS_POLL_MS : false;
  } : false });
  const sessions = query.data?.sessions ?? EMPTY_SESSIONS;
  const statuses = query.data?.statuses ?? EMPTY_STATUSES;

  const refreshActiveSessions = useCallback(async () => {
    if (!connected) return;
    await queryClient.fetchQuery({ ...options, staleTime: 0 }).catch(() => undefined);
  }, [connected, options, queryClient]);

  const removeSession = useCallback((sessionId: string) => {
    removeCatalogSession(queryClient, options.queryKey, sessionId);
  }, [options.queryKey, queryClient]);

  const activeSessions = useMemo(() => selectActive(sessions, statuses), [selectActive, sessions, statuses]);

  return {
    activeSessions,
    catalogStatuses: statuses,
    catalogSessions: sessions,
    catalogCheckedAt: query.dataUpdatedAt || undefined,
    // Query pauses fetches while offline instead of rejecting them. Mission
    // Control treats a paused catalog like the old failed-read flag.
    catalogError: query.isError || query.isPaused ? true : undefined,
    refreshActiveSessions,
    removeSession,
  };
}
