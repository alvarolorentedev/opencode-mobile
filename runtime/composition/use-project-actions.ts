import type { ProjectActionsInput } from '@/features/projects/index';
import { useProjectCatalogActions } from '@/features/projects/runtime';
import { useProjectRefreshActions } from '@/runtime/workspace/use-project-refresh-actions';
import type { SessionRefreshCommands } from '@/runtime/core/commands/session';
import type { createProjectRefreshQueue } from '@/runtime/realtime/project-refresh-queue';

export function useProjectActions(input: ProjectActionsInput, session: SessionRefreshCommands, queue: ReturnType<typeof createProjectRefreshQueue>) {
  const catalog = useProjectCatalogActions(input);
  const refresh = useProjectRefreshActions(input, session, queue);
  return { ...catalog, ...refresh };
}
