import type { ProjectActionsInput } from '@/features/projects/index';

export type ProjectRefreshInput = Pick<ProjectActionsInput,
  'activeProjectPath' | 'client' | 'isCurrentClient' | 'setSessions' | 'sessionsRef' | 'setSessionStatuses' |
  'recentlyCreatedSessionIds' | 'setIsRefreshingDiffs' | 'setDiffsBySession' | 'setVcsDiffsByScope' |
  'setTodosBySession' | 'setPendingPermissionsBySession' | 'setPendingQuestionsBySession' |
  'isPermissionReplyPending' | 'setDiffScopeBySession' | 'setSelectedDiffMessageBySession' |
  'readPinnedDiffMessage' | 'readDiffScope' | 'currentSessionIdRef' | 'readDisplayedSession' |
  'sessionRefreshTimeoutsRef' | 'sessionRefreshOptionsRef' | 'connectionScope' | 'refreshMessages'>;
