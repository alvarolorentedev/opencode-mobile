import { compactSession as svcCompactSession, deleteSession as svcDeleteSession, executeCommand as svcExecuteCommand, executeShell as svcExecuteShell, generateSessionText as svcGenerateSessionText, interruptSession as svcInterruptSession, revertSession as svcRevertSession, unrevertSession as svcUnrevertSession, updateSessionTitle as svcUpdateSessionTitle, waitForSessionIdle as svcWaitForSessionIdle } from '@/shared/protocol/services/session-service';
import { useCallback } from 'react';

import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import { i18n } from '@/shared/i18n/index';
import { buildSideQuestionPrompt, isBuiltinSessionCommand, type SideQuestionAnswer } from '@/shared/contracts/session-commands';
import { getInitialMode } from '@/features/ai/runtime';
import type { SessionCrudInput } from '@/features/sessions/model/action-inputs';
import type { CommandOptions } from '@/shared/protocol/opencode/prompt-inbox';

export function useSessionCrudActions({
  client,
  isCurrentClient,
  connectionScopeRef,
  currentSessionId,
  explicitSessionSelectionRef,
  forgetSessionCreation,
  availableAgents,
  commands,
  currentConfig,
  sessions,
  sessionStatuses,
  setCurrentSessionId,
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
  refreshActiveSessions,
  chatPreferences,
}: SessionCrudInput) {
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
      forgetSessionCreation(sessionId);
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      setSessionStatuses((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      if (currentSessionId === sessionId) {
        explicitSessionSelectionRef.current = undefined;
        setCurrentSessionId(undefined);
      }
      void refreshActiveSessions().catch(() => undefined);
    },
    [client, connectionScopeRef, currentSessionId, explicitSessionSelectionRef, isCurrentClient, forgetSessionCreation, refreshActiveSessions, setCurrentSessionId, setDiffsBySession, setFavoriteSessions, setMessagesBySession, setPendingPermissionsBySession, setPendingQuestionsBySession, setSessionStatuses, setSessions, setTodosBySession],
  );

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      throw new Error('Enter a session title.');
    }
    const previousTitle = sessions.find((session) => session.id === sessionId)?.title;
    // Rename is safe to echo locally; the server response is still required and
    // a rejection restores the previous title.
    setSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, title: trimmed } : session
    )));
    try {
      await svcUpdateSessionTitle(client, sessionId, trimmed);
      if (!isCurrentClient(client)) return;
    } catch (error) {
      if (isCurrentClient(client)) {
        setSessions((current) => current.map((session) => (
          session.id === sessionId && previousTitle !== undefined ? { ...session, title: previousTitle } : session
        )));
      }
      throw error;
    }
  }, [client, isCurrentClient, setSessions]);

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

  const executeCommand = useCallback(async (sessionId: string, command: string, args: string, input?: Pick<CommandOptions, 'attachments' | 'context'>): Promise<SideQuestionAnswer | void> => {
    if (!isCurrentClient(client)) throw new Error(i18n.t('chat:composer.noEligibleAgent'));
    // Client built-ins are not in the server catalog. Intercept them before
    // agent/model resolution so they never reach session.command.
    if (client.__opencode?.contract === 'v2' && isBuiltinSessionCommand(command) && !commands.some((item) => item.name === command)) {
      if (input?.attachments?.length) throw new Error(i18n.t('chat:composer.builtinAttachmentsUnsupported'));
      if (command === 'compact') {
        await svcCompactSession(client, sessionId);
        await Promise.all([refreshMessages(sessionId, true, { mode: 'replace' }), refreshSessions()]).catch(() => undefined);
        return;
      }
      const question = args.trim();
      if (!question) throw new Error(i18n.t('chat:composer.sideQuestionEmpty'));
      const answer = await svcGenerateSessionText(client, sessionId, buildSideQuestionPrompt(question));
      return { question, answer };
    }
    const agent = getInitialMode(availableAgents, currentConfig, chatPreferences.mode);
    if (!agent) throw new Error(i18n.t('chat:composer.noEligibleAgent'));
    await svcExecuteCommand(client, sessionId, command, args, {
      ...input,
      agent,
    });
    await Promise.all([refreshMessages(sessionId, true), refreshSessions()]).catch(() => undefined);
  }, [availableAgents, commands, currentConfig, isCurrentClient, chatPreferences.mode, client, refreshMessages, refreshSessions]);

  const executeShell = useCallback(async (sessionId: string, command: string) => {
    await svcExecuteShell(client, sessionId, command);
    await Promise.all([refreshMessages(sessionId, true), refreshSessions()]).catch(() => undefined);
  }, [client, refreshMessages, refreshSessions]);

  return {
      deleteSession,
    renameSession,
    revertSession,
    unrevertSession,
    executeCommand,
    executeShell,
  };
}
