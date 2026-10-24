import { emptySharedInput } from '@/providers/use-share-state';
import type { OpencodeEvent } from '@/lib/opencode/events';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { buildClient, getRequestHeaders } from '@/lib/opencode/client';
import { buildOpencodeProjects, resolveActiveProject } from '@/providers/opencode-provider-utils';
import {
  CURRENT_ONBOARDING_VERSION,
  isOnboardingComplete,
} from '@/providers/onboarding-state';
import { useOpencodeRealtime } from '@/providers/use-opencode-realtime';
import { useConversationState } from '@/providers/use-conversation-state';
import { useActiveSessions } from '@/providers/use-active-sessions';
import { useActivityNotifications } from '@/providers/use-activity-notifications';
import { usePermissionRulesState } from '@/providers/use-permission-rules-state';
import { useTranscriptState } from '@/providers/use-transcript-state';
import { useMcpState } from '@/providers/use-mcp-state';
import { useTerminalState } from '@/providers/use-terminal-state';
import { useWorktreeState } from '@/providers/use-worktree-state';
import { handleProviderEvent, type ProviderEventActions } from '@/providers/opencode-provider-events';
import { useWorkspaceRuntimeState } from '@/providers/use-workspace-runtime-state';
import { useOpencodeProviderEffects } from '@/providers/use-opencode-provider-effects';
import { useProjectActions } from '@/providers/use-project-actions';
import { useCapabilitiesActions } from '@/providers/use-capabilities-actions';
import { useSessionActions } from '@/providers/use-session-actions';
import { usePromptInbox } from '@/providers/use-prompt-inbox';
import { usePromptLifecycle } from '@/providers/use-prompt-lifecycle';
import { useConnectionActions } from '@/providers/use-connection-actions';
import { useConnectionRetry } from '@/providers/use-connection-retry';
import { useNetworkStatus } from '@/providers/use-network-status';
import { useOpencodeProviderValues } from '@/providers/opencode-provider-values';
import { useCoalescedRefresh } from '@/providers/use-coalesced-refresh';

import type { WorkspaceRuntimeInput } from '@/providers/workspace-types';

