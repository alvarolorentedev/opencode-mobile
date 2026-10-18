import type { OpencodeEvent } from '@/lib/opencode/events';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { buildClient, defaultConnectionSettings, getRequestHeaders } from '@/lib/opencode/client';
import { defaultChatPreferences } from '@/providers/opencode-preferences';
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
import { useNativeSurfaces } from '@/providers/use-native-surfaces';
import { useWidgetState } from '@/providers/use-widget-state';
import { useOpencodePersistence } from '@/providers/use-opencode-persistence';
import { useTerminalState } from '@/providers/use-terminal-state';
import { useWorktreeState } from '@/providers/use-worktree-state';
import { handleProviderEvent, type ProviderEventActions } from '@/providers/opencode-provider-events';
import { useOpencodeProviderState } from '@/providers/use-opencode-provider-state';
import { useOpencodeProviderEffects } from '@/providers/use-opencode-provider-effects';
import { useProjectActions } from '@/providers/use-project-actions';
import { useCapabilitiesActions } from '@/providers/use-capabilities-actions';
import { useSessionActions } from '@/providers/use-session-actions';
import { usePromptInbox } from '@/providers/use-prompt-inbox';
import { usePromptLifecycle } from '@/providers/use-prompt-lifecycle';
import { useConnectionActions } from '@/providers/use-connection-actions';
import { useOpencodeProviderValues } from '@/providers/opencode-provider-values';
import { useAppUpdates } from '@/providers/use-app-updates';
import { useShareState } from '@/providers/use-share-state';

