import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { useConnectionRuntime } from '@/runtime/connections/connection-runtime';
import { useSessionRuntimeState } from '@/runtime/workspace/use-session-runtime-state';
import type { WorkspaceRuntimeInput } from '@/runtime/workspace/workspace-types';
import { useEffect, useLayoutEffect, useMemo } from 'react';
const DISCONNECTED = { status: 'idle' as const, message: 'Disconnected' };
export function useWorkspaceRuntimeState(input: WorkspaceRuntimeInput) {
  const handle = useConnectionRuntime();
  const local = useSessionRuntimeState(input, handle.connection, handle.serverContract);
  const { scopeGenerationRef, serverGenerationRef, settingsRef, chatPreferencesRef, connectionScopeRef, connectionRef, serverContractRef, bootstrapPromiseRef, bootstrapTokenRef } = local;
  useEffect(() => () => { scopeGenerationRef.current++; serverGenerationRef.current++; }, [scopeGenerationRef, serverGenerationRef]);
  useLayoutEffect(() => {
    scopeGenerationRef.current++; serverGenerationRef.current++;
    bootstrapPromiseRef.current = null; bootstrapTokenRef.current = undefined;
  }, [input.connection.revision, scopeGenerationRef, serverGenerationRef, bootstrapPromiseRef, bootstrapTokenRef]);
  const connectionScope = useMemo(() => getConnectionScope(input.connection.settings), [input.connection.settings]);
  useLayoutEffect(() => {
    serverContractRef.current = handle.serverContract;
    settingsRef.current = input.connection.settings; chatPreferencesRef.current = input.preferences;
    connectionScopeRef.current = connectionScope; connectionRef.current = input.connection.enabled ? handle.connection : DISCONNECTED;
  }, [input.connection.settings, input.preferences, input.connection.enabled, handle.connection, connectionScope, serverContractRef, handle.serverContract, settingsRef, chatPreferencesRef, connectionScopeRef, connectionRef]);
  return { ...local, connectionScope, ...input.shared, settings: input.connection.settings,
    serverContract: handle.serverContract,
    setSettings: input.setSettings, chatPreferences: input.preferences, setChatPreferences: input.setChatPreferences,
    connection: input.connection.enabled ? handle.connection : DISCONNECTED };
}
