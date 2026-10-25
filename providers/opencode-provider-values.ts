import { useMemo } from 'react';

import { deriveTodosFromMessages } from '@/lib/opencode/format';
import { getDiffTurnMessages, resolveDiffTurn } from '@/lib/opencode/transcript';
import { aggregateUsageSteps, getSessionUsage, getLatestAssistantTurnUsage } from '@/lib/opencode/usage';
import { getServerCapabilities } from '@/providers/opencode-capabilities';
import {
  getConfiguredProviders,
  getCurrentPendingRequests,
  getSessionPreviewById,
  getTranscript,
  isPromptErrorVisible,
} from '@/providers/opencode-provider-selectors';
import { collectDescendantSessionIds } from '@/providers/opencode-provider-utils';
import { TRANSCRIPT_PAGE_LIMIT } from '@/providers/services/session-service';
import type {
  ApprovalsContextValue,
  CapabilitiesContextValue,
  ChatContextValue,
  ConnectionContextValue,
  ConversationContextValue,
  CurrentSessionContextValue,
  DiagnosticsContextValue,
  DiffScope,
  DiffTurn,
  McpContextValue,
  OnboardingContextValue,
  PreferencesContextValue,
  ProjectsContextValue,
  SessionLibraryContextValue,
  TerminalContextValue,
  ProjectFilesContextValue,
} from '@/providers/opencode-provider-types';
import type { ProviderValuesInput } from '@/providers/opencode-provider-values-input';

