import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { useWorkspaceRuntimeState } from '@/runtime/workspace/use-workspace-runtime-state';
import type { Session } from '@/shared/protocol/opencode/types';
import type { FileDiff, Todo } from '@/shared/protocol/opencode/types';
import type { ApprovalsCatalog } from '@/features/sessions/runtime';
import type { MessagesBySession } from '@/features/chat/runtime';

type ResetInput = {
  state: ReturnType<typeof useWorkspaceRuntimeState>;
  resetTerminal: () => void;
  resetTranscript: () => void;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setMessagesBySession: Dispatch<SetStateAction<MessagesBySession>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setVcsDiffsByScope: Dispatch<SetStateAction<Record<'uncommitted' | 'branch', FileDiff[]>>>;
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
  setMessagesBySession,
  setDiffsBySession,
  setTodosBySession,
  setVcsDiffsByScope,
  setPendingPermissionsBySession,
  setPendingQuestionsBySession,
}: ResetInput) {
  const {
    cancelBootstrap,
    busyNotificationsRef,
    sessionRefreshTimeoutsRef,
    sessionRefreshOptionsRef,
    explicitSessionSelectionRef,
    locallyCreatedSessionsRef,
    setCurrentSessionId,
    setMcpAuthPrompt,
  } = state;

  return useCallback(() => {
    cancelBootstrap();
    busyNotificationsRef.current.clear();
    Object.values(sessionRefreshTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
    sessionRefreshTimeoutsRef.current = {};
    sessionRefreshOptionsRef.current = {};
    explicitSessionSelectionRef.current = undefined;
    locallyCreatedSessionsRef.current.clear();
    setCurrentSessionId(undefined);
    setSessions([]);
    setMessagesBySession({});
    setDiffsBySession({});
    setTodosBySession({});
    setVcsDiffsByScope({ uncommitted: [], branch: [] });
    resetTranscript();
    setPendingPermissionsBySession({});
    setPendingQuestionsBySession({});
    setMcpAuthPrompt(undefined);
    resetTerminal();
  }, [
    resetTerminal,
    resetTranscript,
    cancelBootstrap,
    busyNotificationsRef,
    sessionRefreshOptionsRef,
    sessionRefreshTimeoutsRef,
    explicitSessionSelectionRef,
    locallyCreatedSessionsRef,
    setCurrentSessionId,
    setMcpAuthPrompt,
    setPendingPermissionsBySession,
    setPendingQuestionsBySession,
    setSessions,
    setMessagesBySession,
    setDiffsBySession,
    setTodosBySession,
    setVcsDiffsByScope,
  ]);
}
