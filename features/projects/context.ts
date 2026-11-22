import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useActiveWorkspaceTarget, useAppCore, useProjectScope, useWorkspaceDomainValue } from '@/runtime/core';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useProjectInventory } from './state/use-project-inventory';
import { useProjectFileActions } from './state/use-project-file-actions';
import { useFileClipboard } from './state/use-file-clipboard';
import { fileStatusOptions, vcsInfoOptions } from './services/queries/status';
import { searchProjectFiles } from './services/queries/files';
import { refreshProjectFeatures } from './services/project-status-refresh';
import type { ProjectFilesContextValue } from './model/types';

const EMPTY: ProjectFilesContextValue['projectFileStatuses'] = [];

function useProjectStatusRefresh({ identity, client, isCurrentClient, queryActive }: ReturnType<typeof useProjectScope>) {
  const { queryClient } = useAppCore();
  return useCallback(async () => {
    if (client.__opencode.directory && isCurrentClient(client)) await refreshProjectFeatures(queryClient, identity, client, queryActive);
  }, [client, identity, isCurrentClient, queryActive, queryClient]);
}

export function useProjects(target?: WorkspaceTarget) {
  const actions = useWorkspaceDomainValue((values) => values.projectsValue, 'useProjects', target);
  const scope = useProjectScope(target);
  const { project } = useProjectInventory(scope);
  const refreshProjectStatus = useProjectStatusRefresh(scope);
  const connectionId = useActiveWorkspaceTarget(target)?.connectionId;
  const { activate } = useAppCore().commands.workspace;
  const selectProject = useCallback((projectPath: string) => {
    if (connectionId) void activate({ connectionId, projectPath });
  }, [activate, connectionId]);
  return useMemo(() => ({ ...actions, ...project, selectProject, refreshProjectStatus }), [actions, project, refreshProjectStatus, selectProject]);
}

export function useProjectFileSearch() {
  const { identity, client, isCurrentClient } = useProjectScope();
  const { queryClient } = useAppCore();
  return useCallback(async (query: string) => {
    if (!isCurrentClient(client)) return [];
    const files = await searchProjectFiles(queryClient, identity, client, query);
    return isCurrentClient(client) ? files : [];
  }, [client, identity, isCurrentClient, queryClient]);
}

export function useProjectFiles(): ProjectFilesContextValue {
  const scope = useProjectScope();
  const { identity, client, directory, manager, scopeKey } = scope;
  const { data: projectFileStatuses = EMPTY } = useQuery({ ...fileStatusOptions(identity, client), enabled: false });
  const { data: vcsInfo } = useQuery({ ...vcsInfoOptions(identity, client), enabled: false });
  const refreshServerFeatures = useProjectStatusRefresh(scope);
  const fileClipboard = useFileClipboard();
  const refreshVcsDiff = useCallback((view: 'uncommitted' | 'branch', silent = false) =>
    manager?.realtime.getProjectSources(directory, scopeKey)?.refreshVcsDiff?.(view, silent) ?? Promise.resolve(), [directory, manager, scopeKey]);
  const { browser, selectedProjectFile, openProjectFile, saveProjectFile, closeProjectFile, downloadProjectFile } = useProjectFileActions({
    ...scope, connectionId: identity.connectionId, fileClipboard, refreshServerFeatures, refreshVcsDiff,
  });
  const projectFile = useMemo(() => ({ selected: selectedProjectFile, open: openProjectFile, save: saveProjectFile, close: closeProjectFile, download: downloadProjectFile }),
    [closeProjectFile, downloadProjectFile, openProjectFile, saveProjectFile, selectedProjectFile]);
  return useMemo(() => ({ browser, projectFile, projectFileStatuses, vcsInfo }), [browser, projectFile, projectFileStatuses, vcsInfo]);
}
