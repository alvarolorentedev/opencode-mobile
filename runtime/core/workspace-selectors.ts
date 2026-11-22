import { useCallback, useSyncExternalStore } from 'react';
import { useAppCore, useAppStore } from '@/runtime/core/context';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';

export function useActiveWorkspaceTarget(explicit?: WorkspaceTarget) {
  return useAppStore((state) => explicit ?? state.registry.focus);
}

export function useWorkspaceConnectionSettings(explicit?: WorkspaceTarget) {
  return useAppStore(({ registry, shell }) => {
    const target = explicit ?? registry.focus;
    return registry.connections.find(({ id }) => id === target?.connectionId)?.settings ?? shell.settings;
  });
}

export function useConnectionLifecycle(connectionId: string | undefined) {
  const { connections } = useAppCore();
  const read = useCallback(() => connections.getLifecycle(connectionId), [connectionId, connections]);
  return useSyncExternalStore(connections.subscribeState, read, read);
}

export function useConnectionLifecycles() {
  const { connections } = useAppCore();
  return useSyncExternalStore(connections.subscribeState, connections.getLifecycles, connections.getLifecycles);
}
