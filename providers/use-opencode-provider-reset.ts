import { useCallback } from 'react';

import type { useWorkspaceRuntimeState } from '@/providers/use-workspace-runtime-state';

type ResetInput = {
  state: ReturnType<typeof useWorkspaceRuntimeState>;
  resetTerminal: () => void;
  resetTranscript: () => void;
};

// Connection switches must discard every value scoped to the previous server
// before a new generation starts serving reads.
export function useOpencodeProviderReset({
  state,
  resetTerminal,
  resetTranscript,
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
                setPendingPermissionsBySession,
    setPendingQuestionsBySession,
    setMcpAuthPrompt,
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
    setPendingPermissionsBySession({});
    setPendingQuestionsBySession({});
    setMcpAuthPrompt(undefined);
    resetTerminal();
  }, [
        resetTerminal,
    resetTranscript,
      bootstrapPromiseRef,
    bootstrapTokenRef,
    busyNotificationsRef,
    suppressedPendingRequestIdsRef,
    sessionRefreshOptionsRef,
    sessionRefreshTimeoutsRef,
    currentSessionIdRef,
    explicitSessionSelectionRef,
    locallyCreatedSessionsRef,
              setCurrentSessionId,
    setMcpAuthPrompt,
    setPendingPermissionsBySession,
    setPendingQuestionsBySession,
        setSessionStatuses,
    setSessions,
      ]);
}
