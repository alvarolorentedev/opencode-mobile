import { useCallback } from 'react';

import { listPendingInteractions } from '@/lib/opencode/client';
import { resolveDiffTurn } from '@/lib/opencode/transcript';
import { areSessionListsEqual, areSessionStatusMapsEqual, groupPendingRequestsBySession, mergeSessionStatuses } from '@/providers/opencode-provider-utils';
import type { DiffScope } from '@/providers/opencode-provider-types';
import type { SessionRefreshOptions } from '@/providers/opencode-provider-events';
import { persistSessionCache } from '@/providers/session-cache';
import {
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

export function useProjectRefreshActions({
  activeProjectPath,
  client,
  isCurrentClient,
  setSessions,
  setSessionStatuses,
  setIsRefreshingSessions,
  setIsRefreshingDiffs,
  setDiffsBySession,
  setVcsDiffsByScope,
  setTodosBySession,
  setPendingPermissionsBySession,
  setPendingQuestionsBySession,
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
  const fetchSessions = useCallback(
    async (silent = false) => {
      if (!activeProjectPath) {
        setSessions([]);
        setSessionStatuses({});
        return [];
      }

      if (!silent) {
        setIsRefreshingSessions(true);
      }

      try {
        const result = await svcListSessions(client);
        if (!isCurrentClient(client)) {
          return result.sessions;
        }
        setSessions((current) => (areSessionListsEqual(current, result.sessions) ? current : result.sessions));
        setSessionStatuses((current) => {
          const next = mergeSessionStatuses(current, result.statuses);
          return areSessionStatusMapsEqual(current, next) ? current : next;
        });
        void persistSessionCache(connectionScope, activeProjectPath, result.sessions, result.statuses);
        return result.sessions;
      } finally {
        if (!silent) {
          setIsRefreshingSessions(false);
        }
      }
    },
    [activeProjectPath, client, connectionScope, isCurrentClient],
  );

  const refreshSessions = useCallback(
    async (silent = false) => {
      await fetchSessions(silent);
    },
    [fetchSessions],
  );

  const refreshSessionDiff = useCallback(
    async (sessionId: string, silent = false, messageId?: string) => {
      if (!silent) {
        setIsRefreshingDiffs(true);
      }

      try {
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
      } finally {
        if (!silent) {
          setIsRefreshingDiffs(false);
        }
      }
    },
    [client, isCurrentClient],
  );

  const refreshVcsDiff = useCallback(
    async (scope: 'uncommitted' | 'branch', silent = false) => {
      if (!silent) {
        setIsRefreshingDiffs(true);
      }

      try {
        const data = await svcGetVcsDiff(client, scope === 'branch' ? 'branch' : 'git');
        if (!isCurrentClient(client)) {
          return data;
        }
        setVcsDiffsByScope((current) => ({
          ...current,
          [scope]: data,
        }));

        return data;
      } finally {
        if (!silent) {
          setIsRefreshingDiffs(false);
        }
      }
    },
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
    if (permissions) setPendingPermissionsBySession(groupPendingRequestsBySession(permissions));
    if (questions) setPendingQuestionsBySession(groupPendingRequestsBySession(questions));
  }, [client, isCurrentClient]);

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
          void refreshSessions(true).catch(() => undefined);
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
    fetchSessions,
    refreshSessions,
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

export type ProjectRefreshActions = ReturnType<typeof useProjectRefreshActions>;
