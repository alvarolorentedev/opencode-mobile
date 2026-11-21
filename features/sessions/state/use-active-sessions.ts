import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useQueryIdentity } from '@/shared/server-data/client';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import { getActiveSessions } from '@/features/sessions/model/active-sessions';
import { sessionCatalogOptions, type SessionCatalogData } from '@/features/sessions/services/queries';

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
  catalogClient,
  connected,
  currentSessionId,
  hideSubagentChats,
  visible,
}: {
  catalogClient: ScopedOpencodeClient;
  connected: boolean;
  currentSessionId?: string;
  hideSubagentChats: boolean;
  visible: boolean;
}) {
  const identity = useQueryIdentity();
  const queryClient = useQueryClient();
  const options = useMemo(() => sessionCatalogOptions(identity, catalogClient), [identity, catalogClient]);
  const query = useQuery({ ...options, enabled: connected });
  const sessions = query.data?.sessions ?? EMPTY_SESSIONS;
  const statuses = query.data?.statuses ?? EMPTY_STATUSES;

  const refreshActiveSessions = useCallback(async () => {
    if (!connected) return;
    await queryClient.fetchQuery({ ...options, staleTime: 0 }).catch(() => undefined);
  }, [connected, options, queryClient]);

  const removeSession = useCallback((sessionId: string) => {
    queryClient.setQueryData<SessionCatalogData>(options.queryKey, (current) => {
      if (!current?.sessions.some((session) => session.id === sessionId)) return current;
      const nextStatuses = { ...current.statuses };
      delete nextStatuses[sessionId];
      return { ...current, sessions: current.sessions.filter((session) => session.id !== sessionId), statuses: nextStatuses };
    });
  }, [options.queryKey, queryClient]);

  const activeSessions = useMemo(() => getActiveSessions({
    sessions,
    statuses,
    currentSessionId,
    hideSubagentChats,
    maxTotal: MAX_ACTIVE_SESSIONS,
  }), [currentSessionId, hideSubagentChats, sessions, statuses]);

  const hasRunning = activeSessions.some((session) => session.status.type !== 'idle');
  useEffect(() => {
    // Only spend data refreshing the cross-project snapshot while the Chat
    // Library is actually open and a remote session is running; opening the
    // library also refreshes once.
    if (!connected || !visible || !hasRunning) {
      return;
    }
    const interval = setInterval(() => {
      void refreshActiveSessions();
    }, ACTIVE_SESSIONS_POLL_MS);
    return () => clearInterval(interval);
  }, [connected, hasRunning, refreshActiveSessions, visible]);

  return {
    activeSessions,
    catalogStatuses: statuses,
    catalogSessions: sessions,
    catalogCheckedAt: query.dataUpdatedAt || undefined,
    catalogError: query.isError ? true : undefined,
    refreshActiveSessions,
    removeSession,
  };
}
