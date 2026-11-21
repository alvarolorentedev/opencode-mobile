import type { ProjectActionsInput } from '@/features/projects/index';
import { useProjectCatalogActions , useProjectFileActions } from '@/features/projects/runtime';
import { useProjectRefreshActions } from '@/runtime/workspace/use-project-refresh-actions';

import { hydrateSessionCache } from '@/features/sessions/runtime';
import { mergeSessionStatuses } from '@/features/sessions/runtime';
import type { SessionStatus } from '@/shared/protocol/opencode/types';

export function useProjectActions(input: ProjectActionsInput) {
  // Hydration seeds the connection-wide status map; it must merge with the
  // other projects' rows instead of replacing them on a project switch.
  const mergeHydratedStatuses: typeof input.setSessionStatuses = (value) => {
    input.setSessionStatuses((current) => (
      typeof value === 'function' ? value(current) : mergeSessionStatuses(current, value as Record<string, SessionStatus>)
    ));
  };
  const catalog = useProjectCatalogActions({ ...input, hydrateSessionCache, setSessionStatuses: mergeHydratedStatuses });
  const refresh = useProjectRefreshActions(input);
  const files = useProjectFileActions({ ...input, refreshVcsDiff: refresh.refreshVcsDiff });
  return { ...catalog, ...refresh, ...files };
}
