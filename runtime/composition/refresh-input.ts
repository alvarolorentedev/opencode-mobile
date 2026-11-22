import type { ProjectActionsInput } from '@/features/projects/index';

export type ProjectRefreshInput = Pick<ProjectActionsInput,
  'client' | 'isCurrentClient' | 'setIsRefreshingDiffs' | 'setDiffsBySession' | 'setVcsDiffsByScope' |
  'setTodosBySession' | 'setDiffScopeBySession' | 'setSelectedDiffMessageBySession' |
  'readPinnedDiffMessage' | 'readDiffScope' | 'currentSessionIdRef' | 'readDisplayedSession' |
  'connectionScope' | 'refreshMessages'>;
