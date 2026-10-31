import type { ProjectActionsInput } from '@/features/projects/index';

export type ProjectRefreshInput = Pick<ProjectActionsInput,
  'activeProjectPath' | 'client' | 'isCurrentClient' | 'setSessions' | 'sessionsRef' | 'setSessionStatuses' |
  'locallyCreatedSessionsRef' | 'setIsRefreshingDiffs' | 'setDiffsBySession' | 'setVcsDiffsByScope' |
  'setTodosBySession' | 'setPendingPermissionsBySession' | 'setPendingQuestionsBySession' |
  'suppressedPendingRequestIdsRef' | 'setDiffScopeBySession' | 'setSelectedDiffMessageBySession' |
  'selectedDiffMessageBySessionRef' | 'diffScopeBySessionRef' | 'currentSessionIdRef' | 'messagesBySessionRef' |
  'sessionRefreshTimeoutsRef' | 'sessionRefreshOptionsRef' | 'connectionScope' | 'refreshMessages'>;
