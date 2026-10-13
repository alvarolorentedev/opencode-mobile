import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { Session, SessionStatus } from '@/lib/opencode/types';
import { getActiveSessions } from '@/providers/active-sessions';
import { areSessionListsEqual, areSessionStatusMapsEqual } from '@/providers/opencode-provider-utils';
import { listActiveSessions as svcListActiveSessions } from '@/providers/services/session-service';

// The snapshot also refreshes on connect and whenever the Chat Library opens,
// so a slow poll is enough to keep the cross-workspace running list fresh
// without spending data on every project's session list.
const ACTIVE_SESSIONS_POLL_MS = 20000;
const MAX_ACTIVE = 4;
const EMPTY_SESSIONS: Session[] = [];

type ActiveSessionsSnapshot = {
  scope?: string;
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
};

// Cross-workspace session snapshot for the Chat Library "Active" group. It reads
// through the unscoped catalog client so it sees every project on the active
// connection, seeds on connect, and polls only while the Chat Library is visible
// and a remote session is running. The snapshot is tagged with its connection
// scope, so a server switch immediately hides the previous server's sessions
// without a reset effect.
export function useActiveSessions({
  catalogClient,
  isCurrentCatalogClient,
  connectionScope,
  connected,
  currentSessionId,
  hideSubagentChats,
  visible,
}: {
  catalogClient: ScopedOpencodeClient;
  isCurrentCatalogClient: (candidate: object) => boolean;
  connectionScope: string;
  connected: boolean;
  currentSessionId?: string;
  hideSubagentChats: boolean;
  visible: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ActiveSessionsSnapshot>({ sessions: [], statuses: {} });

  const refreshActiveSessions = useCallback(async () => {
    if (!connected) {
      return;
    }
    try {
      const result = await svcListActiveSessions(catalogClient);
      if (!isCurrentCatalogClient(catalogClient)) {
        return;
      }
      setSnapshot((previous) => {
        const sessions = result.sessions as Session[];
        const statuses = result.statuses as Record<string, SessionStatus>;
        if (previous.scope === connectionScope
          && areSessionListsEqual(previous.sessions, sessions)
          && areSessionStatusMapsEqual(previous.statuses, statuses)) {
          return previous;
        }
        return { scope: connectionScope, sessions, statuses };
      });
    } catch {
      // Keep the previous snapshot on a transient failure.
    }
  }, [catalogClient, connected, connectionScope, isCurrentCatalogClient]);

  const current = snapshot.scope === connectionScope ? snapshot : undefined;
  const activeSessions = useMemo(() => getActiveSessions({
    sessions: current?.sessions ?? [],
    statuses: current?.statuses ?? {},
    currentSessionId,
    hideSubagentChats,
    maxTotal: MAX_ACTIVE,
  }), [current, currentSessionId, hideSubagentChats]);

  const hasRunning = activeSessions.some((session) => session.status.type !== 'idle');
  useEffect(() => {
    // Only spend data refreshing the cross-workspace snapshot while the Chat
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

  return { activeSessions, catalogSessions: current?.sessions ?? EMPTY_SESSIONS, refreshActiveSessions };
}
