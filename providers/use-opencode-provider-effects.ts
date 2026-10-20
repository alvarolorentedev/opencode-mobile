import { useEffect } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { ConversationPhase } from '@/providers/opencode-provider-types';
import { pruneByKeepIds } from '@/providers/opencode-provider-utils';
import type { OpencodeProviderState } from '@/providers/use-opencode-provider-state';

type ProviderEffectsInput = OpencodeProviderState & {
  active: boolean;
  client: ScopedOpencodeClient;
  catalogClient: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  isHydrated: boolean;
  onboardingCompleted: boolean;
  connect: () => Promise<unknown>;
  refreshActiveSessions: () => Promise<unknown>;
  refreshWorktrees: () => Promise<unknown>;
  refreshMcpServers: () => Promise<unknown>;
  refreshTerminals: () => Promise<unknown>;
  refreshArchivedSessions: () => Promise<unknown>;
  ensureActiveSessionRef: { current: () => Promise<string | undefined> };
  setPromptError: (error: { message: string; occurredAt: number; sessionId?: string } | undefined) => void;
  conversationPhase: ConversationPhase;
  conversationSessionId?: string;
  sendingState: { sessionId?: string; active: boolean };
  pruneTranscript: (keepIds: Set<string>, limit: number) => void;
};

export function useOpencodeProviderEffects({
  active,
  client,
  catalogClient,
  isCurrentClient,
  isHydrated,
  onboardingCompleted,
  connect,
  refreshActiveSessions,
  refreshWorktrees,
  refreshMcpServers,
  refreshTerminals,
  refreshArchivedSessions,
  ensureActiveSessionRef,
  setPromptError,
  conversationPhase,
  conversationSessionId,
  sendingState,
  pruneTranscript,
  chatPreferences,
  connection,
  connectionScope,
  activeProjectPath,
  currentSessionId,
  sessions,
  sessionStatuses,
  lastSessionByConnection,
  setCurrentSessionId,
  setMessagesBySession,
  setDiffsBySession,
  setTodosBySession,
  isBootstrappingChat,
  pendingDeepLinkTargetRef,
  sessionRefreshTimeoutsRef,
  sessionRefreshOptionsRef,
  initialConnectStartedRef,
}: ProviderEffectsInput) {
  useEffect(() => {
    if (connection.status !== 'connected') {
      return;
    }
    void refreshActiveSessions().catch(() => undefined);
  }, [catalogClient, connection.status, refreshActiveSessions]);

  useEffect(() => {
    if (!isHydrated || initialConnectStartedRef.current) {
      return;
    }

    initialConnectStartedRef.current = true;
    if (onboardingCompleted) {
      void connect();
    }
  }, [connect, initialConnectStartedRef, isHydrated, onboardingCompleted]);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) return;
    void Promise.all([
      refreshWorktrees(),
      refreshMcpServers(),
      refreshTerminals(),
      refreshArchivedSessions(),
    ]).catch(() => undefined);
  }, [activeProjectPath, connection.status, refreshArchivedSessions, refreshMcpServers, refreshTerminals, refreshWorktrees]);

  useEffect(() => {
    if (!active || connection.status !== 'connected' || !activeProjectPath) {
      return;
    }

    let cancelled = false;
    void ensureActiveSessionRef.current().catch((error) => {
      if (!cancelled && isCurrentClient(client)) {
        setPromptError({
          message: error instanceof Error ? error.message : 'Could not load this project.',
          occurredAt: Date.now(),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, activeProjectPath, client, connection.status, ensureActiveSessionRef, isCurrentClient, setPromptError]);

  useEffect(
    () => () => {
      Object.values(sessionRefreshTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
      sessionRefreshTimeoutsRef.current = {};
      sessionRefreshOptionsRef.current = {};
    },
    [sessionRefreshOptionsRef, sessionRefreshTimeoutsRef],
  );

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    if (sessions.some((session) => session.id === currentSessionId)) {
      return;
    }

    const rememberedSessionId = activeProjectPath
      ? lastSessionByConnection[connectionScope]?.[activeProjectPath]
      : undefined;
    const fallbackSessionId = sessions.find((session) => session.id === rememberedSessionId)?.id || sessions[0]?.id;
    setCurrentSessionId(fallbackSessionId);
  }, [activeProjectPath, connectionScope, currentSessionId, lastSessionByConnection, sessions, setCurrentSessionId]);

  useEffect(() => {
    if (isBootstrappingChat) return;
    const keepIds = new Set<string>();
    const openingSessionId = pendingDeepLinkTargetRef.current?.sessionId;
    if (openingSessionId) keepIds.add(openingSessionId);
    if (currentSessionId) keepIds.add(currentSessionId);
    if (conversationSessionId) keepIds.add(conversationSessionId);
    for (const [id, status] of Object.entries(sessionStatuses)) {
      if (status.type !== 'idle') keepIds.add(id);
    }

    setMessagesBySession((current) => pruneByKeepIds(current, keepIds, keepIds.size + 1));
    setDiffsBySession((current) => pruneByKeepIds(current, keepIds, keepIds.size + 1));
    setTodosBySession((current) => pruneByKeepIds(current, keepIds, keepIds.size + 1));
    pruneTranscript(keepIds, keepIds.size + 1);
  }, [currentSessionId, conversationSessionId, isBootstrappingChat, pruneTranscript, sessionStatuses, setDiffsBySession, setMessagesBySession, setTodosBySession]);
}
