import { useCallback } from 'react';

import type { Session } from '@/lib/opencode/types';
import type { SessionActionsInput } from '@/providers/opencode-provider-action-inputs';

type SessionBootstrapActionsInput = SessionActionsInput & {
  createSession: (title?: string) => Promise<Session>;
};

export function useSessionBootstrapActions({
  activeProjectPath,
  connection,
  connectionScope,
  client,
  createSession,
  currentSessionId,
  currentSessionIdRef,
  explicitSessionSelectionRef,
  sessionsRef,
  messagesBySession,
  lastSessionByConnection,
  pendingDeepLinkTargetRef,
  bootstrapPromiseRef,
  bootstrapTokenRef,
  isCurrentClient,
  refreshSessions,
  refreshMessages,
  refreshSessionDiff,
  refreshSessionTodos,
  refreshPendingInteractions,
  refreshChatCapabilities,
  refreshServerFeatures,
  setCurrentSessionId,
  setLastSessionByConnection,
  setIsBootstrappingChat,
}: SessionBootstrapActionsInput) {
  const ensureActiveSession = useCallback(async () => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return undefined;
    }

    const pendingTarget = pendingDeepLinkTargetRef.current;
    // The ref is updated synchronously by explicit selection. Reading it here
    // prevents a render-delayed bootstrap from replacing a chat the user just
    // opened or created.
    const selectedSessionId = currentSessionIdRef.current ?? currentSessionId;
    const explicitlySelected = explicitSessionSelectionRef.current === selectedSessionId;
    const currentSessions = sessionsRef.current;
    if (selectedSessionId
      && (explicitlySelected || currentSessions.some((session) => session.id === selectedSessionId))
      && (!pendingTarget || pendingTarget.sessionId === selectedSessionId)) {
      // Selection is already correct; hydrate in the background so callers
      // never wait for transcript I/O before navigating. Refresh even when
      // records are already present (for example from the transcript cache):
      // the transcript layer needs that read to establish or repair its paging
      // window, and the read stays non-blocking.
      void refreshMessages(selectedSessionId, (messagesBySession[selectedSessionId]?.length ?? 0) > 0).catch(() => undefined);
      return selectedSessionId;
    }

    if (bootstrapPromiseRef.current) {
      return bootstrapPromiseRef.current;
    }

    const bootstrapToken = {};
    bootstrapTokenRef.current = bootstrapToken;
    const bootstrapPromise = (async () => {
      setIsBootstrappingChat(true);

      try {
        const nextSessions = currentSessions.length > 0 && (!pendingTarget || currentSessions.some((session) => session.id === pendingTarget.sessionId))
          ? currentSessions : await refreshSessions();
        if (bootstrapTokenRef.current !== bootstrapToken || pendingDeepLinkTargetRef.current !== pendingTarget) {
          return undefined;
        }
        const rememberedSessionId = activeProjectPath
          ? lastSessionByConnection[connectionScope]?.[activeProjectPath]
          : undefined;
        const targetSession = pendingTarget
          ? nextSessions.find((session) => session.id === pendingTarget.sessionId)
          : (rememberedSessionId ? nextSessions.find((session) => session.id === rememberedSessionId) : undefined) ??
            nextSessions[0] ??
            (await createSession());
        if (!targetSession) {
          return undefined;
        }
        if (bootstrapTokenRef.current !== bootstrapToken || !isCurrentClient(client) || pendingDeepLinkTargetRef.current !== pendingTarget) {
          return undefined;
        }
        // Commit the selection before any content request. The chat can render
        // its header and a transcript skeleton while these reads settle.
        currentSessionIdRef.current = targetSession.id;
        setCurrentSessionId(targetSession.id);
        if (activeProjectPath) {
          setLastSessionByConnection((current) => ({
            ...current,
            [connectionScope]: {
              ...current[connectionScope],
              [activeProjectPath]: targetSession.id,
            },
          }));
        }
        void Promise.all([
          refreshMessages(targetSession.id),
          refreshSessionDiff(targetSession.id, true),
          refreshSessionTodos(targetSession.id),
          refreshPendingInteractions(),
          refreshChatCapabilities(),
          refreshServerFeatures(),
        ]).catch(() => undefined);
        return targetSession.id;
      } finally {
        if (bootstrapTokenRef.current === bootstrapToken) {
          setIsBootstrappingChat(false);
          bootstrapPromiseRef.current = null;
          bootstrapTokenRef.current = undefined;
        }
      }
    })();

    bootstrapPromiseRef.current = bootstrapPromise;
    return bootstrapPromise;
  }, [
    activeProjectPath,
    bootstrapPromiseRef,
    bootstrapTokenRef,
    connection.status,
    connectionScope,
    client,
    createSession,
    currentSessionId,
    currentSessionIdRef,
    explicitSessionSelectionRef,
    refreshSessions,
    lastSessionByConnection,
    isCurrentClient,
    messagesBySession,
    pendingDeepLinkTargetRef,
    refreshMessages,
    refreshPendingInteractions,
    refreshChatCapabilities,
    refreshServerFeatures,
    refreshSessionDiff,
    refreshSessionTodos,
    sessionsRef,
    setCurrentSessionId,
    setLastSessionByConnection,
    setIsBootstrappingChat,
  ]);

  return { ensureActiveSession };
}
