import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { useWorkspaceRuntimeState } from '@/runtime/workspace/use-workspace-runtime-state';
import type { Session } from '@/shared/protocol/opencode/types';
import type { ApprovalsCatalog } from '@/features/sessions/runtime';

type ResetInput = {
  state: ReturnType<typeof useWorkspaceRuntimeState>;
  resetTerminal: () => void;
  resetTranscript: () => void;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setPendingPermissionsBySession: ApprovalsCatalog['setPendingPermissionsBySession'];
  setPendingQuestionsBySession: ApprovalsCatalog['setPendingQuestionsBySession'];
};

// Connection switches must discard every value scoped to the previous server
// before a new generation starts serving reads. Session statuses are
// connection-scoped and partitioned by the Query keys, so they are not cleared
// here; a project switch must not wipe the other projects' rows.
export function useOpencodeProviderReset({
  state,
  resetTerminal,
  resetTranscript,
  setSessions,
  setPendingPermissionsBySession,
  setPendingQuestionsBySession,
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
        setSessions,
      ]);
}
