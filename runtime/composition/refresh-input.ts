import type { ProjectActionsInput } from '@/features/projects/index';

export type ProjectRefreshInput = Pick<ProjectActionsInput,
  'activeProjectPath' | 'client' | 'isCurrentClient' | 'setSessions' | 'sessionsRef' | 'setSessionStatuses' |
  'locallyCreatedSessionsRef' | 'setIsRefreshingDiffs' | 'setDiffsBySession' | 'setVcsDiffsByScope' |
  'setTodosBySession' | 'setPendingPermissionsBySession' | 'setPendingQuestionsBySession' |
  'suppressedPendingRequestIdsRef' | 'setDiffScopeBySession' | 'setSelectedDiffMessageBySession' |
  'readPinnedDiffMessage' | 'readDiffScope' | 'currentSessionIdRef' | 'readDisplayedSession' |
  'sessionRefreshTimeoutsRef' | 'sessionRefreshOptionsRef' | 'connectionScope' | 'refreshMessages'>;
