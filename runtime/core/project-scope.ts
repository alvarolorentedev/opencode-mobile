import { usePathname } from 'expo-router';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { workspaceKey, type ConnectionRecord, type WorkspaceTarget } from '@/shared/contracts/workspace';
import { buildClient } from '@/shared/protocol/opencode/client';
import { useQueryForeground } from '@/shared/server-data/client';

import { useAppCore, useAppStore } from './context';
import type { AppState } from './store';
import { useActiveWorkspaceTarget } from './workspace-selectors';

const noSubscription = () => () => {};
const noLifecycle = () => undefined;

export function workspaceReadTarget(pathname: string, { focus, inspectionTarget, terminalTarget }: AppState['registry']) {
  if (pathname === '/service') return undefined;
  if (pathname === '/settings') return inspectionTarget ?? focus;
  if (pathname === '/terminal') return terminalTarget ?? focus;
  return focus;
}

function resolveProjectKey(entry: ConnectionRecord | undefined, target: WorkspaceTarget, selection: AppState['selection']) {
  const exact = workspaceKey(target);
  if (!entry || entry.projects.includes(target.projectPath)) return exact;
  const alias = entry.projects.find((projectPath) =>
    selection[workspaceKey({ connectionId: entry.id, projectPath })]?.activeProjectPath === target.projectPath);
  return alias === undefined ? exact : workspaceKey({ connectionId: entry.id, projectPath: alias });
}

// Resolve a workspace to the same credential partition used by the connection
// manager. A retained project record supplies its local project selection,
// including the default project resolved from the initial empty path.
export function useProjectScope(explicit?: WorkspaceTarget) {
  const target = useActiveWorkspaceTarget(explicit);
  const { connections, store } = useAppCore();
  const pathname = usePathname();
  const foreground = useQueryForeground();
  const entry = useAppStore((state) => state.registry.connections.find(({ id }) => id === target?.connectionId));
  const defaultSettings = useAppStore((state) => state.shell.settings);
  const settings = entry?.settings ?? defaultSettings;
  const connectionId = target?.connectionId ?? '';
  const scopeKey = useAppStore(({ selection }) => target ? resolveProjectKey(entry, target, selection) : workspaceKey({ connectionId: '', projectPath: '' }));
  const directory = useAppStore((state) => state.selection[scopeKey]?.activeProjectPath ?? target?.projectPath ?? '');
  const readTarget = useAppStore(({ registry }) => workspaceReadTarget(pathname, registry));
  const isDemanded = useAppStore(({ selection }) =>
    Boolean(readTarget && readTarget.connectionId === connectionId && resolveProjectKey(entry, readTarget, selection) === scopeKey));
  const readManager = useCallback(() => connections.get(connectionId), [connectionId, connections]);
  const manager = useSyncExternalStore(connections.subscribe, readManager, readManager);
  const lifecycle = useSyncExternalStore(manager?.subscribe ?? noSubscription, manager?.getState ?? noLifecycle, noLifecycle);
  const contract = lifecycle?.contract ?? 'v2';
  const client = useMemo(() => (entry ? manager?.getProjectClient(directory, entry) : undefined)
    ?? buildClient({ ...settings, directory }, contract), [contract, directory, entry, manager, settings]);
  const connectionScope = getConnectionScope(settings);
  const authRevision = entry?.authRevision ?? 0;
  const revision = entry?.revision;
  const identity = useMemo(() => ({ connectionId, connectionScope, authRevision }), [authRevision, connectionId, connectionScope]);
  const isCurrentClient = useCallback((candidate: object) => {
    if (!target || !manager || candidate !== client || connections.get(connectionId) !== manager) return false;
    const current = store.getState();
    const server = current.registry.connections.find(({ id }) => id === connectionId);
    if (server?.enabled !== true || server.settings !== settings || server.revision !== revision
      || (server.authRevision ?? 0) !== authRevision) return false;
    if (resolveProjectKey(server, target, current.selection) !== scopeKey) return false;
    const selectedDirectory = current.selection[scopeKey]?.activeProjectPath ?? target.projectPath;
    return candidate === manager.getProjectClient(selectedDirectory, server);
  }, [authRevision, client, connectionId, connections, manager, revision, scopeKey, settings, store, target]);
  const queryActive = foreground && isDemanded && Boolean(entry?.enabled && manager);
  return { identity, scopeKey, directory, revision, client, isCurrentClient, settings, queryActive, manager };
}
