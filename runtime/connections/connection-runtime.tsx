import { buildClient, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { isServerConnectedEvent, serverDataResources } from '@/shared/protocol/opencode/server-data-events';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AppState } from 'react-native';
import { useConnectionRetry } from '@/features/connections/runtime';
import { createConnection } from '@/runtime/connections/create-connection';
import { useAppCore } from '@/runtime/core';
import type { ConnectionLifecycle } from '@/features/connections/index';
import { projectsOptions } from '@/features/projects/runtime';
import { useQueryActivity, useQueryForeground, useQueryIdentity } from '@/shared/server-data/client';
import { readSessionStats } from '@/shared/protocol/services/session-stats';
import type { SessionStatsSource } from '@/shared/server-data/session-stats';
import { useActiveSessions, useMissionActivity } from '@/features/sessions/runtime';
import { useCoalescedRefresh } from '@/runtime/realtime/use-coalesced-refresh';
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
const noSubscription = () => () => {};
const noAuthFailure = () => {};

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

function useManagedConnection(entry: ConnectionRecord, online: boolean) {
  const { connections } = useAppCore();
  const active = useQueryActivity();
  const managerForThisId = useCallback(() => connections.get(entry.id), [connections, entry.id]);
  const manager = useSyncExternalStore(connections.subscribe, managerForThisId, managerForThisId);
  const state = useSyncExternalStore(manager?.subscribe ?? noSubscription, manager?.getState ?? readIdle, readIdle);
  const connect = useCallback(() => managerForThisId()?.connect() ?? Promise.resolve(IDLE.connection), [managerForThisId]);
  const reconnect = useConnectionRetry({ active, paused: Boolean(entry.settings.connect), status: state.connection.status, kind: state.connection.kind, online, connect });
  return useMemo(() => ({
    connection: entry.enabled ? state.connection : IDLE.connection,
    serverContract: state.contract,
    connect,
    handleStreamAuthFailure: manager?.handleStreamAuthFailure ?? noAuthFailure,
    onInvalidated: manager?.onInvalidated ?? noSubscription,
    reconnect,
  }), [connect, entry.enabled, manager, reconnect, state.connection, state.contract]);
}

type Handle = ReturnType<typeof useManagedConnection> & { catalogClient: ReturnType<typeof buildClient>; catalog: WorkspaceCatalog; isCurrentCatalogClient: (client: object) => boolean };
const ConnectionRuntimeContext = createContext<Handle | null>(null);
export function ConnectionRuntime({ entry, online, onCatalog, libraryVisible, missionVisible, children }: PropsWithChildren<{ entry: ConnectionRecord; online: boolean; libraryVisible: boolean; missionVisible?: boolean; onCatalog: (id: string, catalog: WorkspaceCatalog) => void }>) {
  const cache = useQueryClient();
  const dirty = useRef(new Map<string, Set<string>>());
  const flush = useCoalescedRefresh(async () => {
    const changes = new Map(dirty.current); dirty.current.clear();
    await cache.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey;
      if (key[0] !== 'opencode' || key[1] !== entry.id) return false;
      const resource = String(key[key[5] === 'server' ? 6 : 7]);
      return key[5] === 'server' ? [...changes.values()].some((resources) => resources.has(resource))
        : changes.get(String(key[6]))?.has(resource) === true || changes.get('')?.has(resource) === true;
    } });
  }, 250);
  useLayoutEffect(() => {
    let connected = false;
    return entry.events.observe((event) => {
    if (isServerConnectedEvent(event)) {
      if (!connected) { connected = true; return; }
    }
    const resources = serverDataResources(event);
    if (!resources.length) return;
    const directory = event.location?.directory ?? '';
    const pending = dirty.current.get(directory) ?? new Set<string>();
    resources.forEach((resource) => pending.add(resource)); dirty.current.set(directory, pending); flush();
  });
  }, [entry.events, flush]);
  const lifecycle = useManagedConnection(entry, online);
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const catalogClient = useMemo(() => buildClient({ ...entry.settings, directory: '' }, lifecycle.serverContract), [entry.settings, lifecycle.serverContract]);
  useEffect(() => {
    if (active && online && lifecycle.connection.status === 'connected') {
      void cache.refetchQueries({ queryKey: ['opencode', entry.id], stale: true, type: 'active' }, { cancelRefetch: false });
    }
  }, [active, cache, entry.id, online, lifecycle.connection.status]);
  const current = useRef(catalogClient);
  useLayoutEffect(() => { current.current = catalogClient; });
  const isCurrentCatalogClient = useCallback((client: object) => entry.enabled && client === current.current, [entry.enabled]);
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
  const mission = useMissionActivity({ entry, client: catalogClient, connected: lifecycle.connection.status === 'connected',
    connectionFailed: lifecycle.connection.status === 'error',
    authorized,
    online, foreground, visible: Boolean(missionVisible), catalog: sessionCatalog, catalogCheckedAt: sessions.catalogCheckedAt,
    catalogError: sessions.catalogError, knownDirectories, projects, reconnect: lifecycle.connect });
  const catalog = useMemo(() => ({ ...sessionCatalog, mission: { ...mission, stats } }), [sessionCatalog, mission, stats]);
  const { refreshActiveSessions } = sessions;
  useEffect(() => { if (lifecycle.connection.status === 'connected') void refreshActiveSessions(); }, [lifecycle.connection.status, refreshActiveSessions]);
  // Warm the connection-wide project list once per connect. Project queries
  // are demand-gated per runtime, so without this a picker opened for a
  // connection the user has not focused yet would stay empty. The list is
  // small; mounted runtimes pick the cached result up through their shared
  // query key and realtime invalidation still reconciles it.
  useEffect(() => {
    if (lifecycle.connection.status !== 'connected') return;
    void cache.fetchQuery(projectsOptions(identity, catalogClient)).catch(() => undefined);
  }, [cache, catalogClient, identity, lifecycle.connection.status]);
  useLayoutEffect(() => { onCatalog(entry.id, catalog); }, [catalog, entry.id, onCatalog]);
  const value = useMemo(() => ({ ...lifecycle, catalogClient, catalog, isCurrentCatalogClient }), [lifecycle, catalogClient, catalog, isCurrentCatalogClient]);
  return <ConnectionRuntimeContext.Provider value={value}>{children}</ConnectionRuntimeContext.Provider>;
}
export function useConnectionRuntime() {
  const value = useContext(ConnectionRuntimeContext);
  if (!value) throw new Error('Workspace requires its connection runtime.');
  return value;
}
