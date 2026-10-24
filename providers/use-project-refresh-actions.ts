import { useCallback } from 'react';

import { listPendingInteractions } from '@/lib/opencode/client';
import type { SessionStatus } from '@/lib/opencode/types';
import { resolveDiffTurn } from '@/lib/opencode/transcript';
import { areSessionListsEqual, areSessionStatusMapsEqual, groupPendingRequestsBySession, mergeSessionStatuses } from '@/providers/opencode-provider-utils';
import type { DiffScope } from '@/providers/opencode-provider-types';
import type { SessionRefreshOptions } from '@/providers/opencode-provider-events';
import { persistSessionCache } from '@/providers/session-cache';
import {
  getActiveSessionStatuses as svcGetActiveSessionStatuses,
  listSessions as svcListSessions,
  getSessionDiff as svcGetSessionDiff,
  getSessionTodos as svcGetSessionTodos,
} from '@/providers/services/session-service';
import { getVcsDiff as svcGetVcsDiff } from '@/providers/services/project-service';
import type { ProjectActionsInput } from '@/providers/opencode-provider-action-inputs';

// Coalesce a burst of streaming part events into a single transcript read.
// Lower than a frame budget for a snappy chat, high enough to avoid one page
// download per event.
const MESSAGE_REFRESH_COALESCE_MS = 400;
// A list read that started before a session was created can resolve after it.
// Keep just-created sessions visible for a short grace period.
const LOCAL_SESSION_GRACE_MS = 10_000;

async function withDiffLoading<T>(silent: boolean, setLoading: (value: boolean) => void, task: () => Promise<T>) {
  if (!silent) setLoading(true);
  try {
    return await task();
  } finally {
    if (!silent) setLoading(false);
  }
}

export function useProjectRefreshActions({
  activeProjectPath,
  client,
  isCurrentClient,
  setSessions,
  sessionsRef,
  setSessionStatuses,
  locallyCreatedSessionsRef,
  setIsRefreshingDiffs,
  setDiffsBySession,
  setVcsDiffsByScope,
  setTodosBySession,
  setPendingPermissionsBySession,
  setPendingQuestionsBySession,
  suppressedPendingRequestIdsRef,
  setDiffScopeBySession,
  setSelectedDiffMessageBySession,
  selectedDiffMessageBySessionRef,
  diffScopeBySessionRef,
  currentSessionIdRef,
  messagesBySessionRef,
  sessionRefreshTimeoutsRef,
  sessionRefreshOptionsRef,
  connectionScope,
  refreshMessages,
}: ProjectActionsInput) {
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
    [activeProjectPath, client, connectionScope, isCurrentClient, locallyCreatedSessionsRef, sessionsRef],
  );

  const refreshSessionStatuses = useCallback(async () => {
    if (client.compatibility) {
      await refreshSessions();
      return;
    }
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

  const refreshSessionDiff = useCallback(
    async (sessionId: string, silent = false, messageId?: string) => withDiffLoading(silent, setIsRefreshingDiffs, async () => {
      const messages = messagesBySessionRef.current[sessionId] ?? [];
      const pinned = selectedDiffMessageBySessionRef.current[sessionId];
      // Resolve through the same selector the diff surface displays with so a
      // request can never ask the server for a different turn than the one the
      // overlay highlights.
      const targetMessageId = messageId ?? resolveDiffTurn(messages, pinned);
      const data = await svcGetSessionDiff(client, sessionId, targetMessageId, messages);
      if (!isCurrentClient(client)) {
        return data;
      }
      setDiffsBySession((current) => ({
        ...current,
        [sessionId]: data,
      }));

      return data;
    }),
    [client, isCurrentClient],
  );

  const refreshVcsDiff = useCallback(
    async (scope: 'uncommitted' | 'branch', silent = false) => withDiffLoading(silent, setIsRefreshingDiffs, async () => {
      const data = await svcGetVcsDiff(client, scope === 'branch' ? 'branch' : 'git');
      if (!isCurrentClient(client)) {
        return data;
      }
      setVcsDiffsByScope((current) => ({
        ...current,
        [scope]: data,
      }));

      return data;
    }),
    [client, isCurrentClient],
  );

  const setDiffScope = useCallback(
    (scope: DiffScope) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      setDiffScopeBySession((current) => ({ ...current, [sessionId]: scope }));
      if (scope !== 'turn') {
        void refreshVcsDiff(scope, true);
      }
    },
    [refreshVcsDiff],
  );

  const selectDiffMessage = useCallback(
    (messageId: string) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      setSelectedDiffMessageBySession((current) => ({ ...current, [sessionId]: messageId }));
      void refreshSessionDiff(sessionId, true, messageId);
    },
    [refreshSessionDiff],
  );

  const refreshDiffs = useCallback(
    async (silent = false) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      const scope = diffScopeBySessionRef.current[sessionId] ?? 'turn';
      if (scope === 'turn') {
        await refreshSessionDiff(sessionId, silent);
      } else {
        await refreshVcsDiff(scope, silent);
      }
    },
    [refreshSessionDiff, refreshVcsDiff],
  );

  const refreshSessionTodos = useCallback(
    async (sessionId: string) => {
      const data = await svcGetSessionTodos(client, sessionId);
      if (!isCurrentClient(client)) {
        return data;
      }

      setTodosBySession((current) => ({
        ...current,
        [sessionId]: data,
      }));

      return data;
    },
    [client, isCurrentClient],
  );

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

  const scheduleSessionRefresh = useCallback(
    (sessionId: string, options?: SessionRefreshOptions) => {
      if (!sessionId) {
        return;
      }

      const existing = sessionRefreshTimeoutsRef.current[sessionId];
      if (existing) {
        clearTimeout(existing);
      }

      const pending = sessionRefreshOptionsRef.current[sessionId] || {};
      sessionRefreshOptionsRef.current[sessionId] = {
        messages: pending.messages || options?.messages,
        messageMode: pending.messageMode ?? options?.messageMode,
        diff: pending.diff || options?.diff,
        todos: pending.todos || options?.todos,
        sessions: pending.sessions || options?.sessions,
      };

      sessionRefreshTimeoutsRef.current[sessionId] = setTimeout(() => {
        delete sessionRefreshTimeoutsRef.current[sessionId];
        const mergedOptions = sessionRefreshOptionsRef.current[sessionId] || {};
        delete sessionRefreshOptionsRef.current[sessionId];

        if (mergedOptions.sessions) {
          void refreshSessions().catch(() => undefined);
        }
        if (mergedOptions.messages) {
          void refreshMessages(sessionId, true, mergedOptions.messageMode ? { mode: mergedOptions.messageMode } : undefined).catch(() => undefined);
        }
        if (mergedOptions.diff) {
          void refreshSessionDiff(sessionId, true).catch(() => undefined);
        }
        if (mergedOptions.todos) {
          void refreshSessionTodos(sessionId).catch(() => undefined);
        }
      }, options?.delayMs ?? MESSAGE_REFRESH_COALESCE_MS);
    },
    [refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  return {
    refreshSessions,
    refreshSessionStatuses,
    refreshSessionDiff,
    refreshVcsDiff,
    setDiffScope,
    selectDiffMessage,
    refreshDiffs,
    refreshSessionTodos,
    refreshPendingInteractions,
    scheduleSessionRefresh,
  };
}