export function useOpencodeProviderValues(input: ProviderValuesInput) {
  const {
    isHydrated,
    onboardingCompleted,
    onboardingActive,
    completeOnboarding,
    startOnboardingReview,
    stopOnboardingReview,
    settings,
    connection,
    connectionProfiles,
    connectSetup,
    updateSettings,
    switchConnection,
    connect,
    eventStreamStatus,
    network,
    reconnect,
    diagnostics,
    currentConfig,
    availableProviders,
    providerAuthMethodsById,
    availableModels,
    availableAgents,
    completeAutomaticProviderOAuth,
    setProviderAuth,
    removeProvider,
    startProviderOAuth,
    completeProviderOAuth,
    cancelProviderOAuth,
    addProviderAccount,
    activateProviderAccount,
    removeProviderAccount,
    setAutoApprove,
    chatPreferences,
    updateChatPreferences,
    projects,
    activeProjectPath,
    activeProject,
    isRefreshingProjectCatalog,
    refreshProjectCatalog,
    refreshServerFeatures,
    refreshDiagnostics,
    browser,
    projectFileStatuses,
    selectedProjectFile,
    vcsInfo,
    selectProject,
    addProject,
    openProjectFile,
    saveProjectFile,
    closeProjectFile,
    downloadProjectFile,
    worktrees,
    refreshWorktrees,
    createWorktree,
    removeWorktree,
    sessions,
    sessionStatuses,
    favoriteSessions,
    toggleFavoriteSession,
    isFavoriteSession,
    clearFavoriteSession,
    currentSessionId,
    refreshSessions,
    openSession,
    ensureActiveSession,
    openDeepLinkSession,
    createSession,
    deleteSession,
    renameSession,
    forkSession,
    revertSession,
    unrevertSession,
    openSessionInProject,
    activeSessions,
    refreshActiveSessions,
    setActiveSessionsVisible,
    messagesBySession,
    pendingPromptsBySession,
    cancelPrompt,
    diffScopeBySession,
    diffsBySession,
    vcsDiffsByScope,
    selectedDiffMessageBySession,
    todosBySession,
    todoRecordsBySession,
    usageStepsBySession,
    messageWindows,
    loadingOlderBySession,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    mcpAuthPrompt,
    dismissMcpAuth,
    savedPermissions,
    refreshSavedPermissions,
    removeSavedPermission,
    sendingState,
    isRefreshingMessages,
    transcriptReadError,
    retryTranscript,
    isRefreshingDiffs,
    isBootstrappingChat,
    hydratingSessionIds,
    commands,
    promptError,
    clearPromptError,
    executeCommand,
    sendPrompt,
    abortSession,
    setDiffScope,
    selectDiffMessage,
    refreshDiffs,
    replyToPermission,
    replyToQuestion,
    rejectQuestion,
    loadOlderMessages,
    conversation,
    clearConversationFeedback,
    toggleConversationMode,
    terminals,
    activeTerminalId,
    terminalRuntime,
    terminalConnection,
    refreshTerminals,
    createTerminal,
    openTerminal,
    sendTerminalInput,
    closeTerminal,
    mcpStatuses,
    refreshMcpServers,
    addMcpServer,
    connectMcpServer,
    disconnectMcpServer,
    mcpOAuth,
    serverContract,
    sharedInput,
    servicesValue,
  } = input;

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId),
    [currentSessionId, sessions],
  );

  const currentMessages = useMemo(
    () => (currentSessionId ? messagesBySession[currentSessionId] || [] : []),
    [currentSessionId, messagesBySession],
  );
  const pendingPrompts = useMemo(() => {
    const delivered = new Set(currentMessages.map((record) => record.info.id));
    return (pendingPromptsBySession?.[currentSessionId ?? ''] ?? []).filter((prompt) => !delivered.has(prompt.id));
  }, [currentMessages, currentSessionId, pendingPromptsBySession]);
  const currentDiffScope = useMemo<DiffScope>(
    () => (currentSessionId ? diffScopeBySession[currentSessionId] ?? 'turn' : 'turn'),
    [currentSessionId, diffScopeBySession],
  );
  const currentDiffs = useMemo(
    () => {
      if (!currentSessionId) {
        return [];
      }
      if (currentDiffScope === 'turn') {
        return diffsBySession[currentSessionId] || [];
      }
      return vcsDiffsByScope[currentDiffScope] || [];
    },
    [currentDiffScope, currentSessionId, diffsBySession, vcsDiffsByScope],
  );
  const diffTurns = useMemo<DiffTurn[]>(() => {
    const turns = getDiffTurnMessages(currentMessages);
    return turns.map((record, index) => ({ id: record.info.id, number: index + 1 }));
  }, [currentMessages]);
  const selectedDiffMessageId = useMemo(
    () => (currentSessionId ? resolveDiffTurn(currentMessages, selectedDiffMessageBySession[currentSessionId]) : undefined),
    [currentMessages, currentSessionId, selectedDiffMessageBySession],
  );
  const currentTodos = useMemo(() => {
    if (!currentSessionId) {
      return [];
    }

    const serverTodos = todosBySession[currentSessionId];
    if (serverContract !== 'v2' && serverTodos !== undefined) {
      return serverTodos;
    }

    const todoRecords = todoRecordsBySession[currentSessionId];
    return todoRecords ? deriveTodosFromMessages(todoRecords) : [];
  }, [currentSessionId, serverContract, todoRecordsBySession, todosBySession]);
  const relatedInteractionSessionIds = useMemo(
    () => collectDescendantSessionIds(sessions, [currentSessionId, sendingState.sessionId]),
    [sessions, currentSessionId, sendingState.sessionId],
  );
  const sessionTitleById = useMemo(
    () => Object.fromEntries(sessions.map((session) => [session.id, session.title || undefined])),
    [sessions],
  );
  const currentPendingPermissions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingPermissionsBySession, relatedInteractionSessionIds)
      .map((request) => ({ ...request, sourceTitle: sessionTitleById[request.sessionID] })),
    [currentSessionId, pendingPermissionsBySession, relatedInteractionSessionIds, sendingState.sessionId, sessionTitleById],
  );
  const currentPendingQuestions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingQuestionsBySession, relatedInteractionSessionIds)
      .map((request) => ({ ...request, sourceTitle: sessionTitleById[request.sessionID] })),
    [currentSessionId, pendingQuestionsBySession, relatedInteractionSessionIds, sendingState.sessionId, sessionTitleById],
  );
  const visiblePromptError = useMemo(
    () => (isPromptErrorVisible(promptError, relatedInteractionSessionIds) && promptError
      ? { ...promptError, sourceTitle: promptError.sessionId ? sessionTitleById[promptError.sessionId] : undefined }
      : undefined),
    [promptError, relatedInteractionSessionIds, sessionTitleById],
  );
  const approvalsValue = useMemo<ApprovalsContextValue>(
    () => ({ approvals: { mcpAuth: mcpAuthPrompt, dismissMcpAuth, savedPermissions, refreshSavedPermissions, removeSavedPermission } }),
    [mcpAuthPrompt, dismissMcpAuth, savedPermissions, refreshSavedPermissions, removeSavedPermission],
  );
  const configuredProviders = useMemo(() => getConfiguredProviders(availableProviders), [availableProviders]);
  const usagePricingByModel = useMemo(
    () => Object.fromEntries(availableModels.flatMap((model) => model.pricing ? [[`${model.providerID}/${model.modelID}`, model.pricing] as const] : [])),
    [availableModels],
  );
  const currentUsage = useMemo(
    () => getSessionUsage(activeSession, aggregateUsageSteps(usageStepsBySession[currentSessionId ?? ''] ?? [], usagePricingByModel),
      !!currentSessionId && !!messageWindows[currentSessionId] && !messageWindows[currentSessionId].hasMore),
    [activeSession, currentSessionId, messageWindows, usageStepsBySession, usagePricingByModel],
  );
  const latestAssistantTurnUsage = useMemo(
    () => getLatestAssistantTurnUsage(currentMessages, usagePricingByModel),
    [currentMessages, usagePricingByModel],
  );
  const currentTranscript = useMemo(() => getTranscript(currentMessages), [currentMessages]);
  const sessionPreviewById = useMemo(() => getSessionPreviewById(messagesBySession), [messagesBySession]);
  const serverCapabilities = useMemo(() => getServerCapabilities(serverContract), [serverContract]);

  const onboardingValue = useMemo<OnboardingContextValue>(
    () => ({ isHydrated, onboardingCompleted, onboardingActive, completeOnboarding, startOnboardingReview, stopOnboardingReview }),
    [isHydrated, onboardingCompleted, onboardingActive, completeOnboarding, startOnboardingReview, stopOnboardingReview],
  );

  const connectionValue = useMemo<ConnectionContextValue>(
    () => ({ connectionProfiles, settings, updateSettings, switchConnection, connection, serverCapabilities, connect, connectSetup, services: servicesValue }),
    [connectionProfiles, settings, updateSettings, switchConnection, connection, serverCapabilities, connect, connectSetup, servicesValue],
  );

  const diagnosticsValue = useMemo<DiagnosticsContextValue>(
    () => ({ diagnostics, refreshDiagnostics, eventStreamStatus, transport: { network, reconnect } }),
    [diagnostics, refreshDiagnostics, eventStreamStatus, network, reconnect],
  );

  const capabilitiesValue = useMemo<CapabilitiesContextValue>(
    () => ({ currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, setProviderAuth, removeProvider, providerOAuth: { start: startProviderOAuth, complete: completeProviderOAuth, completeAutomatic: completeAutomaticProviderOAuth, cancel: cancelProviderOAuth }, providerAccounts: { add: addProviderAccount, activate: activateProviderAccount, remove: removeProviderAccount } }),
    [currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, setProviderAuth, removeProvider, startProviderOAuth, completeProviderOAuth, completeAutomaticProviderOAuth, cancelProviderOAuth, addProviderAccount, activateProviderAccount, removeProviderAccount],
  );

  const preferencesValue = useMemo<PreferencesContextValue>(
    () => ({ chatPreferences, updateChatPreferences }),
    [chatPreferences, updateChatPreferences],
  );

  const projectsValue = useMemo<ProjectsContextValue>(
    () => ({ projects, activeProjectPath, activeProject, selectProject, addProject, isRefreshingProjectCatalog, refreshProjectCatalog, refreshProjectStatus: refreshServerFeatures }),
    [projects, activeProjectPath, activeProject, selectProject, addProject, isRefreshingProjectCatalog, refreshProjectCatalog, refreshServerFeatures],
  );

  const projectFileValue = useMemo(
    () => ({ selected: selectedProjectFile, open: openProjectFile, save: saveProjectFile, close: closeProjectFile, download: downloadProjectFile }),
    [selectedProjectFile, openProjectFile, saveProjectFile, closeProjectFile, downloadProjectFile],
  );
  const projectFilesValue = useMemo<ProjectFilesContextValue>(
    () => ({ browser, projectFileStatuses, projectFile: projectFileValue, vcsInfo, worktrees, refreshWorktrees, createWorktree, removeWorktree }),
    [browser, projectFileStatuses, projectFileValue, vcsInfo, worktrees, refreshWorktrees, createWorktree, removeWorktree],
  );

  const activeSessionsValue = useMemo(
    () => ({ list: activeSessions, refresh: refreshActiveSessions, setVisible: setActiveSessionsVisible }),
    [activeSessions, refreshActiveSessions, setActiveSessionsVisible],
  );
  const currentSessionValue = useMemo<CurrentSessionContextValue>(
    () => ({ currentSessionId, activeSession, activeSessions: activeSessionsValue, ensureActiveSession, openDeepLinkSession, openSession, createSession }),
    [currentSessionId, activeSession, activeSessionsValue, ensureActiveSession, openDeepLinkSession, openSession, createSession],
  );
  const sessionLibraryValue = useMemo<SessionLibraryContextValue>(
    () => ({ sessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, sessionPreviewById, refreshSessions, deleteSession, renameSession, forkSession, revertSession, unrevertSession, openSessionInProject }),
    [sessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, sessionPreviewById, refreshSessions, deleteSession, renameSession, forkSession, revertSession, unrevertSession, openSessionInProject],
  );

  // A cached or retained transcript can paint before any read establishes its
  // paging window. Offer scroll-up so the transcript layer can repair the
  // window, but only once the held records look like a full page.
  const hasOlderMessages = currentSessionId
    ? messageWindows[currentSessionId]
      ? messageWindows[currentSessionId].hasMore
      : currentMessages.length >= TRANSCRIPT_PAGE_LIMIT
    : false;
  const isLoadingOlderMessages = currentSessionId ? loadingOlderBySession[currentSessionId] === true : false;
  // Hydration is session-scoped so switching chats quickly cannot let an older
  // read clear the newer session's skeleton.
  const chatRefreshingMessages = currentSessionId
    ? hydratingSessionIds[currentSessionId] === true
    : isBootstrappingChat || isRefreshingMessages;
  const transcriptPaging = useMemo(
    () => ({ loadOlder: loadOlderMessages, hasOlder: hasOlderMessages, isLoadingOlder: isLoadingOlderMessages }),
    [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages],
  );
  const chatValue = useMemo<ChatContextValue>(
    () => ({ pendingPrompts, cancelPrompt, currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage, currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs, currentTodos, currentPendingPermissions, currentPendingQuestions, isRefreshingMessages: chatRefreshingMessages, transcriptReadError, retryTranscript, isRefreshingDiffs, isBootstrappingChat, replyToPermission, replyToQuestion, rejectQuestion, commands, executeCommand, sendPrompt, abortSession, setAutoApprove, sendingState, promptError: visiblePromptError, clearPromptError, transcriptPaging, sharedInput }),
    [pendingPrompts, cancelPrompt, currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage, currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs, currentTodos, currentPendingPermissions, currentPendingQuestions, chatRefreshingMessages, transcriptReadError, retryTranscript, isRefreshingDiffs, isBootstrappingChat, replyToPermission, replyToQuestion, rejectQuestion, commands, executeCommand, sendPrompt, abortSession, setAutoApprove, sendingState, visiblePromptError, clearPromptError, transcriptPaging, sharedInput],
  );

  const conversationValue = useMemo<ConversationContextValue>(
    () => ({ conversation, clearConversationFeedback, toggleConversationMode }),
    [conversation, clearConversationFeedback, toggleConversationMode],
  );

  const terminalValue = useMemo<TerminalContextValue>(
    () => ({ terminals, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal }),
    [terminals, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal],
  );

  const mcpValue = useMemo<McpContextValue>(
    () => ({ mcpStatuses, refreshMcpServers, addMcpServer, connectMcpServer, disconnectMcpServer, mcpOAuth }),
    [mcpStatuses, refreshMcpServers, addMcpServer, connectMcpServer, disconnectMcpServer, mcpOAuth],
  );

  return useMemo(() => ({
    onboardingValue,
    connectionValue,
    diagnosticsValue,
    capabilitiesValue,
    preferencesValue,
    projectsValue,
    projectFilesValue,
    currentSessionValue,
    sessionLibraryValue,
    chatValue,
    approvalsValue,
    conversationValue,
    terminalValue,
    mcpValue,
  }), [onboardingValue, connectionValue, diagnosticsValue, capabilitiesValue, preferencesValue, projectsValue,
    projectFilesValue, currentSessionValue, sessionLibraryValue, chatValue, approvalsValue, conversationValue, terminalValue, mcpValue]);
}
