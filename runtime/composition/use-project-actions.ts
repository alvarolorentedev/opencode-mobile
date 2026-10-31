import type { ProjectActionsInput } from '@/features/projects/index';
import { useProjectCatalogActions , useProjectFileActions } from '@/features/projects/runtime';
import { useProjectRefreshActions } from '@/runtime/workspace/use-project-refresh-actions';

import { hydrateSessionCache } from '@/features/sessions/runtime';

export function useProjectActions(input: ProjectActionsInput) {
  const catalog = useProjectCatalogActions({ ...input, hydrateSessionCache });
  const refresh = useProjectRefreshActions(input);
  const files = useProjectFileActions({ ...input, refreshVcsDiff: refresh.refreshVcsDiff });
  return { ...catalog, ...refresh, ...files };
}
