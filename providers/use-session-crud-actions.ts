import { createSession as svcCreateSession, summarizeSession } from '@/providers/services/session-service';
import { useCallback } from 'react';

import type { Session, SessionStatus } from '@/lib/opencode/types';
import { getSelectedModelParts, getSelectedModelVariant } from '@/providers/opencode-model-selection';
import { persistSessionCache } from '@/providers/session-cache';
import {
  archiveSession as svcArchiveSession,
  deleteSession as svcDeleteSession,
  executeCommand as svcExecuteCommand,
  forkSession as svcForkSession,
  listArchivedSessions as svcListArchivedSessions,
  revertSession as svcRevertSession,
  shareSession as svcShareSession,
  unrevertSession as svcUnrevertSession,
  unshareSession as svcUnshareSession,
  updateSessionTitle as svcUpdateSessionTitle,
} from '@/providers/services/session-service';
import type { SessionActionsInput } from '@/providers/opencode-provider-action-inputs';

export function useSessionCrudActions({
  client,
  catalogClient,
  isCurrentClient,
  isCurrentCatalogClient,
  activeProjectPath,
  connectionScopeRef,
  currentSessionId,
  currentSessionIdRef,
  explicitSessionSelectionRef,
  locallyCreatedSessionsRef,
  availableModels,
  diffScopeBySessionRef,
  sessions,
  sessionStatuses,
  bootstrapPromiseRef,
  bootstrapTokenRef,
  setLastSessionByConnection,
  setCurrentSessionId,
  setIsBootstrappingChat,
  beginHydration,
  setSessions,
  setSessionStatuses,
  setMessagesBySession,
  setDiffsBySession,
  setTodosBySession,
  setPendingPermissionsBySession,
  setPendingQuestionsBySession,
  setFavoriteSessions,
  setArchivedSessions,
  fetchSessions,
  refreshSessions,
  refreshMessages,
  refreshSessionDiff,
  refreshSessionTodos,
  refreshVcsDiff,
  refreshPendingInteractions,
  refreshActiveSessions,
  chatPreferences,
}: SessionActionsInput) {
  const persistSnapshot = useCallback((nextSessions: Session[], nextStatuses: Record<string, SessionStatus>) => {
    if (!activeProjectPath) return;
    void persistSessionCache(connectionScopeRef.current, activeProjectPath, nextSessions, nextStatuses);
  }, [activeProjectPath, connectionScopeRef]);

  const openSession = useCallback(
    async (sessionId: string) => {
      // Selection is local and immediate. Callers (chat library, new chat,
      // fork) must not wait for transcript/diff hydration before navigating.
      // An explicit selection also supersedes an in-flight initial bootstrap,
      // which could otherwise finish later and select the remembered chat.
      bootstrapPromiseRef.current = null;
      bootstrapTokenRef.current = undefined;
      setIsBootstrappingChat(false);
      currentSessionIdRef.current = sessionId;
      explicitSessionSelectionRef.current = sessionId;
      setCurrentSessionId(sessionId);
      if (activeProjectPath) {
        const scope = connectionScopeRef.current;
        setLastSessionByConnection((current) => ({
          ...current,
          [scope]: {
            ...current[scope],
            [activeProjectPath]: sessionId,
          },
        }));
      }
      // Mark the session as hydrating before the prompt-inbox read, which can
      // take as long as the transcript read on a slow link. Otherwise the chat
      // briefly shows its empty starter state while the selected session loads.
      const finishHydration = beginHydration(sessionId);
      void Promise.all([
        refreshMessages(sessionId),
        refreshSessionDiff(sessionId, true),
        refreshSessionTodos(sessionId),
        refreshPendingInteractions(),
      ]).then(() => {
        const scope = diffScopeBySessionRef.current[sessionId];
        if (scope && scope !== 'turn') {
          void refreshVcsDiff(scope, true);
        }
      }).catch(() => undefined).finally(finishHydration);
    },
    [activeProjectPath, beginHydration, bootstrapPromiseRef, bootstrapTokenRef, connectionScopeRef, currentSessionIdRef, diffScopeBySessionRef, explicitSessionSelectionRef, refreshMessages, refreshPendingInteractions, refreshSessionDiff, refreshSessionTodos, refreshVcsDiff, setCurrentSessionId, setIsBootstrappingChat, setLastSessionByConnection],
  );

  const createSession = useCallback(
    async (title?: string) => {
      const trimmedTitle = title?.trim();
      const created = await svcCreateSession(client, trimmedTitle);

      if (!created) {
        throw new Error('OpenCode did not return the created session.');
      }
      if (!isCurrentClient(client)) {
        throw new Error('The active project changed before the session was created.');
      }
      // The server already returned the session. Show it immediately and let a
      // background read reconcile ordering/status instead of delaying the chat.
      const nextSessions = [created, ...sessions.filter((session) => session.id !== created.id)];
      const nextStatuses = { ...sessionStatuses, [created.id]: { type: 'idle' as const } };
      locallyCreatedSessionsRef.current.set(created.id, Date.now());
      setSessions((current) => [created, ...current.filter((session) => session.id !== created.id)]);
      setSessionStatuses((current) => ({ ...current, [created.id]: { type: 'idle' } }));
      persistSnapshot(nextSessions, nextStatuses);
      return created;
    },
    [client, isCurrentClient, locallyCreatedSessionsRef, persistSnapshot, sessionStatuses, sessions, setSessionStatuses, setSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await svcDeleteSession(client, sessionId);
      if (!isCurrentClient(client)) {
        return;
      }
      setMessagesBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setDiffsBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setTodosBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setPendingPermissionsBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setPendingQuestionsBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setFavoriteSessions((current) => current.filter(
        (favorite) => !(favorite.connectionScope === connectionScopeRef.current && favorite.sessionId === sessionId),
      ));
      const nextSessions = sessions.filter((session) => session.id !== sessionId);
      const nextStatuses = { ...sessionStatuses };
      delete nextStatuses[sessionId];
      locallyCreatedSessionsRef.current.delete(sessionId);
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      setSessionStatuses((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      persistSnapshot(nextSessions, nextStatuses);
      if (currentSessionId === sessionId) {
        currentSessionIdRef.current = undefined;
        explicitSessionSelectionRef.current = undefined;
        setCurrentSessionId(undefined);
      }
      void refreshActiveSessions().catch(() => undefined);
    },
    [client, connectionScopeRef, currentSessionId, currentSessionIdRef, explicitSessionSelectionRef, isCurrentClient, locallyCreatedSessionsRef, persistSnapshot, refreshActiveSessions, sessionStatuses, sessions, setCurrentSessionId, setDiffsBySession, setFavoriteSessions, setMessagesBySession, setPendingPermissionsBySession, setPendingQuestionsBySession, setSessionStatuses, setSessions, setTodosBySession],
  );

  const refreshArchivedSessions = useCallback(async () => {
    const next = await svcListArchivedSessions(catalogClient);
    if (isCurrentCatalogClient(catalogClient)) {
      setArchivedSessions([...next].sort((left, right) => right.time.updated - left.time.updated));
    }
  }, [catalogClient, isCurrentCatalogClient, setArchivedSessions]);

  const archiveSession = useCallback(async (sessionId: string) => {
    await svcArchiveSession(client, sessionId);
    if (!isCurrentClient(client)) return;
    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    const nextStatuses = { ...sessionStatuses };
    delete nextStatuses[sessionId];
    locallyCreatedSessionsRef.current.delete(sessionId);
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    setSessionStatuses((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    persistSnapshot(nextSessions, nextStatuses);
    if (currentSessionId === sessionId) {
      currentSessionIdRef.current = undefined;
      explicitSessionSelectionRef.current = undefined;
      setCurrentSessionId(undefined);
    }
    void Promise.all([refreshArchivedSessions(), refreshActiveSessions()]).catch(() => undefined);
  }, [client, currentSessionId, currentSessionIdRef, explicitSessionSelectionRef, isCurrentClient, locallyCreatedSessionsRef, persistSnapshot, refreshActiveSessions, refreshArchivedSessions, sessionStatuses, sessions, setCurrentSessionId, setSessionStatuses, setSessions]);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      throw new Error('Enter a session title.');
    }
    const previousTitle = sessions.find((session) => session.id === sessionId)?.title;
    const renamed = sessions.map((session) => (
      session.id === sessionId ? { ...session, title: trimmed } : session
    ));
    // Rename is safe to echo locally; the server response is still required and
    // a rejection restores the previous title.
    setSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, title: trimmed } : session
    )));
    try {
      await svcUpdateSessionTitle(client, sessionId, trimmed);
      if (!isCurrentClient(client)) return;
      persistSnapshot(renamed, sessionStatuses);
    } catch (error) {
      if (isCurrentClient(client)) {
        setSessions((current) => current.map((session) => (
          session.id === sessionId && previousTitle !== undefined ? { ...session, title: previousTitle } : session
        )));
      }
      throw error;
    }
  }, [client, isCurrentClient, persistSnapshot, sessionStatuses, sessions, setSessions]);

  const forkSession = useCallback(async (sessionId: string, messageId?: string) => {
    const forked = await svcForkSession(client, sessionId, messageId);
    if (!forked) {
      throw new Error('OpenCode did not return the forked session.');
    }
    if (!isCurrentClient(client)) {
      throw new Error('The active project changed before the session was forked.');
    }
    const nextSessions = [forked, ...sessions.filter((session) => session.id !== forked.id)];
    const nextStatuses = { ...sessionStatuses, [forked.id]: { type: 'idle' as const } };
    locallyCreatedSessionsRef.current.set(forked.id, Date.now());
    setSessions((current) => [forked, ...current.filter((session) => session.id !== forked.id)]);
    setSessionStatuses((current) => ({ ...current, [forked.id]: { type: 'idle' } }));
    persistSnapshot(nextSessions, nextStatuses);
    await openSession(forked.id);
    return forked;
  }, [client, isCurrentClient, locallyCreatedSessionsRef, openSession, persistSnapshot, sessionStatuses, sessions, setSessionStatuses, setSessions]);

  const shareSession = useCallback(async (sessionId: string) => {
    const shared = await svcShareSession(client, sessionId);
    if (!shared) {
      throw new Error('OpenCode did not return the shared session.');
    }
    if (!isCurrentClient(client)) {
      throw new Error('The active project changed before sharing finished.');
    }
    await refreshSessions(true);
    return shared;
  }, [client, isCurrentClient, refreshSessions]);

  const unshareSession = useCallback(async (sessionId: string) => {
    const unshared = await svcUnshareSession(client, sessionId);
    if (!unshared) {
      throw new Error('OpenCode did not return the session.');
    }
    if (!isCurrentClient(client)) {
      throw new Error('The active project changed before unsharing finished.');
    }
    await refreshSessions(true);
    return unshared;
  }, [client, isCurrentClient, refreshSessions]);

  const revertSession = useCallback(async (sessionId: string, messageId: string) => {
    await svcRevertSession(client, sessionId, messageId);
    await Promise.all([refreshSessions(true), refreshMessages(sessionId, true, { mode: 'replace' }), refreshSessionDiff(sessionId, true)]);
  }, [client, refreshMessages, refreshSessionDiff, refreshSessions]);

  const unrevertSession = useCallback(async (sessionId: string) => {
    await svcUnrevertSession(client, sessionId);
    await Promise.all([refreshSessions(true), refreshMessages(sessionId, true, { mode: 'replace' }), refreshSessionDiff(sessionId, true)]);
  }, [client, refreshMessages, refreshSessionDiff, refreshSessions]);

  const executeCommand = useCallback(async (sessionId: string, command: string, args: string) => {
    const selected = getSelectedModelParts(chatPreferences.modelId);
    const variant = client.__opencode?.contract === 'v2'
      ? getSelectedModelVariant(
          chatPreferences.modelId,
          chatPreferences.modelVariantSelections,
          availableModels,
          sessions.find((session) => session.id === sessionId)?.model,
        )
      : undefined;
    await svcExecuteCommand(client, sessionId, command, args, {
      agent: chatPreferences.mode,
      model: selected ? `${selected.providerID}/${selected.modelID}` : undefined,
      variant,
    });
    await Promise.all([refreshMessages(sessionId, true), refreshSessions(true)]).catch(() => undefined);
  }, [availableModels, chatPreferences.mode, chatPreferences.modelId, chatPreferences.modelVariantSelections, client, refreshMessages, refreshSessions, sessions]);

  const summarizeSessionTitle = useCallback(
    async (sessionId: string, knownSessions?: Session[]) => {
      const existingSession = (knownSessions || sessions).find((session) => session.id === sessionId);
      if (existingSession?.title?.trim()) {
        return existingSession;
      }

      const selectedModel = getSelectedModelParts(chatPreferences.modelId);
      if (!selectedModel) {
        return existingSession;
      }

      await summarizeSession(client, { sessionID: sessionId, ...selectedModel });

      const nextSessions = await fetchSessions(true);
      return nextSessions.find((session) => session.id === sessionId);
    },
    [chatPreferences.modelId, client, fetchSessions, sessions],
  );

  return {
    openSession,
    createSession,
    deleteSession,
    refreshArchivedSessions,
    archiveSession,
    renameSession,
    forkSession,
    shareSession,
    unshareSession,
    revertSession,
    unrevertSession,
    executeCommand,
    summarizeSessionTitle,
  };
}
