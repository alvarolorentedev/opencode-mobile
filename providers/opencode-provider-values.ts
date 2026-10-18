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
import { MESSAGE_WINDOW_CAP } from '@/providers/use-transcript-state';
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
    diagnostics,
    currentConfig,
    availableProviders,
    providerAuthMethodsById,
    availableModels,
    availableAgents,
    configureProvider,
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
    currentProjectPath,
    serverRootPath,
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
    removeProject,
    openProjectFile,
    saveProjectFile,
    worktrees,
    refreshWorktrees,
    createWorktree,
    resetWorktree,
    removeWorktree,
    sessions,
    archivedSessions,
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
    archiveSession,
    restoreSession,
    refreshArchivedSessions,
    renameSession,
    forkSession,
    shareSession,
    unshareSession,
    revertSession,
    unrevertSession,
    openSessionInProject,
    activeSessions,
    refreshActiveSessions,
    setActiveSessionsVisible,
    messagesBySession,
    pendingPromptsBySession,
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
    isRefreshingSessions,
    isRefreshingMessages,
    isRefreshingDiffs,
    isBootstrappingChat,
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
    terminalShells,
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
    setMcpServerEnabled,
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
    return turns.map((record, index) => {
      const textPart = record.parts.find((part) => part.type === 'text');
      const preview = textPart && textPart.type === 'text' ? textPart.text.replace(/\s+/g, ' ').trim() : '';
      return { id: record.info.id, label: `Turn ${index + 1}`, preview: preview ? preview.slice(0, 80) : undefined };
    });
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
      !!currentSessionId && !!messageWindows[currentSessionId] && !messageWindows[currentSessionId].hasMore && currentMessages.length < MESSAGE_WINDOW_CAP),
    [activeSession, currentMessages.length, currentSessionId, messageWindows, usageStepsBySession, usagePricingByModel],
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
    () => ({ diagnostics, refreshDiagnostics, eventStreamStatus }),
    [diagnostics, refreshDiagnostics, eventStreamStatus],
  );

  const capabilitiesValue = useMemo<CapabilitiesContextValue>(
    () => ({ currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, configureProvider, setProviderAuth, removeProvider, providerOAuth: { start: startProviderOAuth, complete: completeProviderOAuth, completeAutomatic: completeAutomaticProviderOAuth, cancel: cancelProviderOAuth }, providerAccounts: { add: addProviderAccount, activate: activateProviderAccount, remove: removeProviderAccount } }),
    [currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, configureProvider, setProviderAuth, removeProvider, startProviderOAuth, completeProviderOAuth, completeAutomaticProviderOAuth, cancelProviderOAuth, addProviderAccount, activateProviderAccount, removeProviderAccount],
  );

  const preferencesValue = useMemo<PreferencesContextValue>(
    () => ({ chatPreferences, updateChatPreferences }),
    [chatPreferences, updateChatPreferences],
  );

  const projectsValue = useMemo<ProjectsContextValue>(
    () => ({ projects, activeProjectPath, activeProject, selectProject, addProject, removeProject, currentProjectPath, serverRootPath, isRefreshingProjectCatalog, refreshProjectCatalog, refreshProjectStatus: refreshServerFeatures }),
    [projects, activeProjectPath, activeProject, selectProject, addProject, removeProject, currentProjectPath, serverRootPath, isRefreshingProjectCatalog, refreshProjectCatalog, refreshServerFeatures],
  );

  const projectFilesValue = useMemo<ProjectFilesContextValue>(
    () => ({ browser, projectFileStatuses, selectedProjectFile, vcsInfo, openProjectFile, saveProjectFile, worktrees, refreshWorktrees, createWorktree, resetWorktree, removeWorktree }),
    [browser, projectFileStatuses, selectedProjectFile, vcsInfo, openProjectFile, saveProjectFile, worktrees, refreshWorktrees, createWorktree, resetWorktree, removeWorktree],
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
    () => ({ sessions, archivedSessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, sessionPreviewById, isRefreshingSessions, refreshSessions, deleteSession, archiveSession, restoreSession, refreshArchivedSessions, renameSession, forkSession, shareSession, unshareSession, revertSession, unrevertSession, openSessionInProject }),
    [sessions, archivedSessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, sessionPreviewById, isRefreshingSessions, refreshSessions, deleteSession, archiveSession, restoreSession, refreshArchivedSessions, renameSession, forkSession, shareSession, unshareSession, revertSession, unrevertSession, openSessionInProject],
  );

  const hasOlderMessages = currentSessionId ? messageWindows[currentSessionId]?.hasMore === true : false;
  const isLoadingOlderMessages = currentSessionId ? loadingOlderBySession[currentSessionId] === true : false;
  const transcriptPaging = useMemo(
    () => ({ loadOlder: loadOlderMessages, hasOlder: hasOlderMessages, isLoadingOlder: isLoadingOlderMessages }),
    [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages],
  );
  const chatValue = useMemo<ChatContextValue>(
    () => ({ pendingPrompts, currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage, currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs, currentTodos, currentPendingPermissions, currentPendingQuestions, isRefreshingMessages, isRefreshingDiffs, isBootstrappingChat, replyToPermission, replyToQuestion, rejectQuestion, commands, executeCommand, sendPrompt, abortSession, setAutoApprove, sendingState, promptError: visiblePromptError, clearPromptError, transcriptPaging, sharedInput }),
    [pendingPrompts, currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage, currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs, currentTodos, currentPendingPermissions, currentPendingQuestions, isRefreshingMessages, isRefreshingDiffs, isBootstrappingChat, replyToPermission, replyToQuestion, rejectQuestion, commands, executeCommand, sendPrompt, abortSession, setAutoApprove, sendingState, visiblePromptError, clearPromptError, transcriptPaging, sharedInput],
  );

  const conversationValue = useMemo<ConversationContextValue>(
    () => ({ conversation, clearConversationFeedback, toggleConversationMode }),
    [conversation, clearConversationFeedback, toggleConversationMode],
  );

  const terminalValue = useMemo<TerminalContextValue>(
    () => ({ terminals, terminalShells, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal }),
    [terminals, terminalShells, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal],
  );

  const mcpValue = useMemo<McpContextValue>(
    () => ({ mcpStatuses, refreshMcpServers, addMcpServer, connectMcpServer, disconnectMcpServer, setMcpServerEnabled, mcpOAuth }),
    [mcpStatuses, refreshMcpServers, addMcpServer, connectMcpServer, disconnectMcpServer, setMcpServerEnabled, mcpOAuth],
  );

  return {
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
  };
}
