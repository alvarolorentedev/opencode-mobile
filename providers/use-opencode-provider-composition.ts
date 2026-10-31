// Per-workspace domain composition. See docs/architecture/overview.md#top-level-runtime-composition.
import type { OpencodeEvent } from '@/lib/opencode/events';
import { emptySharedInput } from '@/providers/use-share-state';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { buildClient, getRequestHeaders } from '@/lib/opencode/client';
import { getActiveSessions } from '@/providers/active-sessions';
import { useConnectionRuntime } from '@/providers/connection-runtime';
import {
  CURRENT_ONBOARDING_VERSION,
  isOnboardingComplete,
} from '@/providers/onboarding-state';
import { handleProviderEvent, type ProviderEventActions } from '@/providers/opencode-provider-events';
import { buildOpencodeProjects, resolveActiveProject } from '@/providers/opencode-provider-utils';
import { useOpencodeProviderValues } from '@/providers/opencode-provider-values';
import { MAX_ACTIVE_SESSIONS } from '@/providers/use-active-sessions';
import { useActivityNotifications } from '@/providers/use-activity-notifications';
import { useCapabilitiesActions } from '@/providers/use-capabilities-actions';
import { useCoalescedRefresh } from '@/providers/use-coalesced-refresh';
import { useConnectionLinkActions } from '@/providers/use-connection-link-actions';
import { useConversationState } from '@/providers/use-conversation-state';
import { useExtensionsState } from '@/providers/use-extensions-state';
import { useMcpState } from '@/providers/use-mcp-state';
import { useOpencodeProviderEffects } from '@/providers/use-opencode-provider-effects';
import { useOpencodeProviderReset } from '@/providers/use-opencode-provider-reset';
import { useOpencodeRealtime } from '@/providers/use-opencode-realtime';
import { usePermissionRulesState } from '@/providers/use-permission-rules-state';
import { useProjectActions } from '@/providers/use-project-actions';
import { usePromptInbox } from '@/providers/use-prompt-inbox';
import { usePromptLifecycle } from '@/providers/use-prompt-lifecycle';
import { useSessionActions } from '@/providers/use-session-actions';
import { useTerminalState } from '@/providers/use-terminal-state';
import { useTranscriptReadErrors } from '@/providers/use-transcript-read-errors';
import { useTranscriptState } from '@/providers/use-transcript-state';
import { useWorkspaceRuntimeState } from '@/providers/use-workspace-runtime-state';
import { useWorkspaceServerData } from '@/providers/use-workspace-server-data';
import { useWorktreeState } from '@/providers/use-worktree-state';

import type { WorkspaceRuntimeInput } from '@/providers/workspace-types';


