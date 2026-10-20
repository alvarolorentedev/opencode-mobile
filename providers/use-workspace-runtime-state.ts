import { useEffect, useLayoutEffect, useMemo } from 'react';
import { getConnectionScope } from '@/lib/connection-scope';
import { useOpencodeProviderState } from '@/providers/use-opencode-provider-state';
import type { WorkspaceRuntimeInput } from '@/providers/workspace-types';
const DISCONNECTED = { status: 'idle' as const, message: 'Disconnected' };
export function useWorkspaceRuntimeState(input: WorkspaceRuntimeInput) {
  const local = useOpencodeProviderState({ settings: input.connection.settings, projectPath: input.projectPath });
  const { initialConnectStartedRef, scopeGenerationRef, serverGenerationRef, settingsRef, chatPreferencesRef, connectionScopeRef, connectionRef } = local;
  useEffect(() => () => { scopeGenerationRef.current++; serverGenerationRef.current++; }, [scopeGenerationRef, serverGenerationRef]);
  useEffect(() => { if (!input.connection.enabled) initialConnectStartedRef.current = false; }, [input.connection.enabled, initialConnectStartedRef]);
  const connectionScope = useMemo(() => getConnectionScope(input.connection.settings), [input.connection.settings]);
  useLayoutEffect(() => {
    settingsRef.current = input.connection.settings; chatPreferencesRef.current = input.preferences;
    connectionScopeRef.current = connectionScope; connectionRef.current = input.connection.enabled ? local.connection : DISCONNECTED;
  }, [input.connection.settings, input.preferences, input.connection.enabled, local.connection, connectionScope, settingsRef, chatPreferencesRef, connectionScopeRef, connectionRef]);
  return { ...local, connectionScope, ...input.shared, settings: input.connection.settings,
    setSettings: input.setSettings, chatPreferences: input.preferences, setChatPreferences: input.setChatPreferences,
    connection: input.connection.enabled ? local.connection : DISCONNECTED };
}
