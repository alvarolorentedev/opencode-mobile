import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceTarget, useAppCore, useWorkspaceDomainValue } from '@/runtime/core';

export function useProjects() {
  const value = useWorkspaceDomainValue((values) => values.projectsValue, 'useProjects');
  const connectionId = useActiveWorkspaceTarget()?.connectionId;
  const { activate } = useAppCore().commands.workspace;
  const selectProject = useCallback((projectPath: string) => {
    if (connectionId) void activate({ connectionId, projectPath });
  }, [activate, connectionId]);
  return useMemo(() => ({ ...value, selectProject }), [selectProject, value]);
}

export const useProjectFiles = () => useWorkspaceDomainValue((values) => values.projectFilesValue, 'useProjectFiles');
