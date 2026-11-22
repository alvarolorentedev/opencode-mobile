import type { TranscriptReadOptions } from '@/shared/contracts/domain';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { SessionRefreshOptions } from '@/shared/protocol/opencode/event-dispatch';

const MESSAGE_REFRESH_COALESCE_MS = 400;
const CATALOG_REFRESH_COALESCE_MS = 150;

type RefreshActions = {
  refreshSessions: () => Promise<unknown>;
  refreshMessages: (id: string, silent?: boolean, options?: TranscriptReadOptions) => Promise<SessionMessageRecord[]>;
  refreshSessionDiff: (id: string, silent?: boolean, messageId?: string, records?: SessionMessageRecord[]) => Promise<unknown>;
  refreshSessionTodos: (id: string) => Promise<unknown>;
};

export function createProjectRefreshQueue() {
  const scheduled = new Map<string, { timer: ReturnType<typeof setTimeout>; options: SessionRefreshOptions }>();
  let catalogTimer: ReturnType<typeof setTimeout> | undefined;
  let scopeGeneration = 0;

  function scheduleSession(sessionId: string, options: SessionRefreshOptions | undefined, {
    refreshSessions, refreshMessages, refreshSessionDiff, refreshSessionTodos,
  }: RefreshActions) {
    if (!sessionId) return;

    const existing = scheduled.get(sessionId);
    clearTimeout(existing?.timer);

    const pending = existing?.options ?? {};
    // A page read supersedes a single-message read; an inbox-only refresh is
    // dropped as soon as the transcript is refreshed, because the transcript
    // refresh already re-reads the inbox.
    const pendingFull = Boolean(pending.messages && !pending.messageId);
    const nextFull = pendingFull || Boolean(options?.messages && !options?.messageId);
    const messageId = nextFull
      ? undefined
      : options?.messageId ?? (pending.messages ? pending.messageId : undefined);
    const messages = Boolean(options?.messages || pending.messages);
    const mergedOptions = {
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

    const generation = scopeGeneration;
    const timer = setTimeout(() => {
      scheduled.delete(sessionId);

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
        if (generation !== scopeGeneration) return;
        if (mergedOptions.diff) {
          void refreshSessionDiff(sessionId, true, undefined, refreshed).catch(() => undefined);
        }
        if (mergedOptions.todos) {
          void refreshSessionTodos(sessionId).catch(() => undefined);
        }
      })();
    }, options?.delayMs ?? MESSAGE_REFRESH_COALESCE_MS);
    scheduled.set(sessionId, { timer, options: mergedOptions });
  }

  function scheduleCatalog(refresh: RefreshActions['refreshSessions']) {
    clearTimeout(catalogTimer);
    catalogTimer = setTimeout(() => {
      catalogTimer = undefined;
      void refresh().catch(() => undefined);
    }, CATALOG_REFRESH_COALESCE_MS);
  }

  function clear() {
    scopeGeneration += 1;
    for (const { timer } of scheduled.values()) clearTimeout(timer);
    scheduled.clear();
    clearTimeout(catalogTimer);
    catalogTimer = undefined;
  }

  return { scheduleSession, scheduleCatalog, clear };
}
