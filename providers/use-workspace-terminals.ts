import { useCallback, useMemo } from 'react';
import { useWorkspaces } from '@/providers/workspace-context';
import type { ConnectionRecord, WorkspaceSnapshot, WorkspaceTarget } from '@/providers/workspace-types';

export function workspaceTerminals(connections: ConnectionRecord[], snapshots: Record<string, WorkspaceSnapshot>) {
  const rows = new Map<string, { key: string; connectionId: string; projectPath: string; serverName?: string;
    terminal: WorkspaceSnapshot['values']['terminalValue']['terminals'][number]; actions: WorkspaceSnapshot['values']['terminalValue'] }>();
  for (const [key, runtime] of Object.entries(snapshots)) {
    const [connectionId, path] = JSON.parse(key) as [string, string];
    const server = connections.find((entry) => entry.id === connectionId);
    if (!server) continue;
    const projectPath = path || runtime.values.projectsValue.activeProjectPath || '';
    const serverName = connections.filter((entry) => entry.name === server.name).length > 1
      ? `${server.name} · ${new URL(server.settings.serverUrl).host}` : server.name;
    for (const terminal of runtime.values.terminalValue.terminals) {
      const identity = JSON.stringify([connectionId, terminal.id]);
      // Some servers return all PTYs for each directory; prefer their owning workspace.
      if (!rows.has(identity) || projectPath === terminal.cwd) rows.set(identity, { key, connectionId, projectPath, serverName, terminal, actions: runtime.values.terminalValue });
    }
  }
  return [...rows.values()];
}

export function useWorkspaceTerminals() {
  const { connectedWorkspace, selectTerminalTarget, connections, snapshots } = useWorkspaces();
  const terminals = useMemo(() => workspaceTerminals(connections, snapshots), [connections, snapshots]);
  const create = useCallback(async (target: WorkspaceTarget) => {
    const runtime = await connectedWorkspace(target);
    const terminal = await runtime.values.terminalValue.createTerminal();
    await selectTerminalTarget(target);
    return terminal;
  }, [connectedWorkspace, selectTerminalTarget]);
  return { create, terminals };
}
