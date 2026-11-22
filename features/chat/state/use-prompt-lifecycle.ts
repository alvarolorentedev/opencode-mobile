import { useCallback, useEffect, useMemo } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { ProviderOption } from '@/features/ai/index';
import { usePromptRouting } from '@/features/ai/runtime';
import { clearPendingTaskFinishedNotification, listPendingTaskFinishedNotifications, notifyTaskFinished, pendingNotificationKey } from '@/features/notifications/runtime';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import type { SessionStatus } from '@/shared/protocol/opencode/types';
import { readSessionSettlement } from '@/shared/protocol/services/session-service';

import type { createPromptSubmissionActions, PromptCommandInput } from '../services/prompt-submission';

type PromptActions = ReturnType<typeof createPromptSubmissionActions>;

type PromptLifecycleInput = Omit<PromptCommandInput, 'routePrompt' | 'busyNotifications' | 'readSettings'> & {
  scopeKey: string;
  availableProviders: ProviderOption[];
  sessionStatuses: Record<string, SessionStatus>;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  busyNotificationsRef: { current: Set<string> };
  settingsRef: { current: OpencodeConnectionSettings };
};

export function usePromptLifecycle({
  scopeKey, submitPrompt, client, isCurrentClient, activeProjectPath, connectionScope, sessions,
  sessionStatuses, availableAgents, currentConfig, availableModels, availableProviders, messagesBySession,
  chatPreferences, settingsRef, busyNotificationsRef, refreshSessions, markLocalSend, refreshSessionDiff,
  refreshSessionTodos, scheduleSessionRefresh,
}: PromptLifecycleInput) {
  const { commands } = useAppCore();
  const prompt = useAppStore((state) => state.prompt[scopeKey]) ?? { sending: { active: false } };
  const workspace = useMemo(() => commands.prompt.workspace(scopeKey), [commands, scopeKey]);
  useEffect(() => workspace.dispose, [workspace]);
  const { sending: sendingState, error: promptError } = prompt;
  const routePrompt = usePromptRouting({
    client, isCurrentClient, availableModels, availableProviders, availableAgents, currentConfig,
    chatPreferences, sessions, sessionStatuses, messagesBySession,
  });
  const readSettings = useCallback(() => settingsRef.current, [settingsRef]);
  const busyNotifications = useCallback(() => busyNotificationsRef.current, [busyNotificationsRef]);
  const actions = useCallback(() => workspace.actions({
    submitPrompt, client, isCurrentClient, activeProjectPath, connectionScope, sessions, availableAgents,
    currentConfig, availableModels, chatPreferences, readSettings, busyNotifications,
    routePrompt, refreshSessions, markLocalSend, refreshSessionDiff, refreshSessionTodos, scheduleSessionRefresh,
  }), [activeProjectPath, availableAgents, availableModels, busyNotifications, chatPreferences, client, connectionScope,
    currentConfig, isCurrentClient, markLocalSend, refreshSessionDiff, refreshSessionTodos, refreshSessions, routePrompt,
    readSettings, scheduleSessionRefresh, sessions, submitPrompt, workspace]);
  const sendPrompt = useCallback<PromptActions['sendPrompt']>((...args) => actions().sendPrompt(...args), [actions]);
  const abortSession = useCallback<PromptActions['abortSession']>((...args) => actions().abortSession(...args), [actions]);
  const switchSessionModel = useCallback<PromptActions['switchSessionModel']>((...args) => actions().switchSessionModel(...args), [actions]);

  useEffect(() => {
    let cancelled = false;

    async function flushCompletedNotifications() {
      const pendingEntries = await listPendingTaskFinishedNotifications(connectionScope);
      if (cancelled || pendingEntries.length === 0) {
        return;
      }

      for (const pending of pendingEntries) {
        const { sessionId } = pending;
        const key = pendingNotificationKey(pending.connectionScope, sessionId);
        // A record for another project cannot be confirmed from this project's
        // session list; keep it for the background monitor or a later return to
        // that project instead of dropping a completion silently.
        if (pending.projectPath !== activeProjectPath) {
          continue;
        }
        const status = sessionStatuses[sessionId];
        // Latch once the session has actually started working so an early
        // completion notifies without waiting out the debounce below.
        if (status && status.type !== 'idle') {
          busyNotificationsRef.current.add(key);
          continue;
        }

        const session = sessions.find((item) => item.id === sessionId);
        // A deleted or not-yet-loaded session is not proof of completion. The
        // background monitor drops genuinely deleted records.
        if (!session) {
          continue;
        }

        const oldEnough = Date.now() - pending.requestedAt >= 5000;
        const latched = busyNotificationsRef.current.has(key);
        if ((!latched && !oldEnough) || (sendingState.active && sendingState.sessionId === sessionId)) {
          continue;
        }

        // Confirm against the server before notifying. When this app session
        // already observed the task running, the known idle status is enough to
        // skip the extra status read; otherwise (for example a cold start from a
        // persisted record) the settlement read verifies the server instead of
        // trusting a cached idle status.
        const settlement = await readSessionSettlement(client, sessionId, latched ? status : undefined, pending.requestedAt);
        if (cancelled) {
          return;
        }
        if (settlement.state === 'running' || settlement.state === 'retrying'
          || settlement.state === 'blocked' || settlement.state === 'unknown') {
          continue;
        }
        if (settlement.state === 'aborted') {
          busyNotificationsRef.current.delete(key);
          await clearPendingTaskFinishedNotification(connectionScope, sessionId, pending.requestedAt);
          continue;
        }

        const cleared = await clearPendingTaskFinishedNotification(connectionScope, sessionId, pending.requestedAt);
        if (cancelled) {
          return;
        }

        busyNotificationsRef.current.delete(key);
        if (cleared) {
          await notifyTaskFinished({
            sessionId,
            sessionTitle: session.title,
            projectPath: pending.projectPath,
            connectionScope,
            outcome: settlement.state === 'failed' ? 'failed' : 'finished',
          });
        }
      }
    }

    void flushCompletedNotifications().catch((reason) => console.warn('Could not complete task notification.', reason));

    return () => {
      cancelled = true;
    };
  }, [activeProjectPath, busyNotificationsRef, client, connectionScope, sendingState.active, sendingState.sessionId, sessionStatuses, sessions]);


  return { sendPrompt, abortSession, switchSessionModel, sendingState, promptError, clearPromptError: workspace.clearPromptError,
    setSendingState: workspace.setSendingState, setPromptError: workspace.setPromptError };
}
