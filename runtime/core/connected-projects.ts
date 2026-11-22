import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { workspaceKey } from '@/shared/contracts/workspace';

import { useAppCore, useAppStore } from './context';
import { useConnectionLifecycles } from './workspace-selectors';

// Enumerate the project Query partitions on connected servers. A placeholder
// and an explicit workspace can resolve to the same directory and Query key.
export function useConnectedProjectScopes(visible = true) {
  const { connections: managers } = useAppCore();
  const connections = useAppStore((state) => state.registry.connections);
  const lifecycles = useConnectionLifecycles();
  const directories = useAppStore(useShallow(({ registry, selection }) => Object.fromEntries(visible
    ? registry.connections.flatMap((entry) => entry.projects.map((projectPath) => {
      const key = workspaceKey({ connectionId: entry.id, projectPath });
      return [key, selection[key]?.activeProjectPath ?? projectPath];
    })) : [])));
  const servers = useMemo(() => visible ? connections.flatMap((entry) => {
    if (!entry.enabled || lifecycles.get(entry.id)?.connection.status !== 'connected') return [];
    const manager = managers.get(entry.id);
    const client = manager?.getCatalogClient();
    if (!manager || !client) return [];
    const identity = { connectionId: entry.id, connectionScope: getConnectionScope(entry.settings), authRevision: entry.authRevision ?? 0 };
    const seen = new Set<string>();
    const projects = entry.projects.flatMap((projectPath) => {
      const scopeKey = workspaceKey({ connectionId: entry.id, projectPath });
      const directory = directories[scopeKey] ?? projectPath;
      const queryDirectory = directory.trim();
      if (seen.has(queryDirectory)) return [];
      const projectClient = manager.getProjectClient(directory, entry);
      if (!projectClient) return [];
      seen.add(queryDirectory);
      return [{ scopeKey, directory, identity, client: projectClient }];
    });
    return [{ entry, identity, client, projects }];
  }) : [], [connections, directories, lifecycles, managers, visible]);
  return { connections, lifecycles, servers };
}
