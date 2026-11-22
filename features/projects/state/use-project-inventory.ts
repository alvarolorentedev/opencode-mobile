import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { useProjectScope } from '@/runtime/core';
import type { Project } from '@/shared/protocol/opencode/types';
import { combineProjectCatalog } from '@/shared/protocol/services/session-service';

import { buildOpencodeProjects, describeWorktrees, resolveActiveProject } from '../model/project-utils';
import { locationOptions, projectsOptions } from '../services/queries/catalog';
import { worktreeOptions } from '../services/queries/files';

const EMPTY_PROJECTS: Project[] = [];
type ProjectScope = ReturnType<typeof useProjectScope>;

export function useProjectCatalogReads({ identity, client, connected, queryActive }: ProjectScope) {
  const enabled = connected && queryActive;
  const { data: projects, isFetching: checkingProjects } = useQuery({ ...projectsOptions(identity, client), enabled });
  const { data: location, isFetching: checkingLocation } = useQuery({ ...locationOptions(identity, client), enabled });
  const serverProjects = useMemo(() => projects && location
    ? combineProjectCatalog(client, projects, location).serverProjects : EMPTY_PROJECTS, [client, location, projects]);
  return { serverProjects, isRefreshingProjectCatalog: checkingProjects || checkingLocation };
}

export function useProjectInventory(scope: ProjectScope) {
  const { identity, client, connected, queryActive } = scope;
  const activeProjectPath = client.__opencode.directory || undefined;
  const { serverProjects, isRefreshingProjectCatalog } = useProjectCatalogReads(scope);
  const { data: worktreeData, isFetching, error } = useQuery({ ...worktreeOptions(identity, client),
    enabled: connected && queryActive && Boolean(activeProjectPath) });
  const worktrees = useMemo(() => describeWorktrees(worktreeData, serverProjects, isFetching, error?.message),
    [error, isFetching, serverProjects, worktreeData]);
  const project = useMemo(() => {
    const catalog = buildOpencodeProjects(serverProjects);
    const activeProject = resolveActiveProject(catalog, activeProjectPath, worktrees) ?? (activeProjectPath
      ? { path: activeProjectPath, label: activeProjectPath.split('/').filter(Boolean).pop() || activeProjectPath } : undefined);
    return { projects: catalog, activeProjectPath, activeProject, isRefreshingProjectCatalog };
  }, [activeProjectPath, isRefreshingProjectCatalog, serverProjects, worktrees]);
  return { project, serverProjects, worktrees };
}
