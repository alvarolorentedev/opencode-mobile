import {
  createSession as svcCreateSession,
  deleteSession as svcDeleteSession,
  executeCommand as svcExecuteCommand,
  executeShell as svcExecuteShell,
  forkSession as svcForkSession,
  interruptSession as svcInterruptSession,
  revertSession as svcRevertSession,
  unrevertSession as svcUnrevertSession,
  updateSessionTitle as svcUpdateSessionTitle,
  waitForSessionIdle as svcWaitForSessionIdle,
} from '@/providers/services/session-service';
import { useCallback } from 'react';

import type { Session, SessionStatus } from '@/lib/opencode/types';
import { getSelectedModelParts, getSelectedModelVariant } from '@/providers/opencode-model-selection';
import { persistSessionCache } from '@/providers/session-cache';
import type { SessionCrudInput } from '@/providers/opencode-provider-action-inputs';

export function useSessionCrudActions({
  client,
  isCurrentClient,
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
  refreshSessions,
  refreshMessages,
  refreshSessionDiff,
  refreshSessionTodos,
  refreshVcsDiff,
  refreshPendingInteractions,
  refreshActiveSessions,
  chatPreferences,
}: SessionCrudInput) {
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

  const revertSession = useCallback(async (sessionId: string, messageId: string) => {
    // A revert cannot be staged while the session is running. Interrupt first,
    // then let the server finish settling before staging the rewind. Both calls
    // are idle no-ops, and local status can lag the server either way.
    await svcInterruptSession(client, sessionId);
    await svcWaitForSessionIdle(client, sessionId);
    await svcRevertSession(client, sessionId, messageId);
    await Promise.all([refreshSessions(), refreshMessages(sessionId, true, { mode: 'replace' }), refreshSessionDiff(sessionId, true)]);
  }, [client, refreshMessages, refreshSessionDiff, refreshSessions]);

  const unrevertSession = useCallback(async (sessionId: string) => {
    await svcUnrevertSession(client, sessionId);
    await Promise.all([refreshSessions(), refreshMessages(sessionId, true, { mode: 'replace' }), refreshSessionDiff(sessionId, true)]);
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
    await Promise.all([refreshMessages(sessionId, true), refreshSessions()]).catch(() => undefined);
  }, [availableModels, chatPreferences.mode, chatPreferences.modelId, chatPreferences.modelVariantSelections, client, refreshMessages, refreshSessions, sessions]);

  const executeShell = useCallback(async (sessionId: string, command: string) => {
    await svcExecuteShell(client, sessionId, command);
    await Promise.all([refreshMessages(sessionId, true), refreshSessions()]).catch(() => undefined);
  }, [client, refreshMessages, refreshSessions]);

  return {
    openSession,
    createSession,
    deleteSession,
    renameSession,
    forkSession,
    revertSession,
    unrevertSession,
    executeCommand,
    executeShell,
  };
}
