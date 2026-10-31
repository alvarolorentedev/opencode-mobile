import { getConnectCredentialError } from '@/lib/connect';
import { getConnectionScope } from '@/lib/connection-scope';
import { buildClient, classifyConnectionFailure, detectServerContract, getConnectionError, getNormalizedServerUrl, isContractMismatchError, isRetryableCloudLinkStartupError, isValidServerUrl, type ConnectionFailureKind, type OpencodeConnectionSettings, type ServerContract } from '@/lib/opencode/client';
import { isServerConnectedEvent, serverDataResources } from '@/lib/opencode/server-data-events';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';
import { connectionTransition, type ConnectionLifecycle } from './connection-lifecycle';
import type { ConnectionState } from './opencode-provider-types';
import { replaceQueryPartition } from './queries/keys';
import { fetchProjectCatalog } from './queries/catalogs';
import { useQueryActivity, useQueryIdentity } from './queries/client';
import { useActiveSessions } from './use-active-sessions';
import { useCoalescedRefresh } from './use-coalesced-refresh';
import type { ConnectSetup } from './use-connect-state';
import { useConnectionRetry } from './use-connection-retry';
import type { ConnectionRecord, WorkspaceCatalog } from './workspace-types';

export function useConnectionLifecycle(entry: ConnectionRecord, setup: ConnectSetup, updateSettings: (id: string, settings: OpencodeConnectionSettings) => void, online: boolean, hydrated: boolean) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const [state, dispatch] = useReducer(connectionTransition, { phase: 'idle', operation: 0, connection: { status: 'idle', message: 'Disconnected' }, contract: 'v2' } satisfies ConnectionLifecycle);
  const latest = useRef({ entry, setup, identity, t, state });
  useLayoutEffect(() => { latest.current = { entry, setup, identity, t, state }; });
  const operation = useRef(0);
  const invalidations = useRef(new Set<() => void>());
  const onInvalidated = useCallback((listener: () => void) => { invalidations.current.add(listener); return () => { invalidations.current.delete(listener); }; }, []);
  const invalidateWorkflows = useCallback(() => { for (const listener of invalidations.current) listener(); }, []);
  const inFlight = useRef<{ revision: number; promise: Promise<ConnectionState> } | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const preparedUpdate = useRef<{ revision: number; settings: OpencodeConnectionSettings } | undefined>(undefined);
  const connect = useCallback((): Promise<ConnectionState> => {
    const { entry, setup, t, identity } = latest.current;
    if (!entry.enabled) return Promise.resolve({ status: 'idle', message: 'Disconnected' });
    const pending = inFlight.current;
    if (pending && pending.revision === (entry.revision ?? 0)) return pending.promise;
    controller.current?.abort();
    const attempt = new AbortController(); controller.current = attempt;
    const id = ++operation.current;
    const current = () => operation.current === id && !attempt.signal.aborted;
    dispatch({ type: 'start', operation: id, message: `Connecting to ${getNormalizedServerUrl(entry.settings.serverUrl)}...` });
    const promise = (async (): Promise<ConnectionState> => {
      let settings = entry.settings;
      try {
        if (settings.connect) settings = await setup.prepareSettings(settings);
        if (!current()) return latest.current.state.connection;
        const invalid = getConnectCredentialError(settings.connect, settings.password);
        if (invalid) throw new Error(invalid);
        if (!isValidServerUrl(settings.serverUrl)) throw new Error('Invalid server URL.');
        if (settings !== entry.settings && JSON.stringify(settings) !== JSON.stringify(entry.settings)) {
          preparedUpdate.current = { revision: (entry.revision ?? 0) + 1, settings };
          updateSettings(entry.id, settings);
        }
        dispatch({ type: 'probe', operation: id });
        const detected = await detectServerContract(settings, attempt.signal);
        const candidates: ServerContract[] = detected.contract === 'v1' ? ['v1', 'v2'] : ['v2', 'v1'];
        let failure: unknown;
        for (const contract of candidates) {
          if (!current()) return latest.current.state.connection;
          const client = buildClient({ ...settings, directory: '' }, contract, attempt.signal);
          try {
            await fetchProjectCatalog(cache, { ...identity, connectionScope: getConnectionScope(settings), authRevision: identity.authRevision + (settings.password !== entry.settings.password || settings.username !== entry.settings.username ? 1 : 0) }, client, true);
            if (!current()) return latest.current.state.connection;
            const connection: ConnectionState = { status: 'connected', message: `Connected to ${getNormalizedServerUrl(settings.serverUrl)} (OpenCode ${contract === 'v2' ? '2.x' : '1.x'})`, checkedAt: Date.now() };
            dispatch({ type: 'settle', operation: id, connection, contract });
            return connection;
          } catch (error) { failure = error; if (!isContractMismatchError(error)) break; }
        }
        throw failure;
      } catch (error) {
        if (!current()) return latest.current.state.connection;
        const connection: ConnectionState = { status: 'error', kind: classifyConnectionFailure(error), message: getConnectionError(settings.serverUrl, error, t), checkedAt: Date.now(), retryableStartup: Boolean(settings.connect) && isRetryableCloudLinkStartupError(error) };
        if (connection.kind === 'auth' || connection.kind === 'entitlement') invalidateWorkflows();
        dispatch({ type: 'settle', operation: id, connection });
        return connection;
      }
    })().finally(() => { if (inFlight.current?.promise === promise) inFlight.current = undefined; });
    inFlight.current = { revision: entry.revision ?? 0, promise };
    return promise;
  }, [cache, invalidateWorkflows, updateSettings]);
  useEffect(() => {
    const prepared = preparedUpdate.current;
    if (entry.enabled && prepared?.revision === (entry.revision ?? 0) && JSON.stringify(prepared.settings) === JSON.stringify(entry.settings)) {
      if (inFlight.current) inFlight.current.revision = entry.revision ?? 0;
      preparedUpdate.current = undefined;
    } else if (!entry.enabled) {
      controller.current?.abort(); inFlight.current = undefined;
      void cache.cancelQueries({ queryKey: ['opencode', entry.id] });
      cache.removeQueries({ queryKey: ['opencode', entry.id] });
      dispatch({ type: 'disable', operation: ++operation.current });
    } else if (hydrated && !getConnectCredentialError(entry.settings.connect, entry.settings.password)) void connect();
    return () => {
      const next = latest.current.entry;
      const pending = preparedUpdate.current;
      if (next.enabled && pending?.revision === (next.revision ?? 0) && JSON.stringify(pending.settings) === JSON.stringify(next.settings)) return;
      controller.current?.abort(); inFlight.current = undefined;
    };
  }, [cache, connect, entry.id, entry.enabled, entry.revision, entry.settings, hydrated]);
  const reconnect = useConnectionRetry({ active, paused: Boolean(entry.settings.connect), status: state.connection.status, kind: 'kind' in state.connection ? state.connection.kind : undefined, online, connect });
  const renewed = useRef('');
  const renewalPaused = setup.phase === 'waitingForApproval' || setup.phase === 'delayed';
  useEffect(() => {
    const metadata = entry.settings.connect;
    if (!entry.enabled || !metadata) return;
    let stopped = false;
    let expiryTimer: ReturnType<typeof setTimeout>;
    let refreshTimer: ReturnType<typeof setTimeout>;
    const paused = () => ['waitingForApproval', 'delayed'].includes(latest.current.setup.phase);
    const schedule = () => {
      clearTimeout(refreshTimer);
      if (paused()) return;
      const key = `${metadata.controlPlaneUrl}:${metadata.machineId}:${metadata.expiresAt}`;
      const recover = getConnectCredentialError(metadata, entry.settings.password) || latest.current.state.connection.status === 'error';
      if (!recover && renewed.current === key) return;
      const delay = recover ? 1000 : Math.min(Math.max(Date.parse(metadata.expiresAt) - Date.now() - 300_000, 1000), 2_147_483_647);
      refreshTimer = setTimeout(() => {
        if (AppState.currentState !== 'active' || paused()) return;
        renewed.current = key;
        void connect().then((result) => {
          if (stopped || AppState.currentState !== 'active') return;
          if (result.status !== 'connected') { renewed.current = ''; refreshTimer = setTimeout(schedule, 60_000); }
        });
      }, delay);
    };
    const check = () => {
      const error = getConnectCredentialError(metadata, entry.settings.password);
      if (error) {
        if (latest.current.state.connection.status !== 'error' || latest.current.state.connection.message !== error) {
          controller.current?.abort();
          void cache.cancelQueries({ queryKey: ['opencode', entry.id] });
          cache.removeQueries({ queryKey: ['opencode', entry.id] });
          invalidateWorkflows();
          dispatch({ type: 'settle', operation: ++operation.current, connection: { status: 'error', kind: 'auth', message: error, checkedAt: Date.now() } });
        }
        schedule(); return;
      }
      expiryTimer = setTimeout(check, Math.min(Date.parse(metadata.expiresAt) - Date.now(), 2_147_483_647));
    };
    check(); schedule();
    const listener = AppState.addEventListener('change', (state) => {
      clearTimeout(expiryTimer); clearTimeout(refreshTimer);
      if (state === 'active') { check(); schedule(); }
    });
    return () => { stopped = true; clearTimeout(expiryTimer); clearTimeout(refreshTimer); listener.remove(); };
  }, [cache, connect, entry.enabled, entry.id, entry.settings.connect, entry.settings.password, invalidateWorkflows, renewalPaused]);
  const handleStreamAuthFailure = useCallback((kind: ConnectionFailureKind) => {
    const { entry, state } = latest.current;
    if (state.connection.status === 'error' && state.connection.kind === kind) return;
    void cache.cancelQueries({ queryKey: ['opencode', entry.id] });
    cache.removeQueries({ queryKey: ['opencode', entry.id] });
    if (entry.settings.connect) { void connect(); return; }
    controller.current?.abort();
    invalidateWorkflows();
    dispatch({ type: 'settle', operation: ++operation.current, connection: { status: 'error', kind, message: kind === 'entitlement' ? 'Access was denied. Reconnect or restore access to continue.' : 'Authentication failed. Check the credentials and reconnect.', checkedAt: Date.now() } });
  }, [cache, connect, invalidateWorkflows]);
  return useMemo(() => ({ connection: entry.enabled ? state.connection : { status: 'idle' as const, message: 'Disconnected' }, serverContract: state.contract, connect, handleStreamAuthFailure, onInvalidated, reconnect }), [entry.enabled, state.connection, state.contract, connect, handleStreamAuthFailure, onInvalidated, reconnect]);
}

