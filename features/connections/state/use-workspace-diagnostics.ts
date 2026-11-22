import { useQueries } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { useActiveWorkspaceTarget, useAppCore, useAppStore, useProjectScope, type AppCore } from '@/runtime/core';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { healthOptions, mcpOptions } from '@/shared/server-data/diagnostics';
import type { Diagnostics } from '@/shared/protocol/services/diagnostics-service';

import type { DiagnosticsContextValue } from '../model/types';

const noSubscription = () => () => {};
const noManager = () => undefined;
const idle = () => 'idle' as const;
const noRetry = { attempt: 0, maxAttempts: 0 };
const readNoRetry = () => noRetry;

function useTransport(manager: ReturnType<AppCore['connections']['get']>): Pick<DiagnosticsContextValue, 'transport' | 'eventStreamStatus'> {
  const eventStreamStatus = useSyncExternalStore(manager?.realtime.subscribe ?? noSubscription,
    manager?.realtime.getStatus ?? idle, idle);
  const reconnect = useSyncExternalStore(manager?.retry.subscribe ?? noSubscription,
    manager?.retry.getSnapshot ?? readNoRetry, readNoRetry);
  const network = useAppStore((state) => state.network);
  const transport = useMemo(() => ({ network, reconnect }), [network, reconnect]);
  return { eventStreamStatus, transport };
}

export function useTransportDiagnostics() {
  const target = useActiveWorkspaceTarget();
  const { connections } = useAppCore();
  const readManager = useCallback(() => target && connections.get(target.connectionId), [connections, target]);
  const manager = useSyncExternalStore(connections.subscribe, readManager, noManager);
  return useTransport(manager);
}

export function useDiagnostics(explicit: WorkspaceTarget): DiagnosticsContextValue {
  const { client, identity, isCurrentClient, manager, queryActive, scopeKey } = useProjectScope(explicit);
  const transport = useTransport(manager);
  const { queryClient, store } = useAppCore();
  const pathname = usePathname();
  const requested = useAppStore((state) => Boolean(state.workspaceUi[scopeKey]?.diagnosticsRequested));
  const active = pathname === '/settings' && queryActive;
  const healthQueries = active ? [{ ...healthOptions(identity, client), enabled: requested }] : [];
  const mcpQueries = active ? [{ ...mcpOptions(identity, client), enabled: requested }] : [];
  const [health] = useQueries({ queries: healthQueries });
  const [mcp] = useQueries({ queries: mcpQueries });
  const healthData = health?.data;
  const mcpData = mcp?.data;
  const mcpError = mcp?.error;
  const diagnostics = useMemo<Diagnostics | undefined>(() => healthData ? {
    health: healthData,
    mcp: mcpError ? { available: false, error: mcpError.message } : { available: true, data: mcpData ?? {} },
  } : undefined, [healthData, mcpData, mcpError]);
  const refreshDiagnostics = useCallback(async () => {
    if (!active || !isCurrentClient(client)) return;
    store.getState().setWorkspaceUi(scopeKey, { diagnosticsRequested: true });
    await Promise.allSettled([queryClient.fetchQuery(healthOptions(identity, client)), queryClient.fetchQuery(mcpOptions(identity, client))]);
  }, [active, client, identity, isCurrentClient, queryClient, scopeKey, store]);
  return { ...transport, diagnostics, refreshDiagnostics };
}