export function useOpencodeProviderComposition(input: WorkspaceRuntimeInput) {
  const state = useWorkspaceRuntimeState(input);
  const network = useNetworkStatus();
  const isHydrated = input.isHydrated && input.connection.enabled;
  const {
    setConnection,
    initialConnectStartedRef,
    setOnboardingVersion,
    setOnboardingActive,
    currentSessionIdRef,
    explicitSessionSelectionRef,
    locallyCreatedSessionsRef,
    setCurrentSessionId,
    setSessions,
    setArchivedSessions,
    setSessionStatuses,
    setCommands,
    setCurrentConfig,
    setAvailableProviders,
    setProviderAuthMethodsById,
    setAvailableModels,
    setAvailableAgents,
    setPendingPermissionsBySession,
    setPendingQuestionsBySession,
    setSavedPermissions,
    setMcpAuthPrompt,
    setProjectFileStatuses,
    setSelectedProjectFile,
    setVcsInfo,
    bootstrapPromiseRef,
    bootstrapTokenRef,
    busyNotificationsRef,
    suppressedPendingRequestIdsRef,
    sessionRefreshTimeoutsRef,
    sessionRefreshOptionsRef,
    clientGenerationRef,
    catalogGenerationRef,
    scopeGenerationRef,
    serverGenerationRef,
  } = state;

  const refreshProjectCatalogRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);
  const refreshChatCapabilitiesRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshProjectCatalogLatest = useCallback((silent?: boolean) => refreshProjectCatalogRef.current(silent), []);
  const refreshChatCapabilitiesLatest = useCallback(() => refreshChatCapabilitiesRef.current(), []);

  const onboardingCompleted = isOnboardingComplete(state.onboardingVersion);

  const completeOnboarding = useCallback(async () => {
    setOnboardingVersion(CURRENT_ONBOARDING_VERSION);
    setOnboardingActive(false);
  }, [setOnboardingActive, setOnboardingVersion]);

  const startOnboardingReview = useCallback(() => {
    setOnboardingActive(true);
  }, [setOnboardingActive]);

  const stopOnboardingReview = useCallback(() => {
    setOnboardingActive(false);
  }, [setOnboardingActive]);

  const dismissMcpAuth = useCallback(() => {
    setMcpAuthPrompt(undefined);
  }, [setMcpAuthPrompt]);

  const projects = useMemo(
    () => buildOpencodeProjects(state.projectPathsByConnection[state.connectionScope] ?? [], state.currentProjectPath, state.serverProjects),
    [state.connectionScope, state.currentProjectPath, state.projectPathsByConnection, state.serverProjects],
  );

  const client = useMemo(
    () => buildClient({ ...state.settings, directory: state.activeProjectPath || '' }, state.serverContract),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect needs fresh clients so old in-flight requests stay invalid.
    [state.activeProjectPath, state.serverContract, state.settings, input.connection.enabled],
  );
  const catalogClient = useMemo(() => buildClient({ ...state.settings, directory: '' }, state.serverContract),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect invalidates the previous catalog client too.
    [state.serverContract, state.settings, input.connection.enabled]);
  // Tag each client instance with the generation current when it is first seen.
  // A layout effect keeps this off the render path while still running before
  // any callback that could consume `isCurrentClient`.
  useLayoutEffect(() => {
    if (!clientGenerationRef.current.has(client)) {
      clientGenerationRef.current.set(client, scopeGenerationRef.current);
    }
    if (!catalogGenerationRef.current.has(catalogClient)) {
      catalogGenerationRef.current.set(catalogClient, serverGenerationRef.current);
    }
  });
  const isCurrentClient = useCallback(
    (candidate: object) => input.connection.enabled && clientGenerationRef.current.get(candidate) === scopeGenerationRef.current,
    [clientGenerationRef, scopeGenerationRef, input.connection.enabled],
  );
  const isCurrentCatalogClient = useCallback(
    (candidate: object) => input.connection.enabled && catalogGenerationRef.current.get(candidate) === serverGenerationRef.current,
    [catalogGenerationRef, serverGenerationRef, input.connection.enabled],
  );

  const transcript = useTranscriptState({ ...state, client, isCurrentClient });
  const inbox = usePromptInbox({
    client,
    isCurrentClient,
    refreshMessages: transcript.refreshMessages,
    connected: state.connection.status === 'connected',
    online: network.online,
  });
  // Memoized so the terminal reconnect effect only runs when headers actually
  // change, not on every render (getRequestHeaders returns a new object).
  const terminalHeaders = useMemo(() => getRequestHeaders(state.settings), [state.settings]);
  const terminal = useTerminalState({
    enabled: input.connection.enabled,
    ...state,
    client,
    directory: state.activeProjectPath || '',
    isCurrentClient,
    serverUrl: state.settings.serverUrl,
    headers: terminalHeaders,
    online: network.online,
  });
  const worktree = useWorktreeState({ ...state, client, isCurrentClient, refreshProjectCatalog: refreshProjectCatalogLatest });
  const activeProject = useMemo(
    () => resolveActiveProject(projects, state.activeProjectPath, state.currentProjectPath, worktree.worktrees) ?? (state.activeProjectPath
      ? { path: state.activeProjectPath, label: state.activeProjectPath.split('/').filter(Boolean).pop() || state.activeProjectPath, source: 'server' as const, isCurrent: false } : undefined),
    [projects, state.activeProjectPath, state.currentProjectPath, worktree.worktrees],
  );
  const mcp = useMcpState({ ...state, client, isCurrentClient, refreshChatCapabilities: refreshChatCapabilitiesLatest });
  const permissionRules = usePermissionRulesState({ client, isCurrentClient, setSavedPermissions });

  // Clear the MCP auth alert once the named server reports connected. Doing this
  // here keeps `mcpStatuses` out of the approvals value's dependencies, so
  // approval consumers do not re-render on MCP status changes.
  useEffect(() => {
    if (state.mcpAuthPrompt && mcp.mcpStatuses[state.mcpAuthPrompt.mcpName]?.status === 'connected') {
      setMcpAuthPrompt(undefined);
    }
  }, [mcp.mcpStatuses, setMcpAuthPrompt, state.mcpAuthPrompt]);
  const activeSessionsHook = useActiveSessions({
    catalogClient,
    isCurrentCatalogClient,
    connectionScope: state.connectionScope,
    connected: state.connection.status === 'connected',
    currentSessionId: state.currentSessionId,
    hideSubagentChats: state.chatPreferences.hideSubagentChats === true,
    visible: state.activeSessionsVisible,
  });

  const streamConnectedRef = useRef(false);
  const { resetMcpState } = mcp;
  const { resetPermissionRules } = permissionRules;
  const { resetTerminal } = terminal;
  const { reset: resetTranscript } = transcript;
  const { resetWorktrees } = worktree;
  const clearProjectState = useCallback(() => {
    bootstrapPromiseRef.current = null;
    bootstrapTokenRef.current = undefined;
    busyNotificationsRef.current.clear();
    suppressedPendingRequestIdsRef.current.clear();
    Object.values(sessionRefreshTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
    sessionRefreshTimeoutsRef.current = {};
    sessionRefreshOptionsRef.current = {};
    currentSessionIdRef.current = undefined;
    explicitSessionSelectionRef.current = undefined;
    locallyCreatedSessionsRef.current.clear();
    setCurrentSessionId(undefined);
    setSessions([]);
    setArchivedSessions([]);
    setSessionStatuses({});
    resetTranscript();
    setCommands([]);
    setCurrentConfig(undefined);
    setAvailableProviders([]);
    setProviderAuthMethodsById({});
    setAvailableModels([]);
    setAvailableAgents([]);
    setPendingPermissionsBySession({});
    setPendingQuestionsBySession({});
    setMcpAuthPrompt(undefined);
    resetPermissionRules();
    setProjectFileStatuses([]);
    setSelectedProjectFile(undefined);
    setVcsInfo(undefined);
    resetMcpState();
    resetTerminal();
    resetWorktrees();
  }, [resetMcpState, resetPermissionRules, resetTerminal, resetTranscript, resetWorktrees, bootstrapPromiseRef, bootstrapTokenRef, busyNotificationsRef, suppressedPendingRequestIdsRef, sessionRefreshOptionsRef, sessionRefreshTimeoutsRef, currentSessionIdRef, explicitSessionSelectionRef, locallyCreatedSessionsRef, setArchivedSessions, setAvailableAgents, setAvailableModels, setAvailableProviders, setCommands, setCurrentConfig, setCurrentSessionId, setMcpAuthPrompt, setPendingPermissionsBySession, setPendingQuestionsBySession, setProviderAuthMethodsById, setSelectedProjectFile, setSessionStatuses, setSessions, setVcsInfo, setProjectFileStatuses]);

  const softResetProjectState = useCallback(() => {
    // Same-machine credential rotation: keep server-derived data (still valid
    // for the same server) but drop in-flight bookkeeping bound to the old
    // client so a new bootstrap can start.
    bootstrapPromiseRef.current = null;
    bootstrapTokenRef.current = undefined;
    Object.values(sessionRefreshTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
    sessionRefreshTimeoutsRef.current = {};
    sessionRefreshOptionsRef.current = {};
  }, [bootstrapPromiseRef, bootstrapTokenRef, sessionRefreshOptionsRef, sessionRefreshTimeoutsRef]);

  const project = useProjectActions({ ...state, client, catalogClient, isCurrentClient, isCurrentCatalogClient, clearProjectState, isHydrated, refreshMessages: inbox.refreshMessages });

  const capabilities = useCapabilitiesActions({ ...state, client, isCurrentClient });
  // Event bursts (rename + update, config fan-out, file-save VCS events) share
  // one refresh instead of starting overlapping reads.
  const scheduleSessionsRefresh = useCoalescedRefresh(() => project.refreshSessions(true), 150);
  const scheduleChatCapabilitiesRefresh = useCoalescedRefresh(capabilities.refreshChatCapabilities, 250);
  const scheduleServerFeaturesRefresh = useCoalescedRefresh(project.refreshServerFeatures, 250);
  const scheduleProjectCatalogRefresh = useCoalescedRefresh(() => project.refreshProjectCatalog(true), 250);

  const sessionActions = useSessionActions({
    ...state,
    ...project,
    ...permissionRules,
    client,
    catalogClient,
    isCurrentClient,
    isCurrentCatalogClient,
    refreshMessages: inbox.refreshMessages,
    refreshActiveSessions: activeSessionsHook.refreshActiveSessions,
    refreshChatCapabilities: capabilities.refreshChatCapabilities,
    beginHydration: transcript.beginHydration,
  });
  const ensureActiveSessionRef = useRef(sessionActions.ensureActiveSession);

  const prompt = usePromptLifecycle({
    submitPrompt: inbox.submitPrompt,
    ...state,
    ...project,
    client,
    isCurrentClient,
    refreshMessages: inbox.refreshMessages,
    summarizeSessionTitle: sessionActions.summarizeSessionTitle,
  });

  const connectionActions = useConnectionActions({
    ...state,
    ...project,
    ...sessionActions,
    ...prompt,
    isCurrentCatalogClient,
    ensureActiveSessionRef,
    clearProjectState,
    softResetProjectState,
    isHydrated,
    refreshActiveSessions: activeSessionsHook.refreshActiveSessions,
  }, input);
  const reconnect = useConnectionRetry({
    active: input.visible,
    // Cloud Link activation owns its own startup budget and delayed retry.
    // A generic reconnect here would add attempts the user never requested.
    paused: Boolean(state.settings.connect),
    status: state.connection.status,
    kind: 'kind' in state.connection ? state.connection.kind : undefined,
    online: network.online,
    connect: connectionActions.connect,
  });

  const { conversation, clearConversationFeedback, toggleConversationMode } = useConversationState({
    connection: state.connection,
    chatPreferences: state.chatPreferences,
    currentSessionId: state.currentSessionId,
    setCurrentSessionId: state.setCurrentSessionId,
    sessionStatuses: state.sessionStatuses,
    messagesBySession: state.messagesBySession,
    pendingPermissionsBySession: state.pendingPermissionsBySession,
    pendingQuestionsBySession: state.pendingQuestionsBySession,
    sendingState: prompt.sendingState,
    ensureActiveSession: sessionActions.ensureActiveSession,
    sendPrompt: prompt.sendPrompt,
  });
  const { phase: conversationPhase, sessionId: conversationSessionId } = conversation;

  const eventActionsRef = useRef<ProviderEventActions | null>(null);

  // Latest-ref bridges for callbacks defined before the actions they forward to.
  // Written in a layout effect so no ref is touched during render; all readers
  // are event handlers, realtime callbacks, or passive effects that run later.
  useLayoutEffect(() => {
    refreshProjectCatalogRef.current = project.refreshProjectCatalog;
    refreshChatCapabilitiesRef.current = capabilities.refreshChatCapabilities;
    ensureActiveSessionRef.current = sessionActions.ensureActiveSession;
    const focusSessionIds = new Set<string>();
    if (state.currentSessionId) focusSessionIds.add(state.currentSessionId);
    if (conversationSessionId) focusSessionIds.add(conversationSessionId);
    for (const [sessionId, prompts] of Object.entries(inbox.pendingPromptsBySession)) {
      if (prompts.length > 0) focusSessionIds.add(sessionId);
    }
    eventActionsRef.current = {
      refreshSessions: project.refreshSessions,
      refreshArchivedSessions: sessionActions.refreshArchivedSessions,
      scheduleSessionRefresh: project.scheduleSessionRefresh,
      scheduleSessionsRefresh,
      scheduleServerFeaturesRefresh,
      scheduleChatCapabilitiesRefresh,
      scheduleProjectCatalogRefresh,
      refreshPendingInteractions: project.refreshPendingInteractions,
      refreshServerFeatures: project.refreshServerFeatures,
      refreshChatCapabilities: capabilities.refreshChatCapabilities,
      refreshProjectCatalog: project.refreshProjectCatalog,
      refreshTerminals: terminal.refreshTerminals,
      refreshWorktrees: worktree.refreshWorktrees,
      refreshMcpServers: mcp.refreshMcpServers,
      refreshDiagnostics: project.refreshDiagnostics,
      focusSessionIds,
      setSessions: state.setSessions,
      removeCatalogSession: activeSessionsHook.removeSession,
      setSessionStatuses: state.setSessionStatuses,
      explicitSessionSelectionRef: state.explicitSessionSelectionRef,
      setPromptError: prompt.setPromptError,
      setDiffsBySession: state.setDiffsBySession,
      setTodosBySession: state.setTodosBySession,
      setPendingPermissionsBySession: state.setPendingPermissionsBySession,
      setPendingQuestionsBySession: state.setPendingQuestionsBySession,
      setMcpAuthPrompt: state.setMcpAuthPrompt,
      selectedDiffMessageBySessionRef: state.selectedDiffMessageBySessionRef,
    };
  });
  const handleEvent = useCallback((event: OpencodeEvent) => {
    if (eventActionsRef.current) {
      handleProviderEvent(event, eventActionsRef.current);
    }
  }, []);

  const handleActivityEvent = useActivityNotifications({
    catalogClient, settings: state.settings, contract: state.serverContract,
    connectionScope: state.connectionScope, connected: input.isConnectionOwner && state.connection.status === 'connected',
    currentSessionId: input.visible ? state.currentSessionId : undefined, sessions: state.sessions, sendingState: prompt.sendingState, promptError: prompt.promptError,
    streamConnectedRef,
  });

  const { eventStreamStatus } = useOpencodeRealtime({
    catalogClient,
    subscribe: input.connection.events,
    activeProjectPath: state.activeProjectPath,
    connected: state.connection.status === 'connected',
    online: network.online,
    constrained: network.constrained,
    pendingSessionIds: Object.keys(inbox.pendingPromptsBySession).filter((id) => inbox.pendingPromptsBySession[id].length > 0),
    busy: Object.values(inbox.pendingPromptsBySession).some((prompts) => prompts.length > 0) || prompt.sendingState.active || conversationPhase !== 'off' || Object.values(state.sessionStatuses).some((status) => status.type !== 'idle'),
    currentSessionId: state.currentSessionId,
    conversationSessionId,
    onEvent: handleEvent,
    onGlobalEvent: handleActivityEvent,
    onFatalError: connectionActions.handleStreamAuthFailure,
    refreshSessions: project.refreshSessions,
    refreshSessionStatuses: project.refreshSessionStatuses,
    refreshPendingInteractions: project.refreshPendingInteractions,
    refreshMessages: inbox.refreshMessages,
    refreshSessionDiff: project.refreshSessionDiff,
    refreshSessionTodos: project.refreshSessionTodos,
  });

  useLayoutEffect(() => {
    streamConnectedRef.current = eventStreamStatus === 'connected';
  });

  useOpencodeProviderEffects({
    active: input.visible,
    ...state,
    client,
    catalogClient,
    isCurrentClient,
    isHydrated,
    onboardingCompleted,
    connect: connectionActions.connect,
    refreshActiveSessions: activeSessionsHook.refreshActiveSessions,
    refreshWorktrees: worktree.refreshWorktrees,
    refreshMcpServers: mcp.refreshMcpServers,
    refreshTerminals: terminal.refreshTerminals,
    refreshArchivedSessions: sessionActions.refreshArchivedSessions,
    ensureActiveSessionRef,
    setPromptError: prompt.setPromptError,
    conversationPhase,
    conversationSessionId,
    sendingState: prompt.sendingState,
    pruneTranscript: transcript.prune,
  });

  const values = useOpencodeProviderValues({
    ...state,
    ...transcript,
    ...permissionRules,
    mcpAuthPrompt: state.mcpAuthPrompt,
    dismissMcpAuth,
    pendingPromptsBySession: inbox.pendingPromptsBySession,
    cancelPrompt: inbox.cancelPrompt,
    ...terminal,
    ...worktree,
    ...mcp,
    ...project,
    ...sessionActions,
    ...capabilities,
    ...prompt,
    ...connectionActions,
    activeSessions: activeSessionsHook.activeSessions,
    refreshActiveSessions: activeSessionsHook.refreshActiveSessions,
    conversation,
    clearConversationFeedback,
    toggleConversationMode,
    isHydrated: input.isHydrated,
    onboardingCompleted,
    onboardingActive: state.onboardingActive,
    completeOnboarding,
    startOnboardingReview,
    stopOnboardingReview,
    projects,
    activeProject,
    eventStreamStatus,
    network,
    reconnect,
    sharedInput: emptySharedInput,
  });

  const suspend = useCallback(() => {
    scopeGenerationRef.current++; serverGenerationRef.current++; initialConnectStartedRef.current = false;
    for (const timeout of Object.values(sessionRefreshTimeoutsRef.current)) clearTimeout(timeout);
    sessionRefreshTimeoutsRef.current = {}; sessionRefreshOptionsRef.current = {};
    setConnection({ status: 'idle', message: 'Disconnected' });
  }, [scopeGenerationRef, serverGenerationRef, setConnection, sessionRefreshTimeoutsRef, sessionRefreshOptionsRef, initialConnectStartedRef]);
  const busy = prompt.sendingState.active || conversationPhase !== 'off' || state.isBootstrappingChat ||
    state.connection.status === 'connecting' || Boolean(state.mcpAuthPrompt) ||
    Object.values(state.sessionStatuses).some((status) => status.type !== 'idle') ||
    Object.values(state.pendingPermissionsBySession).some((items) => items.length > 0) ||
    Object.values(state.pendingQuestionsBySession).some((items) => items.length > 0) ||
    Object.values(inbox.pendingPromptsBySession).some((items) => items.length > 0) || terminal.terminalRuntime.instances.length > 0;
  return useMemo(() => ({ enabled: input.connection.enabled, values, busy, suspend, catalogClient, catalogSessions: activeSessionsHook.catalogSessions, catalogStatuses: activeSessionsHook.catalogStatuses,
    pendingPermissions: state.pendingPermissionsBySession, pendingQuestions: state.pendingQuestionsBySession,
    native: { settings: state.settings, catalogClient, contract: state.serverContract, isCurrentCatalogClient,
      connectionScope: state.connectionScope, currentSessionId: state.currentSessionId, sessions: state.sessions,
      activeSessions: activeSessionsHook.activeSessions, todoRecordsBySession: transcript.todoRecordsBySession,
      todosBySession: state.todosBySession, streamConnectedRef },
  }), [input.connection.enabled, values, busy, suspend, catalogClient, activeSessionsHook.catalogSessions, activeSessionsHook.catalogStatuses, state.pendingPermissionsBySession,
    state.pendingQuestionsBySession, state.settings, state.serverContract, isCurrentCatalogClient, state.connectionScope,
    state.currentSessionId, state.sessions, activeSessionsHook.activeSessions, transcript.todoRecordsBySession, state.todosBySession]);
}
