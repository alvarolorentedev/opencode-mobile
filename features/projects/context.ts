import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceTarget, useAppCore, useWorkspaceDomainValue } from '@/runtime/core';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useProjectInventory } from './state/use-project-inventory';

export function useProjects(target?: WorkspaceTarget) {
  const actions = useWorkspaceDomainValue((values) => values.projectsValue, 'useProjects', target);
  const inventory = useProjectInventory(target);
  const connectionId = useActiveWorkspaceTarget(target)?.connectionId;
  const { activate } = useAppCore().commands.workspace;
  const selectProject = useCallback((projectPath: string) => {
    if (connectionId) void activate({ connectionId, projectPath });
  }, [activate, connectionId]);
  return useMemo(() => ({ ...actions, ...inventory, selectProject }), [actions, inventory, selectProject]);
}

export const useProjectFiles = () => useWorkspaceDomainValue((values) => values.projectFilesValue, 'useProjectFiles');
