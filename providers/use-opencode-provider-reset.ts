import { useCallback } from 'react';

import type { useWorkspaceRuntimeState } from '@/providers/use-workspace-runtime-state';

type ResetInput = {
  state: ReturnType<typeof useWorkspaceRuntimeState>;
  resetMcpState: () => void;
  resetPermissionRules: () => void;
  resetTerminal: () => void;
  resetTranscript: () => void;
  resetWorktrees: () => void;
};

// Connection switches must discard every value scoped to the previous server
// before a new generation starts serving reads.
export function useOpencodeProviderReset({
  state,
  resetMcpState,
  resetPermissionRules,
  resetTerminal,
  resetTranscript,
  resetWorktrees,
}: ResetInput) {
  const {
    bootstrapPromiseRef,
    bootstrapTokenRef,
    busyNotificationsRef,
    suppressedPendingRequestIdsRef,
    sessionRefreshTimeoutsRef,
    sessionRefreshOptionsRef,
    currentSessionIdRef,
    explicitSessionSelectionRef,
    locallyCreatedSessionsRef,
    setCurrentSessionId,
    setSessions,
    setSessionStatuses,
    setCommands,
    setCurrentConfig,
    setAvailableProviders,
    setProviderAuthMethodsById,
    setAvailableModels,
    setAvailableAgents,
    setPendingPermissionsBySession,
    setPendingQuestionsBySession,
    setMcpAuthPrompt,
    setProjectFileStatuses,
    setSelectedProjectFile,
    setVcsInfo,
  } = state;

  return useCallback(() => {
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
  }, [
    resetMcpState,
    resetPermissionRules,
    resetTerminal,
    resetTranscript,
    resetWorktrees,
    bootstrapPromiseRef,
    bootstrapTokenRef,
    busyNotificationsRef,
    suppressedPendingRequestIdsRef,
    sessionRefreshOptionsRef,
    sessionRefreshTimeoutsRef,
    currentSessionIdRef,
    explicitSessionSelectionRef,
    locallyCreatedSessionsRef,
    setAvailableAgents,
    setAvailableModels,
    setAvailableProviders,
    setCommands,
    setCurrentConfig,
    setCurrentSessionId,
    setMcpAuthPrompt,
    setPendingPermissionsBySession,
    setPendingQuestionsBySession,
    setProviderAuthMethodsById,
    setSelectedProjectFile,
    setSessionStatuses,
    setSessions,
    setVcsInfo,
    setProjectFileStatuses,
  ]);
}
