import type { ConnectionRecord, WorkspaceTarget } from '@/shared/contracts/workspace';
import type { WorkspaceSnapshot } from '@/runtime/workspace/workspace-types';

function workspacePath(key: string): string {
  try {
    const parsed = JSON.parse(key);
    return Array.isArray(parsed) && typeof parsed[1] === 'string' ? parsed[1] : '';
  } catch {
    return '';
  }
}

function connectedSnapshots(snapshots: Record<string, WorkspaceSnapshot>) {
  const byConnection = new Map<string, { projectPath: string; snapshot: WorkspaceSnapshot }[]>();
  for (const [key, snapshot] of Object.entries(snapshots)) {
    if (snapshot.values.connectionValue.connection.status !== 'connected') continue;
    let connectionId: string;
    try {
      const parsed = JSON.parse(key);
      if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') continue;
      connectionId = parsed[0];
    } catch {
      continue;
    }
    const rows = byConnection.get(connectionId);
    const row = { projectPath: workspacePath(key), snapshot };
    if (rows) rows.push(row);
    else byConnection.set(connectionId, [row]);
  }
  return byConnection;
}

// Automatic failover target: the preferred connection when it is still healthy,
// then the first enabled connection with a live connected runtime.
export function connectedWorkspaceTarget(
  connections: ConnectionRecord[],
  snapshots: Record<string, WorkspaceSnapshot>,
  options: { excludedConnectionId?: string; preferredConnectionId?: string } = {},
): WorkspaceTarget | undefined {
  const flowing = connectedSnapshots(snapshots);
  const ordered = [...connections].sort((a, b) => Number(b.id === options.preferredConnectionId) - Number(a.id === options.preferredConnectionId));
  for (const entry of ordered) {
    if (!entry.enabled || entry.id === options.excludedConnectionId) continue;
    const [candidate] = flowing.get(entry.id) ?? [];
    if (!candidate) continue;
    return {
      connectionId: entry.id,
      projectPath: candidate.snapshot.values.projectsValue.activeProjectPath || candidate.projectPath,
    };
  }
  return undefined;
}
