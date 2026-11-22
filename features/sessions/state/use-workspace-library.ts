import { useCallback, useMemo } from 'react';
import { useWorkspaces } from '@/runtime/workspace';
import { useAppCore, useConnectionLifecycles } from '@/runtime/core';
import { connectedConnections, librarySessions } from '@/features/sessions/model/workspace-library';
import type { SessionTarget } from '@/shared/contracts/workspace';
export function useWorkspaceLibrary(visible = true) {
  const registry = useWorkspaces();
  const { connections } = useAppCore();
  const lifecycles = useConnectionLifecycles();
  const { ensure, catalogs } = registry;
  // The library is mounted while closed so its search/section state survives.
  // Skip the cross-project derivation until it is actually visible.
  const sessions = useMemo(() => (visible
    ? librarySessions(registry.connections, registry.snapshots, lifecycles, registry.focus)
    : []), [lifecycles, registry.connections, registry.focus, registry.snapshots, visible]);
  const servers = useMemo(() => (visible
    ? connectedConnections(registry.connections, lifecycles)
    : []), [lifecycles, registry.connections, visible]);
  const refresh = useCallback(async () => {
    await Promise.all(Object.values(catalogs).map((catalog) => catalog.refresh()));
  }, [catalogs]);
  const manage = useCallback(async (target: SessionTarget, action: 'rename' | 'delete' | 'favorite', title?: string) => {
    const runtime = await ensure(target);
    if (action !== 'favorite' && (!runtime.enabled || connections.getLifecycle(target.connectionId).connection.status !== 'connected')) throw new Error('Connect this server before changing its chats.');
    const library = runtime.values.sessionLibraryValue;
    if (action === 'rename') await library.renameSession(target.sessionId, title ?? '');
    else if (action === 'delete') await library.deleteSession(target.sessionId);
    else library.toggleFavoriteSession(target.sessionId, target.projectPath, title);
    await refresh();
  }, [connections, ensure, refresh]);
  return { sessions, servers, refresh, manage };
}
