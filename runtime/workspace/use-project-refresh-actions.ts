import { useCallback } from 'react';

import type { SessionRefreshOptions } from '@/shared/protocol/opencode/event-dispatch';

import type { ProjectRefreshInput } from '@/runtime/composition/refresh-input';

import { useSessionRefresh } from '@/features/sessions/runtime';
import { useChatRefresh } from '@/features/chat/runtime';

// Coalesce a burst of streaming part events into a single transcript read.
// Lower than a frame budget for a snappy chat, high enough to avoid one page
// download per event.
const MESSAGE_REFRESH_COALESCE_MS = 400;

export function useProjectRefreshActions(input: ProjectRefreshInput) {
  const { sessionRefreshTimeoutsRef, sessionRefreshOptionsRef, refreshMessages } = input;
  const { refreshSessions, refreshSessionStatuses, refreshPendingInteractions } = useSessionRefresh(input);
  const { refreshSessionDiff, refreshVcsDiff, setDiffScope, selectDiffMessage, refreshDiffs, refreshSessionTodos } = useChatRefresh(input);

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
    [refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions, sessionRefreshOptionsRef, sessionRefreshTimeoutsRef],
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
