import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceTarget, useAppCore, useProjectScope, useWorkspaceDomainValue } from '@/runtime/core';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useProjectInventory } from './state/use-project-inventory';

export function useProjects(target?: WorkspaceTarget) {
  const actions = useWorkspaceDomainValue((values) => values.projectsValue, 'useProjects', target);
  const { project } = useProjectInventory(useProjectScope(target));
  const connectionId = useActiveWorkspaceTarget(target)?.connectionId;
  const { activate } = useAppCore().commands.workspace;
  const selectProject = useCallback((projectPath: string) => {
    if (connectionId) void activate({ connectionId, projectPath });
  }, [activate, connectionId]);
  return useMemo(() => ({ ...actions, ...project, selectProject }), [actions, project, selectProject]);
}

export const useProjectFiles = () => useWorkspaceDomainValue((values) => values.projectFilesValue, 'useProjectFiles');
