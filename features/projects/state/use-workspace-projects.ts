import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { buildClient, withReadSignal } from '@/shared/protocol/opencode/client';
import { combineProjectCatalog, resolveProjectLocation } from '@/shared/protocol/services/session-service';
import { useAppCore, useConnectedProjectScopes } from '@/runtime/core';

import { buildOpencodeProjects, describeWorktrees } from '../model/project-utils';
import { buildWorkspaceProjectGroups, type ProjectGroupInventory } from '../model/workspace-project-groups';
import { listDirectoryNames } from '../services/project-service';
import { locationOptions, projectsOptions } from '../services/queries/catalog';
import { worktreeOptions } from '../services/queries/files';
import { vcsInfoOptions } from '../services/queries/status';

// Project rows come from the server catalog only. The app keeps no opened or
// closed list: every server project is selectable, and closing is a no-op
// because there is no local entry to remove.
export function useWorkspaceProjects() {
  const { connections: managers, commands: { workspace: { ensure }, connection: { restoreProject } } } = useAppCore();
  const { connections, lifecycles, servers } = useConnectedProjectScopes();
  const sources = useMemo(() => servers.flatMap(({ projects }, catalogIndex) => projects.map((project) => ({ ...project, catalogIndex }))), [servers]);
  const catalogs = useQueries({ queries: servers.map(({ identity, client }) => ({ ...projectsOptions(identity, client), enabled: false })) });
  const locations = useQueries({ queries: sources.map(({ identity, client }) => ({ ...locationOptions(identity, client), enabled: false })) });
  const worktrees = useQueries({ queries: sources.map(({ identity, client }) => ({ ...worktreeOptions(identity, client), enabled: false })) });
  const vcs = useQueries({ queries: sources.map(({ identity, client }) => ({ ...vcsInfoOptions(identity, client), enabled: false })) });
  const groups = useMemo(() => {
    const inventories = Object.fromEntries(sources.map(({ scopeKey, client, catalogIndex }, index): [string, ProjectGroupInventory] => {
      const remote = catalogs[catalogIndex]?.data;
      const location = locations[index]?.data;
      const projects = remote && location ? combineProjectCatalog(client, remote, location).serverProjects : remote ?? [];
      const checkouts = worktrees[index];
      return [scopeKey, {
        activeProjectPath: client.__opencode.directory || undefined,
        projects: buildOpencodeProjects(projects),
        worktrees: describeWorktrees(checkouts?.data, projects, checkouts?.isFetching, checkouts?.error?.message),
        branch: vcs[index]?.data?.branch,
      }];
    }));
    return buildWorkspaceProjectGroups(connections, inventories, lifecycles);
  }, [catalogs, connections, lifecycles, locations, sources, vcs, worktrees]);
  const add = useCallback(async (connectionId: string, directory: string) => {
    const entry = connections.find((item) => item.id === connectionId);
    if (!entry?.enabled) throw new Error('Connect this server first.');
    const path = directory.trim();
    if (!path) throw new Error('Enter a project directory.');
    const { contract } = managers.getLifecycle(connectionId);
    const client = buildClient({ ...entry.settings, directory: path }, contract);
    const project = await resolveProjectLocation(client).catch((reason: unknown) => {
      if (reason instanceof Error && /\b(400|404)\b/.test(reason.message)) throw new Error('OpenCode could not open that directory. Check the server path.');
      throw reason;
    });
    if (!project.worktree) throw new Error('OpenCode did not return a project path.');
    const target = { connectionId, projectPath: project.directory || path };
    const runtime = await ensure(target);
    if (runtime.native.settings !== entry.settings || !runtime.enabled) throw new Error('The connection changed while adding the project.');
    // Re-adding a path is an explicit restore for a project hidden on this device.
    restoreProject({ connectionId, projectPath: project.worktree });
    return target;
  }, [connections, ensure, managers, restoreProject]);
  const listDirectories = useCallback(async (connectionId: string, basePath: string, path: string, signal?: AbortSignal) => {
    const entry = connections.find((item) => item.id === connectionId);
    if (!entry?.enabled) throw new Error('Connect this server first.');
    if (!path.trim()) throw new Error('Enter a folder on the OpenCode server.');
    const { contract } = managers.getLifecycle(connectionId);
    // V2 lists an absolute path without leaving the stable add-session
    // location, so browsing cannot register each visited folder as a project.
    // V1 has no absolute listing, so it keeps the scoped directory.
    const base = basePath.trim() || path;
    const client = buildClient({ ...entry.settings, directory: contract === 'v1' ? path : base }, contract);
    const names = await listDirectoryNames(signal ? withReadSignal(client, signal) : client, contract === 'v1' ? '' : path);
    return names;
  }, [connections, managers]);
  const options = useMemo(() => groups.flatMap((group) => group.projects.map((project) => ({
    ...project, connectionId: group.id, serverName: group.name,
  }))), [groups]);
  return { groups, options, add, listDirectories };
}
