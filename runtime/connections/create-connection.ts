import type { QueryClient } from '@tanstack/react-query';

import { fetchProjectCatalog } from '@/features/projects/runtime';
import { sessionCatalogOptions } from '@/features/sessions/runtime';
import type { ConnectSetup } from '@/shared/contracts/cloud-link-setup';
import { getConnectCredentialError } from '@/shared/contracts/cloud-link';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import type { ConnectionState } from '@/shared/contracts/domain';
import { getNormalizedServerUrl, isValidServerUrl } from '@/shared/contracts/server-url';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import { telemetry } from '@/shared/observability/client';
import { createSharedEventStream } from '@/shared/network/shared-event-stream';
import { isCertificateFailureReason, isTlsTrustSupported, probeConnectionTrust } from '@/shared/platform/tls-trust';
import { buildClient, classifyConnectionFailure, detectServerContract, getCertificateErrorMessage, getConnectionError, isContractMismatchError, isRetryableCloudLinkStartupError, type ConnectionFailureKind, type OpencodeConnectionSettings, type ScopedOpencodeClient, type ServerContract } from '@/shared/protocol/opencode/client';
import type { QueryIdentity } from '@/shared/server-data/keys';
import { createRealtime } from '@/runtime/realtime/create-realtime';
import type { Foreground } from '@/runtime/realtime/transport';

import { createConnectionLifecycle } from './connection-lifecycle';
import { createEventInvalidation } from './event-invalidation';
import { createConnectionRetry } from './retry';

export type ConnectionInput = {
  entry: ConnectionRecord;
  identity: QueryIdentity;
  setup: Pick<ConnectSetup, 'phase' | 'prepareSettings'>;
  hydrated: boolean;
  translate: NonNullable<Parameters<typeof getConnectionError>[2]>;
  updateSettings: (id: string, settings: OpencodeConnectionSettings) => void;
};

const systemClock = {
  now: () => Date.now(),
  random: () => Math.random(),
  setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
  clearTimeout: (timer?: ReturnType<typeof setTimeout>) => clearTimeout(timer),
};

const MAX_TIMER_MS = 2_147_483_647;
const RENEW_LEAD_MS = 300_000;
const RENEW_RECHECK_MS = 60_000;

function isRenewalPaused(phase: ConnectSetup['phase']) {
  return phase === 'waitingForApproval' || phase === 'delayed';
}

