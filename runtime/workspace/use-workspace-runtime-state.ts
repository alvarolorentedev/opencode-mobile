import type { useConnectionRuntime } from '@/runtime/connections/connection-runtime';
import { useSessionRuntimeState } from '@/runtime/workspace/use-session-runtime-state';
import type { WorkspaceRuntimeInput } from '@/runtime/workspace/workspace-types';
import { useEffect, useLayoutEffect } from 'react';
const DISCONNECTED = { status: 'idle' as const, message: 'Disconnected' };
export function useWorkspaceRuntimeState(input: WorkspaceRuntimeInput, handle: ReturnType<typeof useConnectionRuntime>) {
  const local = useSessionRuntimeState(input, handle.connection, handle.serverContract);
  const { scopeGenerationRef, serverGenerationRef, cancelBootstrap } = local;
  useEffect(() => () => { scopeGenerationRef.current++; serverGenerationRef.current++; cancelBootstrap(); }, [cancelBootstrap, scopeGenerationRef, serverGenerationRef]);
  useLayoutEffect(() => {
    scopeGenerationRef.current++; serverGenerationRef.current++;
    cancelBootstrap();
  }, [input.connection.revision, cancelBootstrap, scopeGenerationRef, serverGenerationRef]);
  return { ...local, ...input.shared, settings: input.connection.settings,
    serverContract: handle.serverContract,
    setSettings: input.setSettings, chatPreferences: input.preferences, setChatPreferences: input.setChatPreferences,
    connection: input.connection.enabled ? handle.connection : DISCONNECTED };
}
