import type { TranscriptRefreshMode } from '@/providers/opencode-provider-types';

export type ReconcileSources = {
  pendingSessionIds: string[];
  currentSessionId?: string;
  conversationSessionId?: string;
  refreshSessions: () => Promise<unknown>;
  refreshSessionStatuses?: () => Promise<unknown>;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshMessages: (sessionId: string, silent: boolean, options?: { mode?: TranscriptRefreshMode }) => Promise<unknown>;
  refreshSessionDiff: (sessionId: string, silent: boolean) => Promise<unknown>;
  refreshSessionTodos: (sessionId: string) => Promise<unknown>;
  refreshNativeSurfaces?: (full?: boolean) => Promise<unknown>;
};

export function collectReconcileSessionIds({
  pendingSessionIds,
  currentSessionId,
  conversationSessionId,
}: Pick<ReconcileSources, 'pendingSessionIds' | 'currentSessionId' | 'conversationSessionId'>) {
  return new Set(
    [...pendingSessionIds, currentSessionId, conversationSessionId]
      .filter((id): id is string => Boolean(id)),
  );
}

export function createReconciler({
  getSources,
  onPollFailure,
}: {
  getSources: () => ReconcileSources;
  onPollFailure: (failed: boolean) => void;
}) {
  let inFlight: Promise<unknown> | undefined;
  let pendingFull = false;

  const reconcile = function reconcile(full = false): Promise<unknown> {
    if (inFlight) {
      // A reconnect's authoritative rebuild must not be swallowed by a poll
      // that was already running; queue it behind the in-flight pass.
      if (full) pendingFull = true;
      return inFlight;
    }
    const sources = getSources();
    const sessions = collectReconcileSessionIds(sources);
    // A safety poll only needs the running set. Full cursor-paged session lists
    // stay on reconnect/foreground reconciliation and session-list events.
    const sessionRefresh = !full && sources.refreshSessionStatuses
      ? sources.refreshSessionStatuses()
      : sources.refreshSessions();
    let result: Promise<unknown>;
    result = (async () => {
      // Tier 1: identity, blocking state, and the visible transcript can run
      // together. A slow session list must not stop the current chat from
      // tailing its newest page.
      const corePromise = Promise.allSettled([sessionRefresh, sources.refreshPendingInteractions()]);
      const messagesPromise = Promise.allSettled([...sessions].map((id) => sources.refreshMessages(id, true)));
      const [core, messages] = await Promise.all([corePromise, messagesPromise]);
      onPollFailure(
        core.some((entry) => entry.status === 'rejected')
          || messages.some((entry) => entry.status === 'rejected'),
      );
      // Tier 2: diff/todo detail waits for the transcript, so a 3G link does
      // not carry several large bodies at once.
      const details = await Promise.allSettled([...sessions].flatMap((id) => [sources.refreshSessionDiff(id, true), sources.refreshSessionTodos(id)]));
      if (details.some((entry) => entry.status === 'rejected')) onPollFailure(true);
      // Tier 3: native surfaces/widgets are useful but never block the chat.
      if (sources.refreshNativeSurfaces) {
        await Promise.resolve(sources.refreshNativeSurfaces(full)).catch(() => undefined);
      }
    })().finally(() => {
      if (inFlight !== result) return;
      inFlight = undefined;
      if (pendingFull) {
        pendingFull = false;
        void reconcile(true);
      }
    });
    inFlight = result;
    return result;
  };

  return {
    reconcile,
    reset() {
      inFlight = undefined;
      pendingFull = false;
    },
  };
}
