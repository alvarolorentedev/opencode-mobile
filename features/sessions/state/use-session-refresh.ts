import { useCallback } from 'react';

import { listPendingInteractions } from '@/shared/protocol/opencode/client/interactions';

import type { SessionStatus } from '@/shared/protocol/opencode/types';

import { areSessionListsEqual, areSessionStatusMapsEqual, groupPendingRequestsBySession, mergeSessionStatuses } from '@/features/sessions/model/session-utils';

import { persistSessionCache } from '@/features/sessions/services/session-cache';

import { getActiveSessionStatuses as svcGetActiveSessionStatuses, listSessions as svcListSessions } from '@/shared/protocol/services/session-service';

import type { SessionRefreshInput } from '@/features/sessions/model/refresh-input';

// A list read that started before a session was created can resolve after it.
// Keep just-created sessions visible for a short grace period.
const LOCAL_SESSION_GRACE_MS = 10_000;
export function useSessionRefresh({ activeProjectPath, client, isCurrentClient, setSessions, sessionsRef, setSessionStatuses, locallyCreatedSessionsRef, setPendingPermissionsBySession, setPendingQuestionsBySession, suppressedPendingRequestIdsRef, connectionScope }: SessionRefreshInput) {

  const refreshSessions = useCallback(
    async () => {
      if (!activeProjectPath) {
        setSessions([]);
        setSessionStatuses({});
        return [];
      }

      const result = await svcListSessions(client);
      if (!isCurrentClient(client)) {
        return result.sessions;
      }
      const now = Date.now();
      const resultIds = new Set(result.sessions.map((session) => session.id));
      const localIds = new Set<string>();
      for (const [id, createdAt] of locallyCreatedSessionsRef.current) {
        if (resultIds.has(id) || now - createdAt > LOCAL_SESSION_GRACE_MS) {
          locallyCreatedSessionsRef.current.delete(id);
        } else {
          localIds.add(id);
        }
      }
      const retained = localIds.size
        ? sessionsRef.current.filter((session) => localIds.has(session.id) && !resultIds.has(session.id))
        : [];
      const nextSessions = retained.length ? [...retained, ...result.sessions] : result.sessions;
      setSessions((current) => (areSessionListsEqual(current, nextSessions) ? current : nextSessions));
      setSessionStatuses((current) => {
        const next = mergeSessionStatuses(current, result.statuses);
        for (const session of retained) {
          if (!next[session.id]) next[session.id] = current[session.id] ?? { type: 'idle' };
        }
        return areSessionStatusMapsEqual(current, next) ? current : next;
      });
      void persistSessionCache(connectionScope, activeProjectPath, nextSessions, result.statuses);
      return nextSessions;
    },
    [activeProjectPath, client, connectionScope, isCurrentClient, locallyCreatedSessionsRef, sessionsRef, setSessionStatuses, setSessions],
  );

  const refreshSessionStatuses = useCallback(async () => {
    const active = await svcGetActiveSessionStatuses(client).catch(() => undefined);
    if (!active) {
      await refreshSessions();
      return;
    }
    if (!isCurrentClient(client)) return;
    setSessionStatuses((current) => {
      const fetched: Record<string, SessionStatus> = {};
      for (const id of Object.keys(current)) {
        fetched[id] = { type: id in active ? 'busy' : 'idle' };
      }
      for (const id of Object.keys(active)) {
        fetched[id] = { type: 'busy' };
      }
      const next = mergeSessionStatuses(current, fetched);
      return areSessionStatusMapsEqual(current, next) ? current : next;
    });
  }, [client, isCurrentClient, refreshSessions, setSessionStatuses]);

  const refreshPendingInteractions = useCallback(async () => {
    const { permissions, questions } = await listPendingInteractions(client);
    if (!isCurrentClient(client)) {
      return;
    }
    // A reply removes its card before the server acknowledges it. Ignore a
    // refresh that races that reply so the card cannot flicker back.
    const suppressed = suppressedPendingRequestIdsRef?.current;
    const visible = <T extends { id: string }>(requests: T[]) => (
      suppressed ? requests.filter((request) => !suppressed.has(request.id)) : requests
    );
    if (permissions) setPendingPermissionsBySession(groupPendingRequestsBySession(visible(permissions)));
    if (questions) setPendingQuestionsBySession(groupPendingRequestsBySession(visible(questions)));
  }, [client, isCurrentClient, setPendingPermissionsBySession, setPendingQuestionsBySession, suppressedPendingRequestIdsRef]);
  return { refreshSessions, refreshSessionStatuses, refreshPendingInteractions };
}
