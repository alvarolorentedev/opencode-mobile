import { useCallback, useMemo } from 'react';

import { useAppCore, useWorkspaceDomainValue } from '@/runtime/core';
import { getConnectionUiScope } from '@/shared/contracts/connection-scope';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';

export function useConnection(target?: WorkspaceTarget) {
  const value = useWorkspaceDomainValue((values) => values.connectionValue, 'useConnection', target);
  const { retry } = useAppCore().commands.connection;
  const connectionId = getConnectionUiScope(value.settings);
  const connect = useCallback(() => retry(connectionId), [connectionId, retry]);
  return useMemo(() => ({ ...value, connect }), [connect, value]);
}

export const useDiagnostics = () => useWorkspaceDomainValue((values) => values.diagnosticsValue, 'useDiagnostics');
