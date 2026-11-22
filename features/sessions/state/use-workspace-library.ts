import { useCallback, useMemo } from 'react';
import { useWorkspaces } from '@/runtime/workspace';
import { useAppCore, useAppStore, useConnectionLifecycles } from '@/runtime/core';
import { connectedConnections, librarySessions } from '@/features/sessions/model/workspace-library';
import type { SessionTarget } from '@/shared/contracts/workspace';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { toggleFavoriteSession } from '../model/favorite-sessions';

export function useWorkspaceLibrary(visible = true) {
  const registry = useWorkspaces();
  const { connections, store, clock, commands: { session, workspace: { ensure, resolveKey } } } = useAppCore();
  const lifecycles = useConnectionLifecycles();
  const selections = useAppStore((state) => visible ? state.selection : undefined);
  const favoriteSessions = useAppStore((state) => visible ? state.shell.favoriteSessions : undefined);
  const { catalogs } = registry;
  // The library is mounted while closed so its search/section state survives.
  // Skip the cross-project derivation until it is actually visible.
  const sessions = useMemo(() => (selections && favoriteSessions
    ? librarySessions(registry.connections, registry.snapshots, lifecycles, selections, catalogs, favoriteSessions, registry.focus)
    : []), [catalogs, favoriteSessions, lifecycles, registry.connections, registry.focus, registry.snapshots, selections]);
  const servers = useMemo(() => (visible
    ? connectedConnections(registry.connections, lifecycles)
    : []), [lifecycles, registry.connections, visible]);
  const refresh = useCallback(async () => {
    await Promise.all(Object.values(catalogs).map((catalog) => catalog.refresh()));
  }, [catalogs]);
  const manage = useCallback(async (target: SessionTarget, action: 'rename' | 'delete' | 'favorite', title?: string) => {
    if (action === 'favorite') {
      const state = store.getState();
      const entry = state.registry.connections.find(({ id }) => id === target.connectionId);
      if (!entry) throw new Error('This server is no longer available.');
      const scope = getConnectionScope(entry.settings);
      state.setShellValue('favoriteSessions', (current) => toggleFavoriteSession(current, scope, target.sessionId, target.projectPath, title, clock()));
    } else {
      const binding = await ensure(target);
      if (!binding.enabled || connections.getLifecycle(target.connectionId).connection.status !== 'connected') throw new Error('Connect this server before changing its chats.');
      const editing = session.editing({ connectionId: target.connectionId, projectPath: binding.boundDirectory ?? '' }, resolveKey(target), binding.revision);
      if (action === 'rename') await editing.renameSession(target.sessionId, title ?? '');
      else await editing.deleteSession(target.sessionId);
    }
    await refresh();
  }, [clock, connections, ensure, refresh, resolveKey, session, store]);
  return { sessions, servers, refresh, manage };
}
