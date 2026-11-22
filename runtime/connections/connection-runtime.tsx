import { buildClient, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AppState } from 'react-native';
import { createConnection } from '@/runtime/connections/create-connection';
import { NO_RETRY } from '@/runtime/connections/retry';
import { useAppCore } from '@/runtime/core';
import type { ConnectionLifecycle } from '@/features/connections/index';
import { projectsOptions } from '@/features/projects/runtime';
import { useQueryActivity, useQueryForeground, useQueryIdentity } from '@/shared/server-data/client';
import { readSessionStats } from '@/shared/protocol/services/session-stats';
import type { SessionStatsSource } from '@/shared/server-data/session-stats';
import { useActiveSessions, useMissionActivity } from '@/features/sessions/runtime';
import type { ConnectSetup } from '@/shared/contracts/cloud-link-setup';
import type { ConnectionRecord, WorkspaceCatalog } from '@/shared/contracts/workspace';
import type { Project } from '@/shared/protocol/opencode/types';

const EMPTY_PROJECTS: Project[] = [];

// i18next's TFunction no longer accepts a plain options record, and the protocol
// layer must not type itself against i18next generics, so adapt at this boundary.
// The protocol layer only ever asks for plain strings, never key details.
function connectionTranslator(t: TFunction) {
  return (key: string, options?: Record<string, unknown>): string =>
    (options ? t(key, options as never) : t(key)) as string;
}

const IDLE: ConnectionLifecycle = { phase: 'idle', operation: 0, connection: { status: 'idle', message: 'Disconnected' }, contract: 'v2' };
const readIdle = () => IDLE;
const readNoRetry = () => NO_RETRY;
const noSubscription = () => () => {};
const emptyCatalog: WorkspaceCatalog = { sessions: [], statuses: {}, refresh: async () => {}, removeSession: () => {} };

export function useConnectionRegistryBinding(setup: ConnectSetup, updateSettings: (id: string, settings: OpencodeConnectionSettings) => void, hydrated: boolean) {
  const { connections } = useAppCore();
  const { t } = useTranslation();
  const { phase, prepareSettings } = setup;
  useLayoutEffect(() => {
    connections.setForeground(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => connections.setForeground(state === 'active'));
    return () => { subscription.remove(); connections.dispose(); };
  }, [connections]);
  useLayoutEffect(() => {
    connections.configure({ setup: { phase, prepareSettings }, translate: connectionTranslator(t), hydrated, updateSettings, createManager: createConnection });
  }, [connections, hydrated, phase, prepareSettings, t, updateSettings]);
}

export function useConnectionDemand(activeId: string | undefined, online: boolean) {
  const { connections } = useAppCore();
  const foreground = useQueryForeground();
  useLayoutEffect(() => { connections.setDemand(activeId, online, foreground); }, [activeId, connections, foreground, online]);
}

function useManagedConnection(entry: ConnectionRecord) {
  const { connections, commands } = useAppCore();
  const managerForThisId = useCallback(() => connections.get(entry.id), [connections, entry.id]);
  const manager = useSyncExternalStore(connections.subscribe, managerForThisId, managerForThisId);
  const state = useSyncExternalStore(manager?.subscribe ?? noSubscription, manager?.getState ?? readIdle, readIdle);
  const connect = useCallback(() => commands.connection.connect(entry.id), [commands.connection, entry.id]);
  const reconnect = useSyncExternalStore(manager?.retry.subscribe ?? noSubscription, manager?.retry.getSnapshot ?? readNoRetry, readNoRetry);
  return useMemo(() => ({
    connection: entry.enabled ? state.connection : IDLE.connection,
    serverContract: state.contract,
    connect,
    onInvalidated: manager?.onInvalidated ?? noSubscription,
    reconnect,
    manager,
  }), [connect, entry.enabled, manager, reconnect, state.connection, state.contract]);
}

export function useConnectionRuntime(entry: ConnectionRecord, catalog = emptyCatalog) {
  const { connections } = useAppCore();
  const lifecycle = useManagedConnection(entry);
  const catalogClient = useMemo(() => lifecycle.manager?.getCatalogClient() ?? buildClient({ ...entry.settings, directory: '' }, lifecycle.serverContract),
    [entry.settings, lifecycle.manager, lifecycle.serverContract]);
  const isCurrentCatalogClient = useCallback((client: object) => client === connections.get(entry.id)?.getCatalogClient(), [connections, entry.id]);
  return { ...lifecycle, catalogClient, catalog, isCurrentCatalogClient };
}

export function ConnectionCatalog({ entry, online, onCatalog, libraryVisible, missionVisible }: {
  entry: ConnectionRecord;
  online: boolean;
  libraryVisible: boolean;
  missionVisible: boolean;
  onCatalog: (entry: ConnectionRecord, catalog: WorkspaceCatalog) => void;
}) {
  const lifecycle = useConnectionRuntime(entry);
  const { catalogClient } = lifecycle;
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const sessions = useActiveSessions({ catalogClient, connected: entry.enabled && lifecycle.connection.status === 'connected', currentSessionId: undefined, hideSubagentChats: false, visible: active && libraryVisible });
  const sessionCatalog = useMemo<WorkspaceCatalog>(() => ({ sessions: sessions.catalogSessions, statuses: sessions.catalogStatuses, refresh: sessions.refreshActiveSessions, removeSession: sessions.removeSession }), [sessions.catalogSessions, sessions.catalogStatuses, sessions.refreshActiveSessions, sessions.removeSession]);
  const foreground = useQueryForeground();
  const projects = useQuery({ ...projectsOptions(identity, catalogClient),
    enabled: entry.enabled && online && foreground && lifecycle.connection.status === 'connected' && lifecycle.serverContract === 'v2' }).data ?? EMPTY_PROJECTS;
  const knownDirectories = useMemo(() => projects.flatMap(({ worktree, sandboxes }) => [worktree, ...(sandboxes ?? [])]).filter(Boolean), [projects]);
  const connected = lifecycle.connection.status === 'connected';
  const authorized = lifecycle.connection.kind !== 'auth' && lifecycle.connection.kind !== 'entitlement';
  const statsAvailable = entry.enabled && online && connected && authorized && lifecycle.serverContract === 'v2';
  const stats = useMemo<SessionStatsSource | undefined>(() => statsAvailable ? {
    identity, read: (range, project, signal, timezone) => readSessionStats(catalogClient, range, project, signal, timezone),
  } : undefined, [catalogClient, identity, statsAvailable]);
  const mission = useMissionActivity({ entry, events: lifecycle.manager?.events, client: catalogClient, connected: lifecycle.connection.status === 'connected',
    connectionFailed: lifecycle.connection.status === 'error',
    authorized,
    online, foreground, visible: Boolean(missionVisible), catalog: sessionCatalog, catalogCheckedAt: sessions.catalogCheckedAt,
    catalogError: sessions.catalogError, knownDirectories, projects, reconnect: lifecycle.connect });
  const catalog = useMemo(() => ({ ...sessionCatalog, mission: { ...mission, stats } }), [sessionCatalog, mission, stats]);
  useLayoutEffect(() => { onCatalog(entry, catalog); }, [catalog, entry, onCatalog]);
  return null;
}
