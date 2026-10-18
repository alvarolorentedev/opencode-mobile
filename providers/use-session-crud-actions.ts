import { createSession as svcCreateSession, summarizeSession } from '@/providers/services/session-service';
import { useCallback } from 'react';

import type { Session } from '@/lib/opencode/types';
import { getSelectedModelParts } from '@/providers/opencode-model-selection';
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
  diffScopeBySessionRef,
  sessions,
  setLastSessionByConnection,
  setCurrentSessionId,
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
  const openSession = useCallback(
    async (sessionId: string) => {
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
      await Promise.all([refreshMessages(sessionId), refreshSessionDiff(sessionId, true), refreshSessionTodos(sessionId), refreshPendingInteractions()]);
      const scope = diffScopeBySessionRef.current[sessionId];
      if (scope && scope !== 'turn') {
        void refreshVcsDiff(scope, true);
      }
    },
    [activeProjectPath, refreshMessages, refreshPendingInteractions, refreshSessionDiff, refreshSessionTodos, refreshVcsDiff, setCurrentSessionId, setLastSessionByConnection],
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
      await refreshSessions(true);
      return created;
    },
    [client, isCurrentClient, refreshSessions],
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
      if (currentSessionId === sessionId) {
        setCurrentSessionId(undefined);
      }
      await Promise.all([refreshSessions(true), refreshActiveSessions()]);
    },
    [client, currentSessionId, isCurrentClient, refreshActiveSessions, refreshSessions, setCurrentSessionId, setDiffsBySession, setFavoriteSessions, setMessagesBySession, setPendingPermissionsBySession, setPendingQuestionsBySession, setTodosBySession],
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
    if (currentSessionId === sessionId) setCurrentSessionId(undefined);
    await Promise.all([refreshSessions(true), refreshArchivedSessions(), refreshActiveSessions()]);
  }, [client, currentSessionId, isCurrentClient, refreshActiveSessions, refreshArchivedSessions, refreshSessions, setCurrentSessionId]);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      throw new Error('Enter a session title.');
    }
    await svcUpdateSessionTitle(client, sessionId, trimmed);
    await refreshSessions(true);
  }, [client, refreshSessions]);

  const forkSession = useCallback(async (sessionId: string, messageId?: string) => {
    const forked = await svcForkSession(client, sessionId, messageId);
    if (!forked) {
      throw new Error('OpenCode did not return the forked session.');
    }
    if (!isCurrentClient(client)) {
      throw new Error('The active project changed before the session was forked.');
    }
    await refreshSessions(true);
    await openSession(forked.id);
    return forked;
  }, [client, isCurrentClient, openSession, refreshSessions]);

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
    await svcExecuteCommand(client, sessionId, command, args, {
      agent: chatPreferences.mode,
      model: selected ? `${selected.providerID}/${selected.modelID}` : undefined,
    });
    await Promise.all([refreshMessages(sessionId, true), refreshSessions(true)]).catch(() => undefined);
  }, [chatPreferences.mode, chatPreferences.modelId, client, refreshMessages, refreshSessions]);

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
