import { useEffect, useRef } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { pruneByKeepIds } from '@/providers/opencode-provider-utils';
import type { OpencodeProviderState } from '@/providers/use-opencode-provider-state';

// Keep a small bounded history so returning to a recent chat paints from
// memory. Pruning still enforces the record cap per session.
const RECENT_TRANSCRIPT_SESSIONS = 3;

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
  ensureActiveSessionRef: { current: () => Promise<string | undefined> };
  setPromptError: (error: { message: string; occurredAt: number; sessionId?: string } | undefined) => void;
  conversationSessionId?: string;
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
  ensureActiveSessionRef,
  setPromptError,
  conversationSessionId,
  pruneTranscript,
  connection,
  connectionScope,
  activeProjectPath,
  currentSessionId,
  currentSessionIdRef,
  explicitSessionSelectionRef,
  sessions,
  sessionsRef,
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
    // Worktrees label the active project. MCP, terminals, and archived sessions
    // load when their own tab/section opens instead of on every connect.
    void refreshWorktrees().catch(() => undefined);
  }, [activeProjectPath, connection.status, refreshWorktrees]);

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

    const currentSessions = sessionsRef.current;
    if (currentSessions.some((session) => session.id === currentSessionId)) {
      return;
    }

    const rememberedSessionId = activeProjectPath
      ? lastSessionByConnection[connectionScope]?.[activeProjectPath]
      : undefined;
    const fallbackSessionId = currentSessions.find((session) => session.id === rememberedSessionId)?.id || currentSessions[0]?.id;
    currentSessionIdRef.current = fallbackSessionId;
    setCurrentSessionId(fallbackSessionId);
  }, [activeProjectPath, connectionScope, currentSessionId, currentSessionIdRef, lastSessionByConnection, sessions, sessionsRef, setCurrentSessionId]);

  useEffect(() => {
    const explicit = explicitSessionSelectionRef.current;
    if (explicit && sessionsRef.current.some((session) => session.id === explicit)) {
      explicitSessionSelectionRef.current = undefined;
    }
  }, [explicitSessionSelectionRef, sessions, sessionsRef]);

  const recentSessionIdsRef = useRef<string[]>([]);
  const recentProjectRef = useRef(activeProjectPath);
  useEffect(() => {
    if (recentProjectRef.current !== activeProjectPath) {
      recentProjectRef.current = activeProjectPath;
      recentSessionIdsRef.current = [];
    }
    if (!currentSessionId) return;
    recentSessionIdsRef.current = [
      currentSessionId,
      ...recentSessionIdsRef.current.filter((id) => id !== currentSessionId),
    ].slice(0, RECENT_TRANSCRIPT_SESSIONS);
  }, [activeProjectPath, currentSessionId]);

  useEffect(() => {
    if (isBootstrappingChat) return;
    const keepIds = new Set<string>();
    const openingSessionId = pendingDeepLinkTargetRef.current?.sessionId;
    if (openingSessionId) keepIds.add(openingSessionId);
    if (currentSessionId) keepIds.add(currentSessionId);
    if (conversationSessionId) keepIds.add(conversationSessionId);
    for (const id of recentSessionIdsRef.current) keepIds.add(id);
    for (const [id, status] of Object.entries(sessionStatuses)) {
      if (status.type !== 'idle') keepIds.add(id);
    }

    setMessagesBySession((current) => pruneByKeepIds(current, keepIds, keepIds.size + 1));
    setDiffsBySession((current) => pruneByKeepIds(current, keepIds, keepIds.size + 1));
    setTodosBySession((current) => pruneByKeepIds(current, keepIds, keepIds.size + 1));
    pruneTranscript(keepIds, keepIds.size + 1);
  }, [currentSessionId, conversationSessionId, isBootstrappingChat, pruneTranscript, sessionStatuses, setDiffsBySession, setMessagesBySession, setTodosBySession]);
}
