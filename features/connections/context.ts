import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceTarget, useAppCore, useConnectionLifecycle, useWorkspaceConnectionSettings } from '@/runtime/core';
import { useWorkspaces } from '@/runtime/workspace';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { getServerCapabilities } from '@/shared/protocol/opencode/capabilities';

import type { ConnectionContextValue } from './model/types';

export function useConnection(explicit?: WorkspaceTarget): ConnectionContextValue {
  const target = useActiveWorkspaceTarget(explicit);
  const { store, commands } = useAppCore();
  const { connectionControls } = useWorkspaces();
  const connectionId = target?.connectionId;
  const projectPath = target?.projectPath;
  const settings = useWorkspaceConnectionSettings(explicit);
  const { connection, contract } = useConnectionLifecycle(connectionId);
  const serverCapabilities = useMemo(() => getServerCapabilities(contract), [contract]);
  const { retry, switchConnection } = commands.connection;
  const connect = useCallback(() => connectionId ? retry(connectionId) : Promise.resolve(connection), [connectionId, connection, retry]);
  const updateSettings = useCallback<ConnectionContextValue['updateSettings']>((patch) => {
    if (!connectionId || projectPath === undefined) return;
    const current = store.getState().registry.connections.find(({ id }) => id === connectionId);
    if (!current) return;
    const origin = commands.workspace.resolveKey({ connectionId, projectPath });
    commands.connection.updateSettings(connectionId, { ...current.settings, ...patch }, origin);
  }, [commands, connectionId, projectPath, store]);
  return useMemo(() => ({ ...connectionControls, connection, settings, serverCapabilities, connect, updateSettings, switchConnection }),
    [connect, connection, connectionControls, serverCapabilities, settings, switchConnection, updateSettings]);
}

export { useConnectionLifecycles } from '@/runtime/core';
export { useDiagnostics, useTransportDiagnostics } from './state/use-workspace-diagnostics';
