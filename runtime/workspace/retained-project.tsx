// Observe the retained project and publish its scoped presentation to the app shell.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, type Dispatch, type SetStateAction } from 'react';

import { buildClient, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { getActiveSessions, MAX_ACTIVE_SESSIONS, useApprovalsCatalog, useSessionActions, useSessionCatalog, useSessionPresentation } from '@/features/sessions/runtime';
import { useConnectionRuntime } from '@/runtime/connections/connection-runtime';
import { useProjectPresentation, useWorktreeState } from '@/features/projects/runtime';
import { useActivityNotifications } from '@/features/notifications/runtime';
import { useCapabilitiesActions, useCapabilitiesPresentation } from '@/features/ai/runtime';
import { useConversationState } from '@/features/voice/runtime';
import { useOpencodeProviderEffects } from '@/runtime/composition/use-opencode-provider-effects';
import { useOpencodeProviderReset } from '@/runtime/composition/use-opencode-provider-reset';
import { useWorkspaceRealtime } from '@/runtime/realtime/use-workspace-realtime';
import { useProjectActions } from '@/runtime/composition/use-project-actions';
import { useChatPresentation, useDiffCatalog, usePromptInbox, usePromptLifecycle, useTranscriptReadErrors, useTranscriptState } from '@/features/chat/runtime';
import { useSessionRuntimeState } from '@/runtime/workspace/use-session-runtime-state';
import { useWorkspaceServerData } from '@/runtime/composition/use-workspace-server-data';
import { useAppCore, useAppStore } from '@/runtime/core';
import { useConnectionQueryIdentity, useQueryForeground } from '@/shared/server-data/client';
import { mcpOptions } from '@/shared/server-data/diagnostics';

import { workspaceChatPreferences } from '@/runtime/core/commands/connection';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { workspaceKey } from '@/shared/contracts/workspace';
import type { useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import type { ProjectBindingInput, WorkspaceSnapshot, WorkspaceValues } from '@/runtime/workspace/workspace-types';

type Manager = ReturnType<typeof useWorkspaceConnections>;
type Props = Omit<ProjectBindingInput, 'setSettings' | 'setChatPreferences' | 'preferences'> & {
  defaults: ChatPreferences;
  updateSettings: Manager['updateSettings'];
  updatePreferences: Manager['updatePreferences'];
  publish: (key: string, snapshot: WorkspaceSnapshot) => void;
  forget: (key: string) => void;
};
export const RetainedProject = memo(function RetainedProject({ defaults, updateSettings, updatePreferences, publish, forget, ...props }: Props) {
  const { store, commands: { session: sessionCommands }, events, terminal } = useAppCore();
  const id = props.connection.id;
  const key = workspaceKey({ connectionId: id, projectPath: props.projectPath ?? '' });
  const hasTerminal = useAppStore((state) => Boolean(state.terminal[key]?.instances.length));
  const refreshTerminals = useCallback(() => terminal.get(key)?.controller.refreshTerminals() ?? Promise.resolve(), [key, terminal]);
  const resetTerminal = useCallback(() => terminal.get(key)?.controller.resetTerminal(), [key, terminal]);
  const preferences = useMemo(() => workspaceChatPreferences(defaults, props.connection.preferences), [defaults, props.connection.preferences]);
  const setSettings = useCallback<Dispatch<SetStateAction<OpencodeConnectionSettings>>>((next) => {
    const entry = store.getState().registry.connections.find((candidate) => candidate.id === id);
    if (entry) updateSettings(id, typeof next === 'function' ? next(entry.settings) : next, key);
  }, [id, key, store, updateSettings]);
  const setChatPreferences = useCallback<Dispatch<SetStateAction<ChatPreferences>>>((next) => {
    const { registry, shell } = store.getState();
    const entry = registry.connections.find((candidate) => candidate.id === id);
    if (!entry) return;
    updatePreferences(id, typeof next === 'function' ? next(workspaceChatPreferences(shell.chatPreferences, entry.preferences)) : next);
  }, [id, store, updatePreferences]);
  const input: ProjectBindingInput = { ...props, preferences, setSettings, setChatPreferences };

  const connectionRuntime = useConnectionRuntime(input.connection, input.catalog);
  const local = useSessionRuntimeState(input, connectionRuntime.connection, connectionRuntime.serverContract);
  const identity = useConnectionQueryIdentity(input.connection);
  const foreground = useQueryForeground();
  const demanded = input.demanded && input.connection.enabled && foreground;
  const state = { ...local, ...input.shared, identity, queryActive: demanded, chatPreferences: input.preferences, setChatPreferences: input.setChatPreferences };
  // Connectivity is owned by WorkspaceProvider. NetInfo.configure() is global
  // and tears down existing listeners, so a per-runtime hook would freeze every
  // workspace except the one that mounted last.
  const network = input.network;
  const { connection: inputConnection } = input;
  const refreshQueue = useMemo(() => events.createProjectRefreshQueue(), [events]);
  useEffect(() => refreshQueue.clear, [refreshQueue]);
  const isHydrated = input.isHydrated && input.connection.enabled;
  const {
    cancelBootstrap,
    clientGenerationRef,
    scopeGenerationRef,
    serverGenerationRef,
  } = state;

  useEffect(() => () => {
    scopeGenerationRef.current++;
    serverGenerationRef.current++;
    cancelBootstrap();
  }, [cancelBootstrap, scopeGenerationRef, serverGenerationRef]);
  useLayoutEffect(() => {
    scopeGenerationRef.current++;
    serverGenerationRef.current++;
    cancelBootstrap();
  }, [inputConnection.revision, cancelBootstrap, scopeGenerationRef, serverGenerationRef]);

  const client = useMemo(
    () => buildClient({ ...state.settings, directory: state.activeProjectPath || '' }, state.serverContract),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect needs fresh clients so old in-flight requests stay invalid.
    [state.activeProjectPath, state.serverContract, state.settings, input.connection.enabled],
  );
  const { catalogClient, isCurrentCatalogClient, catalog } = connectionRuntime;
  const mcpQueryKey = useMemo(() => mcpOptions(identity, client).queryKey, [identity, client]);
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
  const serverData = useWorkspaceServerData(identity, client, state.connection.status === 'connected', isCurrentClient, demanded);
  const sessionCatalog = useSessionCatalog(identity, client);
  const approvalsCatalog = useApprovalsCatalog(identity, client);
  const diffCatalog = useDiffCatalog(identity, client);
  const transcript = useTranscriptState({ ...state, client, isCurrentClient });
  const domain = {
    ...state, ...serverData, ...sessionCatalog, ...approvalsCatalog, ...diffCatalog,
    messagesBySession: transcript.messagesBySession, readDisplayedSession: transcript.readDisplayedSession,
  };

  const transcriptRead = useTranscriptReadErrors({
    scopeKey: state.scopeKey,
    client,
    isCurrentClient,
    refreshMessages: transcript.refreshMessages,
  });
  const inbox = usePromptInbox({
    client, identity,
    queueScope: JSON.stringify([input.connection.id, state.activeProjectPath || '', state.settings.connect ? state.settings.serverUrl : '']),
    isCurrentClient,
    refreshMessages: transcriptRead.readMessages,
    appendUserMessage: transcript.appendUserMessage,
    connected: state.connection.status === 'connected',
    online: network.online,
  });
  const refreshInboxMessages = inbox.refreshMessages;
  const retryTranscript = useCallback(async () => {
    const sessionId = state.currentSessionId;
    if (!sessionId) return;
    await refreshInboxMessages(sessionId, false).catch(() => undefined);
  }, [refreshInboxMessages, state.currentSessionId]);
  const worktree = useWorktreeState({ ...domain, client, isCurrentClient, connected: state.connection.status === 'connected' });
  const activeSessions = useMemo(() => getActiveSessions({
    sessions: catalog.sessions,
    statuses: catalog.statuses,
    currentSessionId: state.currentSessionId,
    hideSubagentChats: state.chatPreferences.hideSubagentChats === true,
    maxTotal: MAX_ACTIVE_SESSIONS,
  }), [catalog.sessions, catalog.statuses, state.currentSessionId, state.chatPreferences.hideSubagentChats]);

  const { manager } = connectionRuntime;
  const isStreamConnected = useCallback(() => manager?.realtime.getStatus() === 'connected', [manager]);
  const { reset: resetTranscript } = transcript;
  const forgetSessionCreation = useCallback((id?: string) => sessionCommands.forgetSessionCreation(identity, client, id), [client, identity, sessionCommands]);
  const clearProjectState = useOpencodeProviderReset({
    state,
    resetTerminal,
    resetTranscript,
    clearRefreshes: refreshQueue.clear,
    setSessions: sessionCatalog.setSessions,
    setDiffsBySession: diffCatalog.setDiffsBySession,
    setTodosBySession: diffCatalog.setTodosBySession,
    setVcsDiffsByScope: diffCatalog.setVcsDiffsByScope,
    setPendingPermissionsBySession: approvalsCatalog.setPendingPermissionsBySession,
    setPendingQuestionsBySession: approvalsCatalog.setPendingQuestionsBySession,
    forgetSessionCreation,
  });

  const sessionTarget = useMemo(() => ({
    connectionId: inputConnection.id, projectPath: state.activeProjectPath ?? '',
  }), [inputConnection.id, state.activeProjectPath]);
  const sessionRefresh = useMemo(() => sessionCommands.refresh(sessionTarget, state.scopeKey, inputConnection.revision),
    [inputConnection.revision, sessionCommands, sessionTarget, state.scopeKey]);
  const project = useProjectActions({ ...domain, connectionId: inputConnection.id, connected: state.connection.status === 'connected', client, catalogClient, isCurrentClient, isCurrentCatalogClient, clearProjectState, isHydrated, refreshMessages: inbox.refreshMessages }, sessionRefresh, refreshQueue);

  const capabilities = useCapabilitiesActions({ ...domain, client, isCurrentClient, isHydrated });

  const sessionNavigation = useMemo(() => sessionCommands.navigation(sessionTarget, state.scopeKey, inputConnection.revision),
    [inputConnection.revision, sessionCommands, sessionTarget, state.scopeKey]);
  const sessionCreation = useMemo(() => sessionCommands.creation(sessionTarget, state.scopeKey, inputConnection.revision),
    [inputConnection.revision, sessionCommands, sessionTarget, state.scopeKey]);
  const sessionEditing = useMemo(() => sessionCommands.editing(sessionTarget, state.scopeKey, inputConnection.revision),
    [inputConnection.revision, sessionCommands, sessionTarget, state.scopeKey]);
  const sessionActions = useSessionActions({
    client,
    isCurrentClient,
    availableAgents: serverData.availableAgents,
    commands: serverData.commands,
    currentConfig: serverData.currentConfig,
    chatPreferences: state.chatPreferences,
    connectionScopeRef: state.connectionScopeRef,
    favoriteSessions: state.favoriteSessions,
    setFavoriteSessions: state.setFavoriteSessions,
    refreshMessages: inbox.refreshMessages,
    refreshSessions: project.refreshSessions,
  });
  const interactions = useMemo(() => sessionCommands.interactions(sessionTarget, inputConnection.revision),
    [inputConnection.revision, sessionCommands, sessionTarget]);

  const prompt = usePromptLifecycle({
    submitPrompt: inbox.submitPrompt,
    ...domain,
    ...project,
    client,
    isCurrentClient,
  });

  const { onInvalidated } = connectionRuntime;
  const { resetPrompt } = prompt;
  useLayoutEffect(() => onInvalidated(() => {
    scopeGenerationRef.current++;
    clearProjectState();
    resetPrompt();
  }), [clearProjectState, onInvalidated, resetPrompt, scopeGenerationRef]);
  const { conversation, clearConversationFeedback, toggleConversationMode } = useConversationState({
    scopeKey: state.scopeKey,
    connection: state.connection,
    chatPreferences: state.chatPreferences,
    currentSessionId: state.currentSessionId,
    setCurrentSessionId: state.setCurrentSessionId,
    sessionStatuses: sessionCatalog.sessionStatuses,
    messagesBySession: transcript.messagesBySession,
    pendingPermissionsBySession: approvalsCatalog.pendingPermissionsBySession,
    pendingQuestionsBySession: approvalsCatalog.pendingQuestionsBySession,
    sendingState: prompt.sendingState,
    ensureActiveSession: sessionNavigation.ensureActiveSession,
    sendPrompt: prompt.sendPrompt,
  });
  const { phase: conversationPhase, sessionId: conversationSessionId } = conversation;

  const pendingSessionIds = Object.keys(inbox.pendingPromptsBySession).filter((id) => inbox.pendingPromptsBySession[id].length > 0);

  const handleActivityEvent = useActivityNotifications({
    catalogClient, settings: state.settings, contract: state.serverContract,
    connectionScope: state.connectionScope, connected: input.isConnectionOwner && state.connection.status === 'connected',
    currentSessionId: input.visible ? state.currentSessionId : undefined, sessions: sessionCatalog.sessions, sendingState: prompt.sendingState, promptError: prompt.promptError,
    autoApprove: state.chatPreferences.autoApprove,
    isStreamConnected,
  });

  useWorkspaceRealtime(connectionRuntime.manager?.realtime, {
    workspaceKey: state.scopeKey,
    demanded,
    projectPath: state.activeProjectPath,
    constrained: network.constrained,
    pendingSessionIds,
    busy: pendingSessionIds.length > 0 || prompt.sendingState.active || conversationPhase !== 'off' || Object.values(sessionCatalog.sessionStatuses).some((status) => status.type !== 'idle'),
    currentSessionId: state.currentSessionId,
    conversationSessionId,
    onEvent: (event) => events.dispatch(event, {
      workspaceKey: state.scopeKey, mcpQueryKey, isCurrent: () => isCurrentClient(client), pendingSessionIds,
      actions: {
        refreshSessions: project.refreshSessions,
        scheduleSessionRefresh: project.scheduleSessionRefresh,
        scheduleSessionsRefresh: project.scheduleSessionsRefresh,
        applyTranscriptEvent: transcript.applyTranscriptEvent,
        liveTranscriptMessageId: transcript.liveTranscriptMessageId,
        isLocalSendRecent: transcript.isLocalSendRecent,
        refreshPendingInteractions: project.refreshPendingInteractions,
        refreshTerminals,
        setSessions: sessionCatalog.setSessions,
        removeCatalogSession: catalog.removeSession,
        setSessionStatuses: sessionCatalog.setSessionStatuses,
        setDiffsBySession: diffCatalog.setDiffsBySession,
        setTodosBySession: diffCatalog.setTodosBySession,
        setPendingPermissionsBySession: approvalsCatalog.setPendingPermissionsBySession,
        setPendingQuestionsBySession: approvalsCatalog.setPendingQuestionsBySession,
      },
    }),
    onGlobalEvent: handleActivityEvent,
    refreshSessions: project.refreshSessions,
    refreshSessionStatuses: project.refreshSessionStatuses,
    refreshPendingInteractions: project.refreshPendingInteractions,
    refreshMessages: inbox.refreshMessages,
    refreshLiveMessages: (sessionId) => {
      const messageId = transcript.liveTranscriptMessageId(sessionId);
      return messageId ? inbox.refreshMessages(sessionId, true, { messageId }) : Promise.resolve();
    },
    refreshSessionDiff: project.refreshSessionDiff,
    refreshSessionTodos: project.refreshSessionTodos,
    beginHydration: transcript.beginHydration,
    hasMessages: (id) => transcript.readDisplayedSession(id).length > 0,
    refreshVcsDiff: project.refreshVcsDiff,
  });

  useOpencodeProviderEffects({
    active: input.visible,
    ...domain,
    client,
    isCurrentClient,
    ensureActiveSession: sessionNavigation.ensureActiveSession,
    setPromptError: prompt.setPromptError,
    conversationSessionId,
    pruneTranscript: transcript.prune,
  });

  const { activeSession, currentSessionValue, sessionLibraryValue } = useSessionPresentation({
    ...domain, ...sessionNavigation, ...sessionCreation, ...sessionEditing, ...sessionActions,
    activeSessions, refreshActiveSessions: catalog.refresh, refreshSessions: project.refreshSessions,
  });
  const chatValue = useChatPresentation({
    ...domain, ...transcript, ...project, ...sessionActions, ...interactions, ...capabilities, ...prompt,
    activeSession,
    transcriptReadError: state.currentSessionId ? transcriptRead.errors[state.currentSessionId] : undefined,
    retryTranscript, pendingPromptsBySession: inbox.pendingPromptsBySession, pendingNoticesBySession: inbox.pendingNoticesBySession,
    cancelPrompt: inbox.cancelPrompt,
  });

  const capabilitiesValue = useCapabilitiesPresentation(serverData, capabilities);
  const { projectsValue, projectFilesValue } = useProjectPresentation({ ...domain, ...project, ...worktree });
  const conversationValue = useMemo<WorkspaceValues['conversationValue']>(() => ({
    conversation, clearConversationFeedback, toggleConversationMode,
  }), [conversation, clearConversationFeedback, toggleConversationMode]);
  const values = useMemo<WorkspaceValues>(() => ({
    capabilitiesValue, projectsValue, projectFilesValue,
    currentSessionValue, sessionLibraryValue, chatValue, conversationValue,
  }), [capabilitiesValue, projectsValue, projectFilesValue,
    currentSessionValue, sessionLibraryValue, chatValue, conversationValue]);

  const suspend = useCallback(() => {
    scopeGenerationRef.current++; serverGenerationRef.current++;
    refreshQueue.clear();
  }, [refreshQueue, scopeGenerationRef, serverGenerationRef]);
  const busy = prompt.sendingState.active || conversationPhase !== 'off' || state.isBootstrappingChat ||
    state.connection.status === 'connecting' || Boolean(state.mcpAuthPrompt) ||
    Object.values(sessionCatalog.sessionStatuses).some((status) => status.type !== 'idle') ||
    Object.values(approvalsCatalog.pendingPermissionsBySession).some((items) => items.length > 0) ||
    Object.values(approvalsCatalog.pendingQuestionsBySession).some((items) => items.length > 0) ||
    pendingSessionIds.length > 0 || hasTerminal;
  const boundDirectory = state.activeProjectPath;
  const snapshot = useMemo<WorkspaceSnapshot>(() => ({ boundDirectory, revision: input.connection.revision, enabled: input.connection.enabled, values, busy, suspend, catalogClient, catalogSessions: catalog.sessions, catalogStatuses: catalog.statuses,
    loadProjectCatalog: project.loadProjectCatalog,
    native: { settings: state.settings, catalogClient, contract: state.serverContract, isCurrentCatalogClient,
      connectionScope: state.connectionScope, sessions: sessionCatalog.sessions,
      activeSessions, todoRecordsBySession: transcript.todoRecordsBySession,
      todosBySession: diffCatalog.todosBySession, isStreamConnected },
  }), [boundDirectory, input.connection.revision, input.connection.enabled, values, busy, suspend, catalogClient, catalog.sessions, catalog.statuses, project.loadProjectCatalog,
    state.settings, state.serverContract, isCurrentCatalogClient, state.connectionScope,
    sessionCatalog.sessions, activeSessions, transcript.todoRecordsBySession, diffCatalog.todosBySession, isStreamConnected]);
  useLayoutEffect(() => { publish(key, snapshot); }, [key, publish, snapshot]);
  useLayoutEffect(() => () => forget(key), [forget, key]);
  return null;
});
