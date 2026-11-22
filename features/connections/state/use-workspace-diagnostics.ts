import { useQueries } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { useActiveWorkspaceTarget, useAppCore, useAppStore } from '@/runtime/core';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { workspaceKey, type WorkspaceTarget } from '@/shared/contracts/workspace';
import { useQueryForeground } from '@/shared/server-data/client';
import { healthOptions, mcpOptions } from '@/shared/server-data/diagnostics';
import type { Diagnostics } from '@/shared/protocol/services/diagnostics-service';

import type { DiagnosticsContextValue } from '../model/types';

const noSubscription = () => () => {};
const noLifecycle = () => undefined;
const idle = () => 'idle' as const;
const noRetry = { attempt: 0, maxAttempts: 0 };
const readNoRetry = () => noRetry;

function useDiagnosticConnection(explicit?: WorkspaceTarget) {
  const target = useActiveWorkspaceTarget(explicit);
  const { connections } = useAppCore();
  const readManager = useCallback(() => target && connections.get(target.connectionId), [connections, target]);
  const manager = useSyncExternalStore(connections.subscribe, readManager, noLifecycle);
  return { target, manager };
}

function useTransport(manager: ReturnType<typeof useDiagnosticConnection>['manager']): Pick<DiagnosticsContextValue, 'transport' | 'eventStreamStatus'> {
  const eventStreamStatus = useSyncExternalStore(manager?.realtime.subscribe ?? noSubscription,
    manager?.realtime.getStatus ?? idle, idle);
  const reconnect = useSyncExternalStore(manager?.retry.subscribe ?? noSubscription,
    manager?.retry.getSnapshot ?? readNoRetry, readNoRetry);
  const network = useAppStore((state) => state.network);
  const transport = useMemo(() => ({ network, reconnect }), [network, reconnect]);
  return { eventStreamStatus, transport };
}

export function useTransportDiagnostics() {
  return useTransport(useDiagnosticConnection().manager);
}

export function useDiagnostics(explicit: WorkspaceTarget): DiagnosticsContextValue {
  const { target, manager } = useDiagnosticConnection(explicit);
  const transport = useTransport(manager);
  const { queryClient, store } = useAppCore();
  const scopeKey = workspaceKey(explicit);
  const pathname = usePathname();
  const foreground = useQueryForeground();
  const entry = useAppStore((state) => state.registry.connections.find(({ id }) => id === target?.connectionId));
  const directory = useAppStore((state) => state.selection[scopeKey]?.activeProjectPath || target?.projectPath || '');
  const requested = useAppStore((state) => Boolean(state.workspaceUi[scopeKey]?.diagnosticsRequested));
  const lifecycle = useSyncExternalStore(manager?.subscribe ?? noSubscription, manager?.getState ?? noLifecycle, noLifecycle);
  const client = entry && lifecycle && manager?.getProjectClient(directory, entry);
  const id = entry?.id;
  const connectionScope = entry && getConnectionScope(entry.settings);
  const authRevision = entry?.authRevision ?? 0;
  const identity = useMemo(() => id && connectionScope ? { connectionId: id, connectionScope, authRevision } : undefined, [authRevision, connectionScope, id]);
  const active = Boolean(pathname === '/settings' && foreground && entry?.enabled && client && identity);
  const healthQueries = client && identity && active ? [{ ...healthOptions(identity, client), enabled: requested }] : [];
  const mcpQueries = client && identity && active ? [{ ...mcpOptions(identity, client), enabled: requested }] : [];
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
    if (!active || !client || !identity) return;
    store.getState().setWorkspaceUi(scopeKey, { diagnosticsRequested: true });
    await Promise.allSettled([queryClient.fetchQuery(healthOptions(identity, client)), queryClient.fetchQuery(mcpOptions(identity, client))]);
  }, [active, client, identity, queryClient, scopeKey, store]);
  return { ...transport, diagnostics, refreshDiagnostics };
}
