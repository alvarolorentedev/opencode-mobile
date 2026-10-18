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
  sessions,
  messagesBySession,
  lastSessionByConnection,
  pendingDeepLinkTargetRef,
  bootstrapPromiseRef,
  bootstrapTokenRef,
  isCurrentClient,
  fetchSessions,
  refreshMessages,
  refreshSessionDiff,
  refreshSessionTodos,
  refreshPendingInteractions,
  refreshChatCapabilities,
  refreshServerFeatures,
  refreshDiagnostics,
  setCurrentSessionId,
  setLastSessionByConnection,
  setIsBootstrappingChat,
}: SessionBootstrapActionsInput) {
  const ensureActiveSession = useCallback(async () => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return undefined;
    }

    const pendingTarget = pendingDeepLinkTargetRef.current;
    if (
      currentSessionId &&
      sessions.some((session) => session.id === currentSessionId) &&
      (!pendingTarget || pendingTarget.sessionId === currentSessionId)
    ) {
      if (!messagesBySession[currentSessionId]) {
        await refreshMessages(currentSessionId, true);
      }
      return currentSessionId;
    }

    if (bootstrapPromiseRef.current) {
      return bootstrapPromiseRef.current;
    }

    const bootstrapToken = {};
    bootstrapTokenRef.current = bootstrapToken;
    const bootstrapPromise = (async () => {
      setIsBootstrappingChat(true);

      try {
        const nextSessions = sessions.length > 0 && (!pendingTarget || sessions.some((session) => session.id === pendingTarget.sessionId))
          ? sessions : await fetchSessions(true);
        if (pendingDeepLinkTargetRef.current !== pendingTarget) {
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
        await Promise.all([
          refreshMessages(targetSession.id, true),
          refreshSessionDiff(targetSession.id, true),
          refreshSessionTodos(targetSession.id),
          refreshPendingInteractions(),
          refreshChatCapabilities(),
          refreshServerFeatures(),
          refreshDiagnostics(),
        ]);
        if (!isCurrentClient(client) || pendingDeepLinkTargetRef.current !== pendingTarget) {
          return undefined;
        }
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
    connection.status,
    connectionScope,
    client,
    createSession,
    currentSessionId,
    fetchSessions,
    lastSessionByConnection,
    isCurrentClient,
    messagesBySession,
    refreshMessages,
    refreshPendingInteractions,
    refreshChatCapabilities,
    refreshDiagnostics,
    refreshServerFeatures,
    refreshSessionDiff,
    refreshSessionTodos,
    sessions,
    setCurrentSessionId,
    setLastSessionByConnection,
    setIsBootstrappingChat,
  ]);

  return { ensureActiveSession };
}