type Handle = ReturnType<typeof useConnectionLifecycle> & { catalogClient: ReturnType<typeof buildClient>; catalog: WorkspaceCatalog; isCurrentCatalogClient: (client: object) => boolean };
const ConnectionRuntimeContext = createContext<Handle | null>(null);
export function ConnectionRuntime({ entry, setup, updateSettings, online, hydrated, onCatalog, libraryVisible, children }: PropsWithChildren<{ entry: ConnectionRecord; setup: ConnectSetup; updateSettings: (id: string, settings: OpencodeConnectionSettings) => void; online: boolean; hydrated: boolean; libraryVisible: boolean; onCatalog: (id: string, catalog: WorkspaceCatalog) => void }>) {
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
  const sessions = useActiveSessions({ catalogClient, isCurrentCatalogClient, connectionScope: getConnectionScope(entry.settings), connected: entry.enabled && lifecycle.connection.status === 'connected', currentSessionId: undefined, hideSubagentChats: false, visible: active && libraryVisible });
  const catalog = useMemo<WorkspaceCatalog>(() => ({ sessions: sessions.catalogSessions, statuses: sessions.catalogStatuses, refresh: sessions.refreshActiveSessions, removeSession: sessions.removeSession }), [sessions.catalogSessions, sessions.catalogStatuses, sessions.refreshActiveSessions, sessions.removeSession]);
  const { refreshActiveSessions } = sessions;
  useEffect(() => { if (lifecycle.connection.status === 'connected') void refreshActiveSessions(); }, [lifecycle.connection.status, refreshActiveSessions]);
  useLayoutEffect(() => { onCatalog(entry.id, catalog); }, [catalog, entry.id, onCatalog]);
  const value = useMemo(() => ({ ...lifecycle, catalogClient, catalog, isCurrentCatalogClient }), [lifecycle, catalogClient, catalog, isCurrentCatalogClient]);
  return <ConnectionRuntimeContext.Provider value={value}>{children}</ConnectionRuntimeContext.Provider>;
}
export function useConnectionRuntime() {
  const value = useContext(ConnectionRuntimeContext);
  if (!value) throw new Error('Workspace requires its connection runtime.');
  return value;
}
