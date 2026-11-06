import { useCallback, useMemo } from 'react';
import { buildClient, withReadSignal } from '@/shared/protocol/opencode/client';
import { resolveProjectLocation } from '@/shared/protocol/services/session-service';
import { listDirectoryNames } from '@/features/projects/services/project-service';
import { useWorkspaces } from '@/runtime/workspace';
import { buildWorkspaceProjectGroups } from '@/features/projects/model/workspace-project-groups';

// Project rows come from the server catalog only. The app keeps no opened or
// closed list: every server project is selectable, and closing is a no-op
// because there is no local entry to remove.
export function useWorkspaceProjects() {
  const registry = useWorkspaces();
  const { connections, snapshots, ensure, restoreProject } = registry;
  const groups = useMemo(() => {
    const contractByConnection = new Map<string, 'v1' | 'v2'>();
    for (const [key, snapshot] of Object.entries(snapshots)) {
      const [connectionId] = JSON.parse(key) as string[];
      contractByConnection.set(connectionId, snapshot.values.connectionValue.serverCapabilities.contract);
    }
    return buildWorkspaceProjectGroups(connections, snapshots).map((group) => ({
      ...group,
      contract: contractByConnection.get(group.id) ?? 'v2',
    }));
  }, [connections, snapshots]);
  const add = useCallback(async (connectionId: string, directory: string) => {
    const entry = connections.find((item) => item.id === connectionId);
    if (!entry?.enabled) throw new Error('Connect this server first.');
    const path = directory.trim();
    if (!path) throw new Error('Enter a project directory.');
    const contract = Object.entries(snapshots).find(([key]) => (JSON.parse(key) as string[])[0] === connectionId)?.[1].values.connectionValue.serverCapabilities.contract ?? 'v2';
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
  }, [connections, snapshots, ensure, restoreProject]);
  const listDirectories = useCallback(async (connectionId: string, basePath: string, path: string, signal?: AbortSignal) => {
    const entry = connections.find((item) => item.id === connectionId);
    if (!entry?.enabled) throw new Error('Connect this server first.');
    if (!path.trim()) throw new Error('Enter a folder on the OpenCode server.');
    const contract = Object.entries(snapshots).find(([key]) => (JSON.parse(key) as string[])[0] === connectionId)?.[1].values.connectionValue.serverCapabilities.contract ?? 'v2';
    // V2 lists an absolute path without leaving the stable add-session
    // location, so browsing cannot register each visited folder as a project.
    // V1 has no absolute listing, so it keeps the scoped directory.
    const base = basePath.trim() || path;
    const client = buildClient({ ...entry.settings, directory: contract === 'v1' ? path : base }, contract);
    const names = await listDirectoryNames(signal ? withReadSignal(client, signal) : client, contract === 'v1' ? '' : path);
    return names;
  }, [connections, snapshots]);
  const options = useMemo(() => groups.flatMap((group) => group.projects.map((project) => ({
    ...project, connectionId: group.id, serverName: group.name,
  }))), [groups]);
  return { groups, options, add, listDirectories };
}
