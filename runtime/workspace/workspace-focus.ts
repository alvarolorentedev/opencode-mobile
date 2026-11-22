import type { ConnectionState } from '@/features/connections/index';
import type { AppState } from '@/runtime/core/store';
import { workspaceKey, type ConnectionRecord, type WorkspaceTarget } from '@/shared/contracts/workspace';

export function connectedWorkspaceTarget(
  entries: ConnectionRecord[],
  selection: AppState['selection'],
  readConnection: (id: string) => ConnectionState | undefined,
  options: { excludedConnectionId?: string; preferredConnectionId?: string } = {},
): WorkspaceTarget | undefined {
  const ordered = [...entries].sort((a, b) => Number(b.id === options.preferredConnectionId) - Number(a.id === options.preferredConnectionId));
  for (const entry of ordered) {
    if (!entry.enabled || entry.id === options.excludedConnectionId || readConnection(entry.id)?.status !== 'connected') continue;
    const target = { connectionId: entry.id, projectPath: entry.projects[0] ?? '' };
    return { ...target, projectPath: selection[workspaceKey(target)]?.activeProjectPath ?? target.projectPath };
  }
}
