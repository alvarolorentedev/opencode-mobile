import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { ProjectActionsInput, ProjectCatalogInput } from '@/features/projects/model/action-inputs';
import { createProjectCatalogActions } from '@/features/projects/services/project-catalog-actions';

export function useProjectCatalogActions({
  identity, client, catalogClient, isCurrentClient, isCurrentCatalogClient, activeProjectPathRef,
  setActiveProjectPath, clearProjectState, scopeGenerationRef, serverContract, settingsRef,
  connected, queryActive, isHydrated,
}: ProjectCatalogInput & Pick<ProjectActionsInput, 'connected' | 'queryActive' | 'isHydrated'>) {
  const cache = useQueryClient();
  const actions = useMemo(() => createProjectCatalogActions(cache, {
    identity, client, catalogClient, isCurrentClient, isCurrentCatalogClient, activeProjectPathRef,
    setActiveProjectPath, clearProjectState, scopeGenerationRef, serverContract, settingsRef,
  }), [activeProjectPathRef, cache, catalogClient, clearProjectState, client, identity, isCurrentCatalogClient, isCurrentClient,
    scopeGenerationRef, serverContract, setActiveProjectPath, settingsRef]);
  const { refreshProjectCatalog } = actions;
  useEffect(() => {
    if (connected && queryActive && isHydrated) void refreshProjectCatalog(true).catch(() => undefined);
  }, [connected, isHydrated, queryActive, refreshProjectCatalog]);
  return actions;
}
