import { useLayoutEffect, useMemo, useRef } from 'react';

import { getConnectionScope } from '@/shared/contracts/connection-scope';
import type { ServerContract } from '@/shared/protocol/opencode/client';

import type { SessionRefreshOptions } from '@/shared/protocol/opencode/event-dispatch';
import type { ConnectionState } from '@/shared/contracts/domain';

import type { WorkspaceRuntimeInput } from '@/runtime/workspace/workspace-types';

import { useProjectRuntimeState } from '@/features/projects/runtime';
import { useSessionState } from '@/features/sessions/runtime';
import { useChatRuntimeState } from '@/features/chat/runtime';
import { useExtensionPromptState } from '@/features/extensions/runtime';
export function useSessionRuntimeState(input: WorkspaceRuntimeInput, connection: ConnectionState, serverContract: ServerContract) {
  const settings = input.connection.settings;
  const setSettings = input.setSettings;
  const chatPreferences = input.preferences;
  const { activeProjectPath, setActiveProjectPath, activeProjectPathRef, projectFileRequestRef } = useProjectRuntimeState(input.projectPath);
  const { sessions, setSessions, sessionsRef, sessionStatuses, setSessionStatuses, currentSessionId, setCurrentSessionId, pendingPermissionsBySession, setPendingPermissionsBySession, pendingQuestionsBySession, setPendingQuestionsBySession, isBootstrappingChat, setIsBootstrappingChat, activeSessionsVisible, setActiveSessionsVisible, currentSessionIdRef, pendingDeepLinkTargetRef, deepLinkOperationRef, bootstrapPromiseRef, bootstrapTokenRef, explicitSessionSelectionRef, locallyCreatedSessionsRef, suppressedPendingRequestIdsRef } = useSessionState();
  const { messagesBySession, setMessagesBySession, diffsBySession, setDiffsBySession, vcsDiffsByScope, setVcsDiffsByScope, diffScopeBySession, setDiffScopeBySession, selectedDiffMessageBySession, setSelectedDiffMessageBySession, todosBySession, setTodosBySession, isRefreshingMessages, setIsRefreshingMessages, isRefreshingDiffs, setIsRefreshingDiffs, diffScopeBySessionRef, selectedDiffMessageBySessionRef, messagesBySessionRef, busyNotificationsRef, promptSubmissionRef } = useChatRuntimeState();
  const { mcpAuthPrompt, setMcpAuthPrompt } = useExtensionPromptState();

  const connectionScope = useMemo(
    () => getConnectionScope({ serverUrl: settings.serverUrl, username: settings.username }),
    [settings.serverUrl, settings.username],
  );

  const settingsRef = useRef(settings);
  const chatPreferencesRef = useRef(chatPreferences);
  const connectionScopeRef = useRef(connectionScope);
  const connectionRef = useRef(connection);
  const serverContractRef = useRef<ServerContract>('v2');
  const scopeGenerationRef = useRef(0);
  const serverGenerationRef = useRef(0);
  const clientGenerationRef = useRef(new WeakMap<object, number>());
  const sessionRefreshTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sessionRefreshOptionsRef = useRef<Record<string, SessionRefreshOptions>>({});

  // Latest-ref mirror. Updating refs in a layout effect (instead of during
  // render) is the React-sanctioned pattern: the mirrored values are only read
  // from callbacks, async work, and effects, all of which run after commit.
  useLayoutEffect(() => {
    serverContractRef.current = serverContract;
    settingsRef.current = settings;
    chatPreferencesRef.current = chatPreferences;
    connectionScopeRef.current = connectionScope;
    activeProjectPathRef.current = activeProjectPath;
    connectionRef.current = connection;
    currentSessionIdRef.current = currentSessionId;
    sessionsRef.current = sessions;
    diffScopeBySessionRef.current = diffScopeBySession;
    selectedDiffMessageBySessionRef.current = selectedDiffMessageBySession;
    messagesBySessionRef.current = messagesBySession;
  });

  return {
    settings, setSettings,
    connection,
    serverContract,
    activeProjectPath, setActiveProjectPath,
    sessions, setSessions, sessionsRef,
    sessionStatuses, setSessionStatuses,
    currentSessionId, setCurrentSessionId,
    messagesBySession, setMessagesBySession,
    diffsBySession, setDiffsBySession,
    vcsDiffsByScope, setVcsDiffsByScope,
    diffScopeBySession, setDiffScopeBySession,
    selectedDiffMessageBySession, setSelectedDiffMessageBySession,
    todosBySession, setTodosBySession,
    pendingPermissionsBySession, setPendingPermissionsBySession,
    pendingQuestionsBySession, setPendingQuestionsBySession,
    mcpAuthPrompt, setMcpAuthPrompt,
    isRefreshingMessages, setIsRefreshingMessages,
    isRefreshingDiffs, setIsRefreshingDiffs,
    isBootstrappingChat, setIsBootstrappingChat,
    activeSessionsVisible, setActiveSessionsVisible,
    connectionScope,
    settingsRef,
    chatPreferencesRef,
    connectionScopeRef,
    activeProjectPathRef,
    connectionRef,
    serverContractRef,
    currentSessionIdRef,
    pendingDeepLinkTargetRef,
    deepLinkOperationRef,
    scopeGenerationRef,
    serverGenerationRef,
    clientGenerationRef,
    bootstrapPromiseRef,
    bootstrapTokenRef,
    sessionRefreshTimeoutsRef,
    sessionRefreshOptionsRef,
    diffScopeBySessionRef,
    selectedDiffMessageBySessionRef,
    messagesBySessionRef,
    busyNotificationsRef,
    explicitSessionSelectionRef,
    locallyCreatedSessionsRef,
    suppressedPendingRequestIdsRef,
    promptSubmissionRef,
    projectFileRequestRef,
  };
}

export type SessionRuntimeState = ReturnType<typeof useSessionRuntimeState>;
