import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useProjectScope } from '@/runtime/core';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { combineProjectCatalog } from '@/shared/protocol/services/session-service';

import { buildOpencodeProjects, describeWorktrees, resolveActiveProject } from '../model/project-utils';
import { locationOptions, projectsOptions } from '../services/queries/catalog';
import { worktreeOptions } from '../services/queries/files';

export function useProjectInventory(target?: WorkspaceTarget) {
  const { identity, client } = useProjectScope(target);
  const activeProjectPath = client.__opencode.directory || undefined;
  const { data: projects, isFetching: checkingProjects } = useQuery({ ...projectsOptions(identity, client), enabled: false });
  const { data: location, isFetching: checkingLocation } = useQuery({ ...locationOptions(identity, client), enabled: false });
  const { data: worktreeData } = useQuery({ ...worktreeOptions(identity, client), enabled: false });
  const isRefreshingProjectCatalog = checkingProjects || checkingLocation;
  return useMemo(() => {
    const serverProjects = projects && location ? combineProjectCatalog(client, projects, location).serverProjects : [];
    const catalog = buildOpencodeProjects(serverProjects);
    const worktrees = describeWorktrees(worktreeData, serverProjects);
    const activeProject = resolveActiveProject(catalog, activeProjectPath, worktrees) ?? (activeProjectPath
      ? { path: activeProjectPath, label: activeProjectPath.split('/').filter(Boolean).pop() || activeProjectPath } : undefined);
    return { projects: catalog, activeProjectPath, activeProject, isRefreshingProjectCatalog };
  }, [activeProjectPath, client, isRefreshingProjectCatalog, location, projects, worktreeData]);
}
