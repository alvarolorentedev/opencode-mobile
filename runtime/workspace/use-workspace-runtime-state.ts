import { useConnectionRuntime } from '@/runtime/connections/connection-runtime';
import { useSessionRuntimeState } from '@/runtime/workspace/use-session-runtime-state';
import type { WorkspaceRuntimeInput } from '@/runtime/workspace/workspace-types';
import { useEffect, useLayoutEffect } from 'react';
const DISCONNECTED = { status: 'idle' as const, message: 'Disconnected' };
export function useWorkspaceRuntimeState(input: WorkspaceRuntimeInput) {
  const handle = useConnectionRuntime();
  const local = useSessionRuntimeState(input, handle.connection, handle.serverContract);
  const { scopeGenerationRef, serverGenerationRef, bootstrapPromiseRef, bootstrapTokenRef } = local;
  useEffect(() => () => { scopeGenerationRef.current++; serverGenerationRef.current++; }, [scopeGenerationRef, serverGenerationRef]);
  useLayoutEffect(() => {
    scopeGenerationRef.current++; serverGenerationRef.current++;
    bootstrapPromiseRef.current = null; bootstrapTokenRef.current = undefined;
  }, [input.connection.revision, scopeGenerationRef, serverGenerationRef, bootstrapPromiseRef, bootstrapTokenRef]);
  return { ...local, ...input.shared, settings: input.connection.settings,
    serverContract: handle.serverContract,
    setSettings: input.setSettings, chatPreferences: input.preferences, setChatPreferences: input.setChatPreferences,
    connection: input.connection.enabled ? handle.connection : DISCONNECTED };
}