export function useOpencodeProviderComposition(input: WorkspaceRuntimeInput) {
  const connectionRuntime = useConnectionRuntime();
  const state = useWorkspaceRuntimeState(input);
  // Connectivity is owned by WorkspaceProvider. NetInfo.configure() is global
  // and tears down existing listeners, so a per-runtime hook would freeze every
  // workspace except the one that mounted last.
  const network = input.network;
  const { connection: inputConnection } = input;
  const isHydrated = input.isHydrated && input.connection.enabled;
  const {
    setOnboardingVersion,
    setOnboardingActive,
    setMcpAuthPrompt,
    sessionRefreshTimeoutsRef,
    sessionRefreshOptionsRef,
    clientGenerationRef,
    scopeGenerationRef,
    serverGenerationRef,
  } = state;


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

  const client = useMemo(
    () => buildClient({ ...state.settings, directory: state.activeProjectPath || '' }, state.serverContract),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect needs fresh clients so old in-flight requests stay invalid.
    [state.activeProjectPath, state.serverContract, state.settings, input.connection.enabled],
  );
  const { catalogClient, isCurrentCatalogClient, catalog, reconnect } = connectionRuntime;
  // Tag each client instance with the generation current when it is first seen.
  // A layout effect keeps this off the render path while still running before
  // any callback that could consume `isCurrentClient`.
  useLayoutEffect(() => {
    if (!clientGenerationRef.current.has(client)) {
      clientGenerationRef.current.set(client, scopeGenerationRef.current);
    }

  });
  const isCurrentClient = useCallback(
    (candidate: object) => input.connection.enabled && clientGenerationRef.current.get(candidate) === scopeGenerationRef.current,
    [clientGenerationRef, scopeGenerationRef, input.connection.enabled],
  );
  const serverData = useWorkspaceServerData(client, state.connection.status === 'connected', isCurrentClient);
  const domain = { ...state, ...serverData };
  const projects = useMemo(
    () => buildOpencodeProjects(state.projectPathsByConnection[state.connectionScope] ?? [], serverData.serverProjects),
    [state.connectionScope, state.projectPathsByConnection, serverData.serverProjects],
  );

  const transcript = useTranscriptState({ ...domain, client, isCurrentClient });
  const transcriptRead = useTranscriptReadErrors({
    client,
    isCurrentClient,
    refreshMessages: transcript.refreshMessages,
  });
  const inbox = usePromptInbox({
    client,
    isCurrentClient,
    refreshMessages: transcriptRead.readMessages,
    connected: state.connection.status === 'connected',
    online: network.online,
  });
  const refreshInboxMessages = inbox.refreshMessages;
  const retryTranscript = useCallback(async () => {
    const sessionId = state.currentSessionId;
    if (!sessionId) return;
    await refreshInboxMessages(sessionId, false).catch(() => undefined);
  }, [refreshInboxMessages, state.currentSessionId]);
  // Memoized so the terminal reconnect effect only runs when headers actually
  // change, not on every render (getRequestHeaders returns a new object).
  const terminalHeaders = useMemo(() => getRequestHeaders(state.settings), [state.settings]);
  const terminal = useTerminalState({
    enabled: input.connection.enabled,
    ...domain,
    client,
    directory: state.activeProjectPath || '',
    isCurrentClient,
    serverUrl: state.settings.serverUrl,
    headers: terminalHeaders,
    online: network.online,
  });
  const worktree = useWorktreeState({ ...domain, client, isCurrentClient, connected: state.connection.status === 'connected' });
  const activeProject = useMemo(
    () => resolveActiveProject(projects, state.activeProjectPath, worktree.worktrees) ?? (state.activeProjectPath
      ? { path: state.activeProjectPath, label: state.activeProjectPath.split('/').filter(Boolean).pop() || state.activeProjectPath } : undefined),
    [projects, state.activeProjectPath, worktree.worktrees],
  );
  const mcp = useMcpState({ ...domain, client, isCurrentClient });
  const permissionRules = usePermissionRulesState({ client, isCurrentClient });

  // Clear the MCP auth alert once the named server reports connected. Doing this
  // here keeps `mcpStatuses` out of the approvals value's dependencies, so
  // approval consumers do not re-render on MCP status changes.
  useEffect(() => {
    if (state.mcpAuthPrompt && mcp.mcpStatuses[state.mcpAuthPrompt.mcpName]?.status === 'connected') {
      setMcpAuthPrompt(undefined);
    }
  }, [mcp.mcpStatuses, setMcpAuthPrompt, state.mcpAuthPrompt]);
  const activeSessions = useMemo(() => getActiveSessions({
    sessions: catalog.sessions,
    statuses: catalog.statuses,
    currentSessionId: state.currentSessionId,
    hideSubagentChats: state.chatPreferences.hideSubagentChats === true,
    maxTotal: MAX_ACTIVE_SESSIONS,
  }), [catalog.sessions, catalog.statuses, state.currentSessionId, state.chatPreferences.hideSubagentChats]);

  const streamConnectedRef = useRef(false);
  const { resetTerminal } = terminal;
  const { reset: resetTranscript } = transcript;
  const clearProjectState = useOpencodeProviderReset({
    state,
    resetTerminal,
    resetTranscript,
  });

  const project = useProjectActions({ ...domain, connectionId: inputConnection.id, connected: state.connection.status === 'connected', client, catalogClient, isCurrentClient, isCurrentCatalogClient, clearProjectState, isHydrated, refreshMessages: inbox.refreshMessages });

  const capabilities = useCapabilitiesActions({ ...domain, client, isCurrentClient });
  // Event bursts (rename + update, config fan-out, file-save VCS events) share
  // one refresh instead of starting overlapping reads.
  const scheduleSessionsRefresh = useCoalescedRefresh(() => project.refreshSessions(), 150);
  const extensions = useExtensionsState({
    client,
    isCurrentClient,
  });

  const sessionActions = useSessionActions({
    ...domain,
    ...project,
    ...permissionRules,
    client,
    catalogClient,
    isCurrentClient,
    isCurrentCatalogClient,
    refreshMessages: inbox.refreshMessages,
    refreshActiveSessions: catalog.refresh,
    refreshChatCapabilities: capabilities.refreshChatCapabilities,
    beginHydration: transcript.beginHydration,
  });
  const ensureActiveSessionRef = useRef(sessionActions.ensureActiveSession);

  const prompt = usePromptLifecycle({
    submitPrompt: inbox.submitPrompt,
    ...domain,
    ...project,
    client,
    isCurrentClient,
    refreshMessages: inbox.refreshMessages,
  });

  const { onInvalidated } = connectionRuntime;
  const { setSendingState } = prompt;
  useLayoutEffect(() => onInvalidated(() => {
    scopeGenerationRef.current++;
    clearProjectState();
    setSendingState({ active: false });
  }), [clearProjectState, onInvalidated, setSendingState, scopeGenerationRef]);
  const linkActions = useConnectionLinkActions({ client, isCurrentClient, connectionScope: state.connectionScope,
    connection: state.connection, activeProjectPath: state.activeProjectPath, openSession: sessionActions.openSession, connect: connectionRuntime.connect });
  const connectionActions = { ...connectionRuntime, ...linkActions,
    updateSettings: (patch: Partial<typeof state.settings>) => input.setSettings((current) => ({ ...current, ...patch })),
    switchConnection: input.switchConnection, connectSetup: input.connectSetup, connectionProfiles: input.connectionProfiles, servicesValue: input.servicesValue };
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
    ensureActiveSessionRef.current = sessionActions.ensureActiveSession;
    const focusSessionIds = new Set<string>();
    if (state.currentSessionId) focusSessionIds.add(state.currentSessionId);
    if (conversationSessionId) focusSessionIds.add(conversationSessionId);
    for (const [sessionId, prompts] of Object.entries(inbox.pendingPromptsBySession)) {
      if (prompts.length > 0) focusSessionIds.add(sessionId);
    }
    eventActionsRef.current = {
      refreshSessions: project.refreshSessions,
      scheduleSessionRefresh: project.scheduleSessionRefresh,
      scheduleSessionsRefresh,
      refreshPendingInteractions: project.refreshPendingInteractions,
      refreshTerminals: terminal.refreshTerminals,
      focusSessionIds,
      setSessions: state.setSessions,
      removeCatalogSession: catalog.removeSession,
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
    ...domain,
    client,
    isCurrentClient,
    ensureActiveSessionRef,
    setPromptError: prompt.setPromptError,
    conversationSessionId,
    pruneTranscript: transcript.prune,
  });

  const values = useOpencodeProviderValues({
    ...domain,
    ...transcript,
    transcriptReadError: state.currentSessionId ? transcriptRead.errors[state.currentSessionId] : undefined,
    retryTranscript,
    ...permissionRules,
    mcpAuthPrompt: state.mcpAuthPrompt,
    dismissMcpAuth,
    pendingPromptsBySession: inbox.pendingPromptsBySession,
    cancelPrompt: inbox.cancelPrompt,
    ...terminal,
    ...worktree,
    ...mcp,
    ...extensions,
    ...project,
    ...sessionActions,
    ...capabilities,
    ...prompt,
    ...connectionActions,
    activeSessions,
    refreshActiveSessions: catalog.refresh,
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
    scopeGenerationRef.current++; serverGenerationRef.current++;
    for (const timeout of Object.values(sessionRefreshTimeoutsRef.current)) clearTimeout(timeout);
    sessionRefreshTimeoutsRef.current = {}; sessionRefreshOptionsRef.current = {};
  }, [scopeGenerationRef, serverGenerationRef, sessionRefreshTimeoutsRef, sessionRefreshOptionsRef ]);
  const busy = prompt.sendingState.active || conversationPhase !== 'off' || state.isBootstrappingChat ||
    state.connection.status === 'connecting' || Boolean(state.mcpAuthPrompt) ||
    Object.values(state.sessionStatuses).some((status) => status.type !== 'idle') ||
    Object.values(state.pendingPermissionsBySession).some((items) => items.length > 0) ||
    Object.values(state.pendingQuestionsBySession).some((items) => items.length > 0) ||
    Object.values(inbox.pendingPromptsBySession).some((items) => items.length > 0) || terminal.terminalRuntime.instances.length > 0;
  return useMemo(() => ({ libraryVisible: state.activeSessionsVisible, revision: input.connection.revision, enabled: input.connection.enabled, values, busy, suspend, catalogClient, catalogSessions: catalog.sessions, catalogStatuses: catalog.statuses,
    pendingPermissions: state.pendingPermissionsBySession, pendingQuestions: state.pendingQuestionsBySession,
    native: { settings: state.settings, catalogClient, contract: state.serverContract, isCurrentCatalogClient,
      connectionScope: state.connectionScope, currentSessionId: state.currentSessionId, sessions: state.sessions,
      activeSessions, todoRecordsBySession: transcript.todoRecordsBySession,
      todosBySession: state.todosBySession, streamConnectedRef },
  }), [state.activeSessionsVisible, input.connection.revision, input.connection.enabled, values, busy, suspend, catalogClient, catalog.sessions, catalog.statuses, state.pendingPermissionsBySession,
    state.pendingQuestionsBySession, state.settings, state.serverContract, isCurrentCatalogClient, state.connectionScope,
    state.currentSessionId, state.sessions, activeSessions, transcript.todoRecordsBySession, state.todosBySession]);
}
