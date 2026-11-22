import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceTarget, useAppCore, useWorkspaceDomainValue } from '@/runtime/core';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';

export function useProjects(target?: WorkspaceTarget) {
  const value = useWorkspaceDomainValue((values) => values.projectsValue, 'useProjects', target);
  const connectionId = useActiveWorkspaceTarget(target)?.connectionId;
  const { activate } = useAppCore().commands.workspace;
  const selectProject = useCallback((projectPath: string) => {
    if (connectionId) void activate({ connectionId, projectPath });
  }, [activate, connectionId]);
  return useMemo(() => ({ ...value, selectProject }), [selectProject, value]);
}

export const useProjectFiles = () => useWorkspaceDomainValue((values) => values.projectFilesValue, 'useProjectFiles');