export function useOpencodeProviderComposition() {
  const state = useOpencodeProviderState();
  const {
    setOnboardingVersion,
    setOnboardingActive,
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
    sessionRefreshTimeoutsRef,
    sessionRefreshOptionsRef,
    clientGenerationRef,
    catalogGenerationRef,
    scopeGenerationRef,
    serverGenerationRef,
  } = state;

  const { isHydrated } = useOpencodePersistence({
    ...state,
    defaultChatPreferences,
    defaultSettings: defaultConnectionSettings,
  });

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
    [state.activeProjectPath, state.serverContract, state.settings],
  );
  const catalogClient = useMemo(() => buildClient({ ...state.settings, directory: '' }, state.serverContract), [state.serverContract, state.settings]);
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
    (candidate: object) => clientGenerationRef.current.get(candidate) === scopeGenerationRef.current,
    [clientGenerationRef, scopeGenerationRef],
  );
  const isCurrentCatalogClient = useCallback(
    (candidate: object) => catalogGenerationRef.current.get(candidate) === serverGenerationRef.current,
    [catalogGenerationRef, serverGenerationRef],
  );

  const transcript = useTranscriptState({ ...state, client, isCurrentClient });
  const inbox = usePromptInbox({ client, isCurrentClient, refreshMessages: transcript.refreshMessages });
  const terminal = useTerminalState({
    ...state,
    client,
    directory: state.activeProjectPath || '',
    isCurrentClient,
    serverUrl: state.settings.serverUrl,
    authorization: getRequestHeaders(state.settings)?.Authorization,
  });
  const worktree = useWorktreeState({ ...state, client, isCurrentClient, refreshProjectCatalog: refreshProjectCatalogLatest });
  const activeProject = useMemo(
    () => resolveActiveProject(projects, state.activeProjectPath, state.currentProjectPath, worktree.worktrees),
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

  useNativeSurfaces({
    ready: state.connection.status !== 'idle', connected: state.connection.status === 'connected',
    connectionScope: state.connectionScope, language: state.chatPreferences.language,
    activeSessions: activeSessionsHook.activeSessions,
  });
  const streamConnectedRef = useRef(false);
  const widgets = useWidgetState({
    ...state, streamConnectedRef, hydrated: isHydrated, connected: state.connection.status === 'connected', catalogClient, contract: state.serverContract, isCurrentCatalogClient,
    showPreviews: state.chatPreferences.showWidgetPreviews !== false, language: state.chatPreferences.language,
    sessions: state.sessions, todoRecordsBySession: transcript.todoRecordsBySession, todosBySession: state.todosBySession,
  });
  const clearProjectState = useCallback(() => {
    bootstrapPromiseRef.current = null;
    bootstrapTokenRef.current = undefined;
    busyNotificationsRef.current.clear();
    Object.values(sessionRefreshTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
    sessionRefreshTimeoutsRef.current = {};
    sessionRefreshOptionsRef.current = {};
    setCurrentSessionId(undefined);
    setSessions([]);
    setArchivedSessions([]);
    setSessionStatuses({});
    transcript.reset();
    setCommands([]);
    setCurrentConfig(undefined);
    setAvailableProviders([]);
    setProviderAuthMethodsById({});
    setAvailableModels([]);
    setAvailableAgents([]);
    setPendingPermissionsBySession({});
    setPendingQuestionsBySession({});
    setMcpAuthPrompt(undefined);
    permissionRules.resetPermissionRules();
    setProjectFileStatuses([]);
    setSelectedProjectFile(undefined);
    setVcsInfo(undefined);
    mcp.resetMcpState();
    terminal.resetTerminal();
    worktree.resetWorktrees();
  }, [mcp.resetMcpState, permissionRules.resetPermissionRules, terminal.resetTerminal, transcript.reset, worktree.resetWorktrees, bootstrapPromiseRef, bootstrapTokenRef, busyNotificationsRef, sessionRefreshOptionsRef, sessionRefreshTimeoutsRef, setArchivedSessions, setAvailableAgents, setAvailableModels, setAvailableProviders, setCommands, setCurrentConfig, setCurrentSessionId, setMcpAuthPrompt, setPendingPermissionsBySession, setPendingQuestionsBySession, setProviderAuthMethodsById, setSelectedProjectFile, setSessionStatuses, setSessions, setVcsInfo, setProjectFileStatuses]);

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
    eventActionsRef.current = {
      refreshSessions: project.refreshSessions,
      refreshArchivedSessions: sessionActions.refreshArchivedSessions,
      scheduleSessionRefresh: project.scheduleSessionRefresh,
      refreshPendingInteractions: project.refreshPendingInteractions,
      refreshServerFeatures: project.refreshServerFeatures,
      refreshChatCapabilities: capabilities.refreshChatCapabilities,
      refreshProjectCatalog: project.refreshProjectCatalog,
      refreshTerminals: terminal.refreshTerminals,
      refreshWorktrees: worktree.refreshWorktrees,
      refreshMcpServers: mcp.refreshMcpServers,
      refreshDiagnostics: project.refreshDiagnostics,
      setSessionStatuses: state.setSessionStatuses,
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
    connectionScope: state.connectionScope, connected: state.connection.status === 'connected',
    currentSessionId: state.currentSessionId, sessions: state.sessions, sendingState: prompt.sendingState, promptError: prompt.promptError,
    streamConnectedRef,
  });

  const { eventStreamStatus } = useOpencodeRealtime({
    catalogClient,
    activeProjectPath: state.activeProjectPath,
    connected: state.connection.status === 'connected',
    pendingSessionIds: Object.keys(inbox.pendingPromptsBySession).filter((id) => inbox.pendingPromptsBySession[id].length > 0),
    busy: widgets.busy || Object.values(inbox.pendingPromptsBySession).some((prompts) => prompts.length > 0) || prompt.sendingState.active || conversationPhase !== 'off' || Object.values(state.sessionStatuses).some((status) => status.type !== 'idle'),
    currentSessionId: state.currentSessionId,
    conversationSessionId,
    onEvent: handleEvent,
    onGlobalEvent: (event) => { handleActivityEvent(event); widgets.handleWidgetEvent(event); },
    refreshNativeSurfaces: widgets.refreshWidgets,
    onFatalError: connectionActions.handleStreamAuthFailure,
    refreshSessions: project.refreshSessions,
    refreshPendingInteractions: project.refreshPendingInteractions,
    refreshMessages: inbox.refreshMessages,
    refreshSessionDiff: project.refreshSessionDiff,
    refreshSessionTodos: project.refreshSessionTodos,
  });

  useLayoutEffect(() => {
    streamConnectedRef.current = eventStreamStatus === 'connected';
  });

  const sharedInput = useShareState({
    ...state, hydrated: isHydrated, projectPath: state.activeProjectPath, sessions: activeSessionsHook.catalogSessions, hideSubagentChats: state.chatPreferences.hideSubagentChats, refreshTargets: activeSessionsHook.refreshActiveSessions,
    createSession: sessionActions.createSession, openSession: connectionActions.openDeepLinkSession });
  useOpencodeProviderEffects({
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
    isHydrated,
    onboardingCompleted,
    onboardingActive: state.onboardingActive,
    completeOnboarding,
    startOnboardingReview,
    stopOnboardingReview,
    projects,
    activeProject,
    eventStreamStatus,
    sharedInput,
  });

  const updates = useAppUpdates({
    initialized: isHydrated && onboardingCompleted && !state.onboardingActive,
    blocked: prompt.sendingState.active || conversationPhase !== 'off' || values.chatValue.isBootstrappingChat ||
      state.connection.status === 'connecting' || Boolean(state.mcpAuthPrompt) ||
      Object.values(state.sessionStatuses).some((status) => status.type !== 'idle') ||
      activeSessionsHook.activeSessions.some((session) => session.status.type !== 'idle') ||
      Object.values(state.pendingPermissionsBySession).some((items) => items.length > 0) ||
      Object.values(state.pendingQuestionsBySession).some((items) => items.length > 0) ||
      Object.values(inbox.pendingPromptsBySession).some((items) => items.length > 0) ||
      (values.connectionValue.connectSetup.enabled && (values.connectionValue.connectSetup.busy ||
        values.connectionValue.connectSetup.initialization === 'loading' ||
        !['idle', 'paired'].includes(values.connectionValue.connectSetup.phase))),
  });

  return { updates, values };
}
