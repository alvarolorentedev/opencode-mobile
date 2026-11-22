import { useCallback } from 'react';

import { useChatRefresh } from '@/features/chat/runtime';
import type { ProjectRefreshInput } from '@/runtime/composition/refresh-input';
import type { SessionRefreshCommands } from '@/runtime/core/commands/session';
import type { createProjectRefreshQueue } from '@/runtime/realtime/project-refresh-queue';
import type { SessionRefreshOptions } from '@/shared/protocol/opencode/event-dispatch';

export function useProjectRefreshActions(input: ProjectRefreshInput, session: SessionRefreshCommands, queue: ReturnType<typeof createProjectRefreshQueue>) {
  const { refreshMessages } = input;
  const { refreshSessions, refreshSessionStatuses, refreshPendingInteractions } = session;
  const { refreshSessionDiff, refreshVcsDiff, setDiffScope, selectDiffMessage, refreshDiffs, refreshSessionTodos } = useChatRefresh(input);
  const scheduleSessionRefresh = useCallback((sessionId: string, options?: SessionRefreshOptions) =>
    queue.scheduleSession(sessionId, options, { refreshSessions, refreshMessages, refreshSessionDiff, refreshSessionTodos }),
  [queue, refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions]);
  const scheduleSessionsRefresh = useCallback(() => queue.scheduleCatalog(refreshSessions), [queue, refreshSessions]);

  return {
    refreshSessions, refreshSessionStatuses, refreshSessionDiff, refreshVcsDiff, setDiffScope, selectDiffMessage, refreshDiffs,
    refreshSessionTodos, refreshPendingInteractions, scheduleSessionRefresh, scheduleSessionsRefresh,
  };
}
