import { useCallback, useMemo } from 'react';
import { useWorkspaces } from '@/runtime/workspace';
import { useAppCore, useConnectionLifecycles } from '@/runtime/core';
import { connectedConnections } from '@/features/sessions/model/workspace-library';
import type { SessionTarget } from '@/shared/contracts/workspace';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { toggleFavoriteSession } from '../model/favorite-sessions';
import { useLibrarySessions } from './use-library-sessions';

export function useWorkspaceLibrary(visible = true) {
  const registry = useWorkspaces();
  const { connections, store, clock, commands: { session, workspace: { ensure, resolveKey } } } = useAppCore();
  const lifecycles = useConnectionLifecycles();
  const { catalogs } = registry;
  // The library is mounted while closed so its search/section state survives.
  // Skip the cross-project derivation until it is actually visible.
  const sessions = useLibrarySessions(catalogs, { visible });
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
