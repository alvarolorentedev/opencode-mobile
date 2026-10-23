import { useCallback, useMemo } from 'react';
import { buildClient } from '@/lib/opencode/client';
import { resolveProjectLocation } from '@/providers/services/session-service';
import { getConnectionScope } from '@/lib/connection-scope';
import { useWorkspaces } from '@/providers/workspace-context';
import type { OpencodeProject } from '@/providers/opencode-provider-types';
import type { WorkspaceSnapshot } from '@/providers/workspace-types';
export function useWorkspaceProjects() {
  const registry = useWorkspaces();
  const { connections, snapshots, ensure, closeProject } = registry;
  const groups = useMemo(() => {
    const byConnection = new Map<string, WorkspaceSnapshot[]>();
    for (const [key, value] of Object.entries(registry.snapshots)) {
      const [connectionId] = JSON.parse(key) as [string, string];
      const list = byConnection.get(connectionId);
      if (list) list.push(value);
      else byConnection.set(connectionId, [value]);
    }
    return registry.connections.map((entry) => {
      const runtimes = byConnection.get(entry.id) ?? [];
      const projects = [...new Map(runtimes.flatMap((runtime) => runtime.values.projectsValue.projects).map((project) => [project.path, project])).values()];
      return { id: entry.id, name: entry.name, enabled: entry.enabled, projects, status: runtimes[0]?.values.connectionValue.connection.status ?? 'idle' };
    });
  }, [registry.connections, registry.snapshots]);
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
  const options = useMemo(() => groups.flatMap((group) => group.projects.map((project: OpencodeProject) => ({
    ...project, connectionId: group.id, serverName: group.name,
  }))), [groups]);
  return { groups, options, add, remove: closeProject, scopeFor: (id: string) => {
    const entry = connections.find((item) => item.id === id); return entry ? getConnectionScope(entry.settings) : '';
  } };
}
