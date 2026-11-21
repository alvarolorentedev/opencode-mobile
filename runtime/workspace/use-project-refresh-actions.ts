import { useCallback } from 'react';

import type { SessionRefreshOptions } from '@/shared/protocol/opencode/event-dispatch';
import type { SessionMessageRecord } from '@/shared/presentation/format';

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
      // A page read supersedes a single-message read; an inbox-only refresh is
      // dropped as soon as the transcript is refreshed, because the transcript
      // refresh already re-reads the inbox.
      const pendingFull = Boolean(pending.messages && !pending.messageId);
      const nextFull = pendingFull || Boolean(options?.messages && !options?.messageId);
      const messageId = nextFull
        ? undefined
        : options?.messageId ?? (pending.messages ? pending.messageId : undefined);
      const messages = Boolean(options?.messages || pending.messages);
      sessionRefreshOptionsRef.current[sessionId] = {
        messages,
        ...(messageId ? { messageId } : {}),
        inboxOnly: !messages && Boolean(pending.inboxOnly || options?.inboxOnly),
        delivered: Boolean(pending.delivered || options?.delivered),
        inboxID: options?.inboxID ?? pending.inboxID,
        messageMode: pending.messageMode ?? options?.messageMode,
        diff: pending.diff || options?.diff,
        todos: pending.todos || options?.todos,
        sessions: pending.sessions || options?.sessions,
      };

      sessionRefreshTimeoutsRef.current[sessionId] = setTimeout(() => {
        delete sessionRefreshTimeoutsRef.current[sessionId];
        const mergedOptions = sessionRefreshOptionsRef.current[sessionId] || {};
        delete sessionRefreshOptionsRef.current[sessionId];

        // The diff target is the user turn in the held transcript, so a
        // transcript read that was scheduled with it must land first.
        void (async () => {
          if (mergedOptions.sessions) {
            void refreshSessions().catch(() => undefined);
          }
          let refreshed: SessionMessageRecord[] | undefined;
          if (mergedOptions.messages) {
            refreshed = await refreshMessages(sessionId, true, {
              ...(mergedOptions.messageMode ? { mode: mergedOptions.messageMode } : {}),
              ...(mergedOptions.messageId ? { messageId: mergedOptions.messageId } : {}),
              ...(mergedOptions.delivered ? { delivered: true } : {}),
              ...(mergedOptions.inboxID ? { inboxID: mergedOptions.inboxID } : {}),
            }).catch(() => undefined);
          } else if (mergedOptions.inboxOnly) {
            await refreshMessages(sessionId, true, {
              inboxOnly: true,
              ...(mergedOptions.delivered ? { delivered: true } : {}),
              ...(mergedOptions.inboxID ? { inboxID: mergedOptions.inboxID } : {}),
            }).catch(() => undefined);
          }
          if (mergedOptions.diff) {
            void refreshSessionDiff(sessionId, true, undefined, refreshed).catch(() => undefined);
          }
          if (mergedOptions.todos) {
            void refreshSessionTodos(sessionId).catch(() => undefined);
          }
        })();
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
