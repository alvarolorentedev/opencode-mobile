import { useCallback, useMemo } from 'react';
import { buildClient, withReadSignal } from '@/shared/protocol/opencode/client';
import { resolveProjectLocation } from '@/shared/protocol/services/session-service';
import { listFiles } from '@/features/projects/services/project-service';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { useWorkspaces } from '@/runtime/workspace';
import { buildWorkspaceProjectGroups } from '@/features/projects/model/workspace-project-groups';
export function useWorkspaceProjects() {
  const registry = useWorkspaces();
  const { connections, snapshots, ensure, closeProjects, projectPathsByConnection } = registry;
  const groups = useMemo(() => {
    const opened = new Map<string, Set<string> | undefined>();
    for (const entry of connections) {
      const paths = projectPathsByConnection[getConnectionScope(entry.settings)];
      opened.set(entry.id, paths ? new Set(paths) : undefined);
    }
    const visibleSnapshots = Object.fromEntries(Object.entries(snapshots).filter(([key, snapshot]) => {
      const [connectionId, projectPath] = JSON.parse(key) as [string, string];
      const paths = opened.get(connectionId);
      if (!paths) return true;
      const activePath = snapshot.values.projectsValue.activeProjectPath ?? projectPath;
      return paths.has(activePath) || paths.has(projectPath);
    }));
    const contractByConnection = new Map<string, 'v1' | 'v2'>();
    for (const [key, snapshot] of Object.entries(snapshots)) {
      const [connectionId] = JSON.parse(key) as string[];
      contractByConnection.set(connectionId, snapshot.values.connectionValue.serverCapabilities.contract);
    }
    return buildWorkspaceProjectGroups(connections, visibleSnapshots).map((group) => {
      const connection = connections.find((entry) => entry.id === group.id);
      return {
        ...group,
        contract: contractByConnection.get(group.id) ?? 'v2',
        openedPaths: connection ? projectPathsByConnection[getConnectionScope(connection.settings)] ?? [] : [],
      };
    });
  }, [connections, projectPathsByConnection, snapshots]);
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
    return target;
  }, [connections, snapshots, ensure]);
  const listDirectories = useCallback(async (connectionId: string, path: string, signal?: AbortSignal) => {
    const entry = connections.find((item) => item.id === connectionId);
    if (!entry?.enabled) throw new Error('Connect this server first.');
    if (!path.trim()) throw new Error('Enter a folder on the OpenCode server.');
    const contract = Object.entries(snapshots).find(([key]) => (JSON.parse(key) as string[])[0] === connectionId)?.[1].values.connectionValue.serverCapabilities.contract ?? 'v2';
    const client = buildClient({ ...entry.settings, directory: path }, contract);
    const entries = await listFiles(signal ? withReadSignal(client, signal) : client, '');
    return entries.filter((entry) => entry.type === 'directory').map((entry) => entry.name);
  }, [connections, snapshots]);
  const options = useMemo(() => groups.flatMap((group) => group.projects.map((project) => ({
    ...project, connectionId: group.id, serverName: group.name,
  }))), [groups]);
  const remove = useCallback(async (target: { connectionId: string; projectPath: string }) => {
    const project = groups
      .find((group) => group.id === target.connectionId)?.projects
      .find((item) => item.path === target.projectPath || item.checkouts.some((checkout) => checkout.directory === target.projectPath));
    const directories = new Set(project?.checkouts.map((checkout) => checkout.directory) ?? [target.projectPath]);
    // A worktree runtime can outlive the server's worktree inventory. Close it
    // with its owning project so the project row cannot stay opened on a stale
    // checkout.
    const roots = new Set([target.projectPath, ...directories]);
    for (const [key, snapshot] of Object.entries(snapshots)) {
      const [connectionId, projectPath] = JSON.parse(key) as [string, string];
      const root = snapshot.values.projectFilesValue.worktrees.project?.root;
      if (connectionId !== target.connectionId || !root || !roots.has(root)) continue;
      directories.add(projectPath);
      const activePath = snapshot.values.projectsValue.activeProjectPath;
      if (activePath) directories.add(activePath);
    }
    await closeProjects([...directories].map((projectPath) => ({ connectionId: target.connectionId, projectPath })));
  }, [closeProjects, groups, snapshots]);
  return { groups, options, add, remove, listDirectories, scopeFor: (id: string) => {
    const entry = connections.find((item) => item.id === id); return entry ? getConnectionScope(entry.settings) : '';
  } };
}
