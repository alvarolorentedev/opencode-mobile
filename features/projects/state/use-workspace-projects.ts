import { useCallback, useMemo } from 'react';
import { buildClient } from '@/shared/protocol/opencode/client';
import { resolveProjectLocation } from '@/shared/protocol/services/session-service';
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
    return buildWorkspaceProjectGroups(connections, visibleSnapshots);
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
  const options = useMemo(() => groups.flatMap((group) => group.projects.map((project) => ({
    ...project, connectionId: group.id, serverName: group.name,
  }))), [groups]);
  const remove = useCallback(async (target: { connectionId: string; projectPath: string }) => {
    const project = groups
      .find((group) => group.id === target.connectionId)?.projects
      .find((item) => item.path === target.projectPath || item.checkouts.some((checkout) => checkout.directory === target.projectPath));
    const directories = project?.checkouts.map((checkout) => checkout.directory) ?? [target.projectPath];
    await closeProjects(directories.map((projectPath) => ({ connectionId: target.connectionId, projectPath })));
  }, [closeProjects, groups]);
  return { groups, options, add, remove, scopeFor: (id: string) => {
    const entry = connections.find((item) => item.id === id); return entry ? getConnectionScope(entry.settings) : '';
  } };
}