export function createConnection({ queryClient, foreground, clock = systemClock }: {
  queryClient: QueryClient;
  foreground: Foreground;
  clock?: typeof systemClock;
}) {
  const lifecycle = createConnectionLifecycle();
  const invalidations = new Set<() => void>();
  let input: ConnectionInput | undefined;
  let operation = 0;
  let controller: AbortController | undefined;
  let inFlight: { revision: number; promise: Promise<ConnectionState> } | undefined;
  let preparedUpdate: { revision: number; settings: OpencodeConnectionSettings } | undefined;
  let countedContract: ServerContract | undefined;
  let renewed = '';
  let active = false;
  let online = true;
  let refreshingStale = false;
  let catalog: { settings: OpencodeConnectionSettings; contract: ServerContract; client: ScopedOpencodeClient } | undefined;

  const connectionState = () => lifecycle.getState().connection;
  const retry = createConnectionRetry(connect, clock);
  const events = createSharedEventStream();
  const eventInvalidation = createEventInvalidation(queryClient);
  const realtime = createRealtime(foreground, handleStreamAuthFailure, (event) => {
    if (input) eventInvalidation.receive(event, input.identity);
  });
  function getCatalogClient() {
    if (!input) return undefined;
    const { settings } = input.entry;
    const { contract } = lifecycle.getState();
    if (catalog?.settings !== settings || catalog.contract !== contract) {
      catalog = { settings, contract, client: buildClient({ ...settings, directory: '' }, contract) };
    }
    return catalog.client;
  }
  const updateActivity = () => {
    const state = connectionState();
    retry.update(state, active && Boolean(input?.entry.enabled) && !input?.entry.settings.connect, online);
    const entry = input?.entry;
    const refresh = entry?.enabled === true && active && online && state.status === 'connected';
    if (entry && refresh && !refreshingStale) {
      void queryClient.refetchQueries({ queryKey: ['opencode', entry.id], stale: true, type: 'active' }, { cancelRefetch: false });
    }
    refreshingStale = refresh;
    const client = entry?.enabled && online && state.status === 'connected' ? getCatalogClient() : undefined;
    realtime.setTransport(client ? { client, subscribe: events } : undefined);
  };
  const stopActivity = lifecycle.subscribe(updateActivity);
  const invalidateWorkflows = () => { for (const listener of invalidations) listener(); };
  const clearPartition = (id: string) => {
    void queryClient.cancelQueries({ queryKey: ['opencode', id] });
    queryClient.removeQueries({ queryKey: ['opencode', id] });
  };
  const abortPending = () => {
    controller?.abort();
    controller = undefined;
    inFlight = undefined;
  };
  const isPrepared = (entry: ConnectionRecord) => entry.enabled && preparedUpdate?.revision === (entry.revision ?? 0)
    && JSON.stringify(preparedUpdate.settings) === JSON.stringify(entry.settings);

  function connect(): Promise<ConnectionState> {
    if (!input?.entry.enabled) return Promise.resolve({ status: 'idle', message: 'Disconnected' });
    const { entry, setup, identity, translate, updateSettings } = input;
    const revision = entry.revision ?? 0;
    if (inFlight?.revision === revision) return inFlight.promise;
    abortPending();
    const attempt = new AbortController();
    controller = attempt;
    const id = ++operation;
    const current = () => operation === id && !attempt.signal.aborted;
    const kind = entry.settings.connect ? 'cloud-link' : 'direct';
    const promise = Promise.resolve().then(async (): Promise<ConnectionState> => {
      let settings = entry.settings;
      try {
        if (!current()) return connectionState();
        if (settings.connect) settings = await setup.prepareSettings(settings);
        if (!current()) return connectionState();
        const invalid = getConnectCredentialError(settings.connect, settings.password, clock.now());
        if (invalid) throw new Error(invalid);
        if (!isValidServerUrl(settings.serverUrl)) throw new Error('Invalid server URL.');
        if (settings !== entry.settings && JSON.stringify(settings) !== JSON.stringify(entry.settings)) {
          preparedUpdate = { revision: revision + 1, settings };
          updateSettings(entry.id, settings);
        }
        lifecycle.dispatch({ type: 'probe', operation: id });
        const detected = await detectServerContract(settings, attempt.signal);
        const candidates: ServerContract[] = detected.contract === 'v1' ? ['v1', 'v2'] : ['v2', 'v1'];
        const preparedIdentity = {
          ...identity,
          connectionScope: getConnectionScope(settings),
          authRevision: identity.authRevision + (settings.password !== entry.settings.password || settings.username !== entry.settings.username ? 1 : 0),
        };
        let failure: unknown;
        for (const contract of candidates) {
          if (!current()) return connectionState();
          const client = buildClient({ ...settings, directory: '' }, contract, attempt.signal);
          try {
            await fetchProjectCatalog(queryClient, preparedIdentity, client, true);
            if (!current()) return connectionState();
            const connection: ConnectionState = { status: 'connected', message: `Connected to ${getNormalizedServerUrl(settings.serverUrl)} (OpenCode ${contract === 'v2' ? '2.x' : '1.x'})`, checkedAt: clock.now() };
            if (countedContract !== contract) {
              countedContract = contract;
              telemetry.counter('server.contract', 1, { contract });
            }
            telemetry.info('connection.connected', { kind, connected: true });
            telemetry.markStartup('connection-ready', { kind });
            lifecycle.dispatch({ type: 'settle', operation: id, connection, contract });
            const catalogClient = getCatalogClient();
            if (current() && catalogClient) {
              void queryClient.fetchQuery({ ...sessionCatalogOptions(preparedIdentity, catalogClient), staleTime: 0 }).catch(() => undefined);
            }
            return connection;
          } catch (error) { failure = error; if (!isContractMismatchError(error)) break; }
        }
        throw failure;
      } catch (error) {
        if (!current()) return connectionState();
        let failureKind = classifyConnectionFailure(error);
        let message = getConnectionError(settings.serverUrl, error, translate);
        if ((failureKind === 'unknown' || failureKind === 'certificate') && settings.serverUrl.startsWith('https:') && isTlsTrustSupported()) {
          const tls = await probeConnectionTrust(settings);
          if (!current()) return connectionState();
          if (!tls.ok && isCertificateFailureReason(tls.reason)) {
            failureKind = 'certificate';
            message = getCertificateErrorMessage(tls.reason, translate);
          }
        }
        const connection: ConnectionState = { status: 'error', kind: failureKind, message, checkedAt: clock.now(), retryableStartup: Boolean(settings.connect) && isRetryableCloudLinkStartupError(error) };
        telemetry.warn('connection.failed', { kind, failureKind, retryable: connection.retryableStartup });
        if (failureKind === 'auth' || failureKind === 'entitlement') invalidateWorkflows();
        lifecycle.dispatch({ type: 'settle', operation: id, connection });
        return connection;
      }
    }).finally(() => { if (inFlight?.promise === promise) inFlight = undefined; });
    inFlight = { revision, promise };
    lifecycle.dispatch({ type: 'start', operation: id, message: `Connecting to ${getNormalizedServerUrl(entry.settings.serverUrl)}...` });
    return promise;
  }

  function syncConnection() {
    if (!input) return;
    const { entry, hydrated } = input;
    if (isPrepared(entry)) {
      if (inFlight) inFlight.revision = entry.revision ?? 0;
      preparedUpdate = undefined;
    } else if (!entry.enabled) {
      abortPending();
      clearPartition(entry.id);
      lifecycle.dispatch({ type: 'disable', operation: ++operation });
    } else if (hydrated && !getConnectCredentialError(entry.settings.connect, entry.settings.password, clock.now())) {
      void connect();
    }
    return () => { if (!input || !isPrepared(input.entry)) abortPending(); };
  }

  function syncRenewal() {
    const entry = input?.entry;
    const metadata = entry?.settings.connect;
    if (!entry?.enabled || !metadata) return;
    const paused = () => !input || isRenewalPaused(input.setup.phase);
    let stopped = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clock.clearTimeout(refreshTimer);
      if (stopped || paused()) return;
      const key = `${metadata.controlPlaneUrl}:${metadata.machineId}:${metadata.expiresAt}`;
      const recover = getConnectCredentialError(metadata, entry.settings.password, clock.now()) || connectionState().status === 'error';
      if (!recover && renewed === key) return;
      const remaining = Date.parse(metadata.expiresAt) - clock.now() - RENEW_LEAD_MS;
      const capped = !recover && remaining > MAX_TIMER_MS;
      // Keep best-effort renewal before expiry and stagger devices on the same machine.
      const jitter = capped ? 0 : Math.floor(clock.random() * RENEW_RECHECK_MS);
      const delay = recover ? 1000 : Math.min(Math.max(remaining - jitter, 1000), MAX_TIMER_MS);
      refreshTimer = clock.setTimeout(() => {
        if (!foreground.isActive() || paused()) return;
        renewed = key;
        void connect().then((result) => {
          if (stopped || !foreground.isActive()) return;
          if (result.status !== 'connected') { renewed = ''; refreshTimer = clock.setTimeout(schedule, RENEW_RECHECK_MS); return; }
          if (capped) { renewed = ''; schedule(); }
        });
      }, delay);
    };
    const check = () => {
      const error = getConnectCredentialError(metadata, entry.settings.password, clock.now());
      if (error) {
        const connection = connectionState();
        if (connection.status !== 'error' || connection.message !== error) {
          abortPending();
          clearPartition(entry.id);
          invalidateWorkflows();
          lifecycle.dispatch({ type: 'settle', operation: ++operation, connection: { status: 'error', kind: 'auth', message: error, checkedAt: clock.now() } });
        }
        schedule();
        return;
      }
      expiryTimer = clock.setTimeout(check, Math.min(Date.parse(metadata.expiresAt) - clock.now(), MAX_TIMER_MS));
    };
    const clearTimers = () => { clock.clearTimeout(expiryTimer); clock.clearTimeout(refreshTimer); };
    check(); schedule();
    const unsubscribe = foreground.subscribe((active) => {
      clearTimers();
      if (active) { check(); schedule(); }
    });
    return () => { stopped = true; clearTimers(); unsubscribe(); };
  }

  function handleStreamAuthFailure(kind: ConnectionFailureKind) {
    if (!input) return;
    const { entry, translate } = input;
    const connection = connectionState();
    if (connection.status === 'error' && connection.kind === kind) return;
    telemetry.warn('connection.auth-failed', { failureKind: kind });
    clearPartition(entry.id);
    if (entry.settings.connect) { void connect(); return; }
    abortPending();
    invalidateWorkflows();
    const oidcMessage = entry.settings.oidc ? translate('settings:connection.errors.oidcSignIn') : undefined;
    lifecycle.dispatch({ type: 'settle', operation: ++operation, connection: { status: 'error', kind, message: oidcMessage ?? (kind === 'entitlement' ? 'Access was denied. Reconnect or restore access to continue.' : 'Authentication failed. Check the credentials and reconnect.'), checkedAt: clock.now() } });
  }

  return {
    getState: lifecycle.getState,
    subscribe: lifecycle.subscribe,
    setInput(next: ConnectionInput) {
      if (input?.entry.settings !== next.entry.settings || input?.identity.authRevision !== next.identity.authRevision
        || input?.identity.connectionScope !== next.identity.connectionScope) eventInvalidation.reset();
      input = next;
    },
    setDemand(nextActive: boolean, nextOnline: boolean) {
      active = nextActive;
      online = nextOnline;
      updateActivity();
    },
    retry,
    realtime,
    events: { observe: events.observe, observeHealth: events.observeHealth, isHealthy: events.isHealthy },
    getCatalogClient,
    dispose() { stopActivity(); retry.dispose(); realtime.dispose(); eventInvalidation.reset(); },
    onInvalidated: (listener: () => void) => { invalidations.add(listener); return () => { invalidations.delete(listener); }; },
    connect,
    syncConnection,
    syncRenewal,
    handleStreamAuthFailure,
  };
}
