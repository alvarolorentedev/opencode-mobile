import { useEffect } from 'react';

import type { AppCore } from '@/runtime/core';
import type { RegistryState, ShellState } from '@/runtime/core/store';

type WorkspaceRegistryAccess = {
  registry: RegistryState;
  commands: Pick<AppCore['commands'], 'workspace' | 'connection'>;
  hiddenProjects: ShellState['hiddenProjects'];
};

export function useWorkspaceConnections(hydrated: boolean, { registry, commands, hiddenProjects }: WorkspaceRegistryAccess) {
  const { workspace, connection } = commands;
  const { connections, focus, ready, snapshots } = registry;
  useEffect(() => { workspace.resume(); return workspace.dispose; }, [workspace]);
  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    void connection.hydrate(controller.signal);
    return () => controller.abort();
  }, [connection, hydrated]);
  useEffect(() => { void connection.persist(); }, [connection, connections, focus, ready]);
  useEffect(() => connection.observeFocus(), [connection]);

  const { isEnabled, connectedWorkspace, change, select, publish, forget, ensure, resolveKey, activate, navigate, openExternalSession } = workspace;
  const { hideProject, restoreProject, removeConnection, switchConnection, connectSavedProfile, disconnect, retry, updateSettings, updatePreferences } = connection;
  return {
    isEnabled, hideProject, restoreProject, hiddenProjects, connectedWorkspace, removeConnection, connections, focus,
    snapshots, ready, change, select, publish, forget, ensure, resolveKey, activate, navigate, openExternalSession, switchConnection,
    connectSavedProfile, disconnect, retry, updateSettings, updatePreferences,
  };
}
