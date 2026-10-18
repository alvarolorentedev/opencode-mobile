import type { ProjectActionsInput } from '@/providers/opencode-provider-action-inputs';
import { useProjectCatalogActions } from '@/providers/use-project-catalog-actions';
import { useProjectRefreshActions } from '@/providers/use-project-refresh-actions';
import { useProjectFileActions } from '@/providers/use-project-file-actions';

export function useProjectActions(input: ProjectActionsInput) {
  const catalog = useProjectCatalogActions(input);
  const refresh = useProjectRefreshActions(input);
  const files = useProjectFileActions({ ...input, refreshVcsDiff: refresh.refreshVcsDiff });
  return { ...catalog, ...refresh, ...files };
}
