import { useCallback, useMemo } from 'react';

import { useAppCore, useWorkspaceDomainValue } from '@/runtime/core';
import { getConnectionUiScope } from '@/shared/contracts/connection-scope';

export function useConnection() {
  const value = useWorkspaceDomainValue((values) => values.connectionValue, 'useConnection');
  const { retry } = useAppCore().commands.connection;
  const connectionId = getConnectionUiScope(value.settings);
  const connect = useCallback(() => retry(connectionId), [connectionId, retry]);
  return useMemo(() => ({ ...value, connect }), [connect, value]);
}

export const useDiagnostics = () => useWorkspaceDomainValue((values) => values.diagnosticsValue, 'useDiagnostics');
