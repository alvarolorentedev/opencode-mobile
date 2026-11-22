import { useLayoutEffect, useMemo, useRef } from 'react';

import { useChatCommands, useChatTranscript } from '@/features/chat/runtime';
import { useApprovalsCatalog, useSessionCatalog, useSessionState } from '@/features/sessions/runtime';
import { useConversationState } from '@/features/voice/runtime';
import { useAppCore, useAppStore, useConnectionLifecycle, useProjectScope } from '@/runtime/core';
import { idleConnection } from '@/runtime/connections/idle-connection';
import { useWorkspacePreferences } from '@/runtime/workspace/workspace-context';
import type { SendingState } from '@/shared/contracts/prompt-actions';

const IDLE: SendingState = { active: false };

export function WorkspaceConversation() {
  const scope = useProjectScope();
  return <FocusedConversation key={JSON.stringify([scope.scopeKey, scope.directory, scope.revision])} scope={scope} />;
}

function FocusedConversation({ scope }: { scope: ReturnType<typeof useProjectScope> }) {
  const { scopeKey, identity, client, directory, revision } = scope;
  const { connectionId } = identity;
  const { commands, store, voice } = useAppCore();
  const connection = useConnectionLifecycle(connectionId)?.connection ?? idleConnection.connection;
  const { chatPreferences } = useWorkspacePreferences();
  const { currentSessionId, setCurrentSessionId } = useSessionState(scopeKey);
  const { sessionStatuses } = useSessionCatalog(identity, client);
  const conversationSessionId = useAppStore((state) => state.conversation[scopeKey]?.sessionId);
  const { messagesBySession } = useChatTranscript(scope, currentSessionId, conversationSessionId);
  const pending = useApprovalsCatalog(identity, client);
  const sendingState = useAppStore((state) => state.prompt[scopeKey]?.sending ?? IDLE);
  const { sendPrompt } = useChatCommands(scope);
  const { ensureActiveSession } = useMemo(() => commands.session.navigation({ connectionId, projectPath: directory }, scopeKey, revision),
    [commands.session, connectionId, directory, revision, scopeKey]);
  const state = useConversationState({ scopeKey, connection, chatPreferences, currentSessionId, setCurrentSessionId,
    sessionStatuses, messagesBySession, ...pending, sendingState, ensureActiveSession, sendPrompt });
  const latest = useRef(state);
  useLayoutEffect(() => { latest.current = state; });
  useLayoutEffect(() => voice.attach(connectionId, scopeKey, {
    toggle: () => latest.current.toggleConversationMode(),
    pause: () => latest.current.pause(),
    clearFeedback: () => latest.current.clearConversationFeedback(),
    confirmation: {
      cancel: () => latest.current.confirmationActions.cancel(),
      confirm: (text) => latest.current.confirmationActions.confirm(text),
      edit: () => latest.current.confirmationActions.edit(),
      retry: () => latest.current.confirmationActions.retry(),
    },
  }), [connectionId, scopeKey, voice]);
  const { level } = state.conversation;
  useLayoutEffect(() => {
    store.getState().setConversationValue(scopeKey, 'level', level);
  }, [level, scopeKey, store]);
  return null;
}
