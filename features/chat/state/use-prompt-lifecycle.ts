import { useCallback, useEffect, useMemo } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';

import type { createPromptSubmissionActions, PromptCommandInput } from '../services/prompt-submission';

type PromptActions = ReturnType<typeof createPromptSubmissionActions>;

type PromptLifecycleInput = Omit<PromptCommandInput, 'readSettings'> & {
  scopeKey: string;
  settingsRef: { current: OpencodeConnectionSettings };
};

export function usePromptLifecycle({
  scopeKey, submitPrompt, client, isCurrentClient, activeProjectPath, connectionScope, sessions,
  sessionStatuses, availableAgents, currentConfig, availableModels, availableProviders, messagesBySession,
  chatPreferences, settingsRef, refreshSessions, markLocalSend, refreshSessionDiff,
  refreshSessionTodos, scheduleSessionRefresh,
}: PromptLifecycleInput) {
  const { commands } = useAppCore();
  const prompt = useAppStore((state) => state.prompt[scopeKey]) ?? { sending: { active: false } };
  const workspace = useMemo(() => commands.prompt.workspace(scopeKey), [commands, scopeKey]);
  useEffect(() => workspace.reset, [workspace]);
  const { sending: sendingState, error: promptError } = prompt;
  const readSettings = useCallback(() => settingsRef.current, [settingsRef]);
  const actions = useCallback(() => workspace.actions({
    submitPrompt, client, isCurrentClient, activeProjectPath, connectionScope, sessions, availableAgents,
    currentConfig, availableModels, availableProviders, messagesBySession, sessionStatuses, chatPreferences, readSettings,
    refreshSessions, markLocalSend, refreshSessionDiff, refreshSessionTodos, scheduleSessionRefresh,
  }), [activeProjectPath, availableAgents, availableModels, availableProviders, chatPreferences, client, connectionScope,
    currentConfig, isCurrentClient, markLocalSend, messagesBySession, readSettings, refreshSessionDiff, refreshSessionTodos,
    refreshSessions, scheduleSessionRefresh, sessions, sessionStatuses, submitPrompt, workspace]);
  const sendPrompt = useCallback<PromptActions['sendPrompt']>((...args) => actions().sendPrompt(...args), [actions]);
  const abortSession = useCallback<PromptActions['abortSession']>((...args) => actions().abortSession(...args), [actions]);
  const switchSessionModel = useCallback<PromptActions['switchSessionModel']>((...args) => actions().switchSessionModel(...args), [actions]);

  useEffect(() => {
    const controller = new AbortController();
    void workspace.reconcileSettlement({ client, isCurrentClient, activeProjectPath, connectionScope, sessions, sessionStatuses }, controller.signal)
      .catch((reason) => console.warn('Could not complete task notification.', reason));
    return () => controller.abort();
  }, [activeProjectPath, client, connectionScope, isCurrentClient, sendingState.active, sendingState.sessionId, sessionStatuses, sessions, workspace]);

  return {
    sendPrompt, abortSession, switchSessionModel, sendingState, promptError, clearPromptError: workspace.clearPromptError,
    resetPrompt: workspace.reset, setPromptError: workspace.setPromptError,
  };
}
