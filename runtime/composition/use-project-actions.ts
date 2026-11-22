import type { ProjectActionsInput } from '@/features/projects/index';
import { useProjectCatalogActions , useProjectFileActions } from '@/features/projects/runtime';
import { useProjectRefreshActions } from '@/runtime/workspace/use-project-refresh-actions';
import type { SessionRefreshCommands } from '@/runtime/core/commands/session';

export function useProjectActions(input: ProjectActionsInput, session: SessionRefreshCommands) {
  const catalog = useProjectCatalogActions(input);
  const refresh = useProjectRefreshActions(input, session);
  const files = useProjectFileActions({ ...input, refreshVcsDiff: refresh.refreshVcsDiff });
  return { ...catalog, ...refresh, ...files };
}
