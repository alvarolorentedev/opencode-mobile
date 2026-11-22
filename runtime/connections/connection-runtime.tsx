import { buildClient, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { isServerConnectedEvent, serverDataResources } from '@/shared/protocol/opencode/server-data-events';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AppState } from 'react-native';
import { useConnectionRetry } from '@/features/connections/runtime';
import { createConnection } from '@/runtime/connections/create-connection';
import { replaceQueryPartition } from '@/shared/server-data/keys';
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

const foregroundLifecycle = {
  isActive: () => AppState.currentState === 'active',
  subscribe(listener: (active: boolean) => void) {
    const subscription = AppState.addEventListener('change', (state) => listener(state === 'active'));
    return () => subscription.remove();
  },
};

export function useConnectionLifecycle(entry: ConnectionRecord, setup: ConnectSetup, updateSettings: (id: string, settings: OpencodeConnectionSettings) => void, online: boolean, hydrated: boolean) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const [manager] = useState(() => createConnection({ queryClient, foreground: foregroundLifecycle }));
  const state = useSyncExternalStore(manager.subscribe, manager.getState, manager.getState);
  useLayoutEffect(() => {
    manager.setInput({ entry, setup, identity, translate: connectionTranslator(t), hydrated, updateSettings });
  });
  useEffect(() => manager.syncConnection(), [entry.enabled, entry.id, entry.revision, entry.settings, hydrated, manager]);
  const renewalPaused = setup.phase === 'waitingForApproval' || setup.phase === 'delayed';
  useEffect(() => manager.syncRenewal(), [entry.enabled, entry.id, entry.settings.connect, entry.settings.password, manager, renewalPaused]);
  const reconnect = useConnectionRetry({ active, paused: Boolean(entry.settings.connect), status: state.connection.status, kind: 'kind' in state.connection ? state.connection.kind : undefined, online, connect: manager.connect });
  return useMemo(() => ({
    connection: entry.enabled ? state.connection : { status: 'idle' as const, message: 'Disconnected' },
    serverContract: state.contract,
    connect: manager.connect,
    handleStreamAuthFailure: manager.handleStreamAuthFailure,
    onInvalidated: manager.onInvalidated,
    reconnect,
  }), [entry.enabled, manager, reconnect, state.connection, state.contract]);
}

type Handle = ReturnType<typeof useConnectionLifecycle> & { catalogClient: ReturnType<typeof buildClient>; catalog: WorkspaceCatalog; isCurrentCatalogClient: (client: object) => boolean };
const ConnectionRuntimeContext = createContext<Handle | null>(null);
export function ConnectionRuntime({ entry, setup, updateSettings, online, hydrated, onCatalog, libraryVisible, missionVisible, children }: PropsWithChildren<{ entry: ConnectionRecord; setup: ConnectSetup; updateSettings: (id: string, settings: OpencodeConnectionSettings) => void; online: boolean; hydrated: boolean; libraryVisible: boolean; missionVisible?: boolean; onCatalog: (id: string, catalog: WorkspaceCatalog) => void }>) {
  const cache = useQueryClient();
  useEffect(() => () => {
    void cache.cancelQueries({ queryKey: ['opencode', entry.id] });
    cache.removeQueries({ queryKey: ['opencode', entry.id] });
  }, [cache, entry.id]);
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
  const lifecycle = useConnectionLifecycle(entry, setup, updateSettings, online, hydrated);
  const identity = useQueryIdentity();
  const partition = useRef({ identity, settings: entry.settings });
  useLayoutEffect(() => {
    const previous = partition.current;
    if (previous.identity.connectionScope === identity.connectionScope && previous.identity.authRevision === identity.authRevision) return;
    const sameMachine = entry.settings.connect && previous.settings.connect
      && entry.settings.connect.machineId === previous.settings.connect.machineId
      && entry.settings.connect.controlPlaneUrl === previous.settings.connect.controlPlaneUrl
      && entry.settings.serverUrl === previous.settings.serverUrl;
    replaceQueryPartition(cache, previous.identity, identity, Boolean(sameMachine));
    partition.current = { identity, settings: entry.settings };
  }, [cache, entry.id, entry.settings, identity]);
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
