import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import {
  findMatchingProfile,
  loadConnectionProfiles,
  pickModelPreferences,
  mutateConnectionProfiles,
} from '@/lib/connection-profiles';
import { getConnectCredentialError } from '@/lib/connect';
import { connectionHeadersKey, sameConnectionHeaders } from '@/lib/connection-headers';
import {
  buildClient,
  classifyConnectionFailure,
  detectServerContract,
  getConnectionError,
  getNormalizedServerUrl,
  isContractMismatchError,
  isAuthConnectionFailure,
  isRetryableCloudLinkStartupError,
  isValidServerUrl,
  type ConnectionFailureKind,
  type OpencodeConnectionSettings,
  type ScopedOpencodeClient,
  type ServerContract,
} from '@/lib/opencode/client';
import type { ChatPreferences, ConnectionState, ProjectCatalog } from '@/providers/opencode-provider-types';
import type { ConnectSetup } from '@/providers/use-connect-state';
import type { ConnectionActionsInput } from '@/providers/opencode-provider-action-inputs';

// Joining concurrent connects is keyed on the exact credentials and generation
// so a rotation that lands mid-flight starts a new attempt instead of adopting
// stale credentials.
function getConnectRequestKey(settings: OpencodeConnectionSettings, generation: number) {
  return [generation, settings.serverUrl, settings.username, settings.password, connectionHeadersKey(settings.headers), settings.connect?.machineId ?? '', settings.connect?.expiresAt ?? ''].join('\u0000');
}

export function useConnectionConnectActions({
  settings,
  connectSetup,
  setSettings,
  activeProjectPath,
  setActiveProjectPath,
  activeProjectPathRef,
  clearProjectState,
  softResetProjectState,
  isHydrated,
  isCurrentCatalogClient,
  loadProjectCatalog,
  serverProjectsRef,
  setServerProjects,
  setCurrentProjectPath,
  setServerRootPath,
  setSessions,
  setSessionStatuses,
  setCurrentConfig,
  setAvailableProviders,
  setProviderAuthMethodsById,
  setAvailableModels,
  setAvailableAgents,
  setMessagesBySession,
  setDiffsBySession,
  setTodosBySession,
  setChatPreferences,
  setDiagnostics,
  setSendingState,
  setConnection,
  setServerContract,
  settingsRef,
  chatPreferencesRef,
  serverContractRef,
  connectionRef,
  serverGenerationRef,
  catalogGenerationRef,
  scopeGenerationRef,
  initialConnectStartedRef,
}: ConnectionActionsInput & { connectSetup: ConnectSetup }) {
  const { t } = useTranslation();
  const prepareConnectSettingsRef = useRef<(settings: OpencodeConnectionSettings) => Promise<OpencodeConnectionSettings>>(async (value) => value);
  const connectInFlightRef = useRef<{ key: string; promise: Promise<ConnectionState> } | undefined>(undefined);

  const performConnect = useCallback(async (targetSettings: OpencodeConnectionSettings, onPrepared?: (prepared: OpencodeConnectionSettings) => void): Promise<ConnectionState> => {
    initialConnectStartedRef.current = true;
    let generation = serverGenerationRef.current;
    const current = () => generation === serverGenerationRef.current;
    if (targetSettings.connect) {
      try {
        const prepared = await prepareConnectSettingsRef.current(targetSettings);
        if (!current()) return connectionRef.current;
        const credentialError = getConnectCredentialError(prepared.connect, prepared.password);
        if (credentialError) throw new Error(credentialError);
        if (prepared.serverUrl !== settingsRef.current.serverUrl || prepared.username !== settingsRef.current.username || prepared.password !== settingsRef.current.password || prepared.connect?.expiresAt !== settingsRef.current.connect?.expiresAt) {
          const previous = settingsRef.current;
          const sameMachineRotation = Boolean(
            prepared.connect && previous.connect
            && prepared.connect.controlPlaneUrl === previous.connect.controlPlaneUrl
            && prepared.connect.machineId === previous.connect.machineId
            && prepared.serverUrl === previous.serverUrl,
          );
          settingsRef.current = prepared;
          setSettings(prepared);
          scopeGenerationRef.current += 1;
          serverGenerationRef.current += 1;
          generation = serverGenerationRef.current;
          // A same-machine credential renewal keeps project, session, terminal
          // and editor state; only client-bound in-flight bookkeeping resets.
          if (sameMachineRotation) softResetProjectState(); else clearProjectState();
        }
        targetSettings = prepared;
        onPrepared?.(prepared);
      } catch (reason) {
        if (!current()) return connectionRef.current;
        const failed: ConnectionState = { status: 'error', message: reason instanceof Error ? reason.message : 'Could not recover Cloud Link access.', kind: classifyConnectionFailure(reason), checkedAt: Date.now() };
        setConnection(failed);
        return failed;
      }
    }
    const credentialError = getConnectCredentialError(targetSettings.connect, targetSettings.password);
    if (credentialError) {
      const failed: ConnectionState = { status: 'error', message: credentialError, kind: 'auth', checkedAt: Date.now() };
      setConnection(failed);
      return failed;
    }
    if (!isValidServerUrl(targetSettings.serverUrl)) {
      const failed: ConnectionState = {
        status: 'error',
        message: getConnectionError(targetSettings.serverUrl, new Error('Invalid server URL.'), t),
        kind: 'unknown',
        checkedAt: Date.now(),
      };
      setConnection(failed);
      return failed;
    }

    setConnection({
      status: 'connecting',
      message: `Connecting to ${getNormalizedServerUrl(targetSettings.serverUrl)}...`,
    });

    let detectedContract: ServerContract = 'v2';
    try {
      detectedContract = (await detectServerContract(targetSettings)).contract;
    } catch {
      detectedContract = 'v2';
    }
    if (!current()) return connectionRef.current;

    const candidates: ServerContract[] = detectedContract === 'v1' ? ['v1', 'v2'] : ['v2', 'v1'];
    let catalog: ProjectCatalog | undefined;
    let activeCatalogClient: ScopedOpencodeClient | undefined;
    let usedContract: ServerContract | undefined;
    let lastError: unknown;

    for (const candidate of candidates) {
      const candidateClient = buildClient({ ...targetSettings, directory: '' }, candidate);
      catalogGenerationRef.current.set(candidateClient, serverGenerationRef.current);
      try {
        const result = await loadProjectCatalog(true, candidateClient);
        if (!isCurrentCatalogClient(candidateClient)) {
          return connectionRef.current;
        }
        catalog = result;
        activeCatalogClient = candidateClient;
        usedContract = candidate;
        break;
      } catch (error) {
        if (!current()) return connectionRef.current;
        lastError = error;
        if (!isContractMismatchError(error)) {
          break;
        }
      }
    }

    if (!catalog || !activeCatalogClient || !usedContract) {
      const failure = lastError ?? new Error('Could not reach the OpenCode server.');
      const failed: ConnectionState = {
        status: 'error',
        message: getConnectionError(targetSettings.serverUrl, failure, t),
        retryableStartup: Boolean(targetSettings.connect) && isRetryableCloudLinkStartupError(lastError),
        kind: classifyConnectionFailure(failure),
        checkedAt: Date.now(),
      };
      setConnection(failed);
      if (!isAuthConnectionFailure(failed.kind ?? 'unknown')) return failed;
      serverProjectsRef.current = [];
      setServerProjects([]);
      setCurrentProjectPath(undefined);
      setServerRootPath(undefined);
      setSessions([]);
      setSessionStatuses({});
      setCurrentConfig(undefined);
      setAvailableProviders([]);
      setProviderAuthMethodsById({});
      setAvailableModels([]);
      setAvailableAgents([]);
      return failed;
    }

    if (usedContract !== serverContractRef.current) {
      serverContractRef.current = usedContract;
      setServerContract(usedContract);
    }

    const connected: ConnectionState = {
      status: 'connected',
      message: `Connected to ${getNormalizedServerUrl(targetSettings.serverUrl)} (OpenCode ${usedContract === 'v2' ? '2.x' : '1.x'})`,
      checkedAt: Date.now(),
    };
    setConnection(connected);

    if (!activeProjectPath && !catalog.currentProjectPath && !catalog.serverProjects[0]?.worktree) {
      setSessions([]);
      setSessionStatuses({});
      setCurrentConfig(undefined);
      setAvailableProviders([]);
      setProviderAuthMethodsById({});
      setAvailableModels([]);
      setAvailableAgents([]);
    }

    return connected;
  }, [activeProjectPath, catalogGenerationRef, clearProjectState, softResetProjectState, isCurrentCatalogClient, loadProjectCatalog, initialConnectStartedRef, serverContractRef, serverGenerationRef, scopeGenerationRef, settingsRef, setAvailableAgents, setAvailableModels, setAvailableProviders, setConnection, setCurrentConfig, setCurrentProjectPath, setProviderAuthMethodsById, setServerContract, setServerProjects, setServerRootPath, setSessionStatuses, setSessions, setSettings, serverProjectsRef, connectionRef]);

  const runConnect = useCallback((targetSettings: OpencodeConnectionSettings) => {
    const inFlight = connectInFlightRef.current;
    if (inFlight && inFlight.key === getConnectRequestKey(targetSettings, serverGenerationRef.current)) return inFlight.promise;
    const record = { key: '', promise: Promise.resolve(connectionRef.current) };
    record.promise = performConnect(targetSettings, (prepared) => {
      record.key = getConnectRequestKey(prepared, serverGenerationRef.current);
    }).finally(() => {
      if (connectInFlightRef.current === record) connectInFlightRef.current = undefined;
    });
    record.key = getConnectRequestKey(targetSettings, serverGenerationRef.current);
    connectInFlightRef.current = record;
    return record.promise;
  }, [connectionRef, performConnect, serverGenerationRef]);

  const connect = useCallback(() => runConnect(settingsRef.current), [runConnect, settingsRef]);

  // A revoked or invalid credential on the data plane cannot heal by retrying.
  // Cloud Link reuses its prepared credential/recovery path; manual servers ask
  // the user to reconnect. Server-derived caches are cleared, project
  // selection is not.
  const handleStreamAuthFailure = useCallback((kind: ConnectionFailureKind) => {
    if (settingsRef.current.connect) {
      void connect().catch(() => undefined);
      return;
    }
    if (connectionRef.current.status === 'error' && connectionRef.current.kind === kind) return;
    scopeGenerationRef.current += 1;
    serverGenerationRef.current += 1;
    clearProjectState();
    setSendingState({ active: false });
    setConnection({
      status: 'error',
      kind,
      message: kind === 'entitlement'
        ? 'Access was denied. Reconnect or restore access to continue.'
        : 'Authentication failed. Check the credentials and reconnect.',
      checkedAt: Date.now(),
    });
  }, [clearProjectState, connect, connectionRef, scopeGenerationRef, serverGenerationRef, setConnection, setSendingState, settingsRef]);

  const updateSettings = useCallback((patch: Partial<OpencodeConnectionSettings>) => {
    const connectionChanged = (['serverUrl', 'username', 'password'] as const)
      .some((key) => patch[key] !== undefined && patch[key] !== settingsRef.current[key])
      || (patch.headers !== undefined && !sameConnectionHeaders(patch.headers, settingsRef.current.headers));
    if (connectionChanged) {
      scopeGenerationRef.current += 1;
      serverGenerationRef.current += 1;
      setConnection({ status: 'idle', message: 'Connection settings changed. Reconnect to apply them.' });
      setActiveProjectPath(undefined);
      activeProjectPathRef.current = undefined;
      clearProjectState();
      setMessagesBySession({});
      setDiffsBySession({});
      setTodosBySession({});
      serverProjectsRef.current = [];
      setServerProjects([]);
      setCurrentProjectPath(undefined);
      setServerRootPath(undefined);
      setDiagnostics(undefined);
    }
    setSettings((current) => ({
      ...current,
      ...patch,
      connect: connectionChanged ? patch.connect : current.connect,
    }));
  }, [activeProjectPathRef, clearProjectState, scopeGenerationRef, serverGenerationRef, serverProjectsRef, settingsRef, setActiveProjectPath, setConnection, setCurrentProjectPath, setDiagnostics, setDiffsBySession, setMessagesBySession, setServerRootPath, setServerProjects, setSettings, setTodosBySession]);

  const captureActiveProfilePreferences = useCallback(async () => {
    const identity = settingsRef.current;
    const modelPreferences = pickModelPreferences(chatPreferencesRef.current);
    await mutateConnectionProfiles(async (profiles, save) => {
      const active = findMatchingProfile(profiles, identity);
      if (!active) {
        return;
      }
      await save(profiles.map((profile) => (
        profile.id === active.id ? { ...profile, modelPreferences } : profile
      )));
    });
  }, [chatPreferencesRef, settingsRef]);

  const switchConnection = useCallback(async (
    next: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username' | 'password' | 'headers' | 'connect'>,
    modelPreferences?: Partial<ChatPreferences>,
  ) => {
    await captureActiveProfilePreferences().catch(() => undefined);

    const connectMetadata = next.connect ?? findMatchingProfile(await loadConnectionProfiles(), next)?.connect;
    const targetSettings: OpencodeConnectionSettings = {
      ...settingsRef.current,
      ...next,
      connect: connectMetadata,
    };
    if (connectMetadata && settingsRef.current.connect?.controlPlaneUrl === connectMetadata.controlPlaneUrl
      && settingsRef.current.connect.machineId === connectMetadata.machineId) {
      return runConnect(targetSettings);
    }
    updateSettings({ ...next, connect: connectMetadata });
    settingsRef.current = targetSettings;
    if (modelPreferences) {
      setChatPreferences((current) => ({ ...current, ...modelPreferences }));
    }

    return runConnect(targetSettings);
  }, [captureActiveProfilePreferences, runConnect, settingsRef, setChatPreferences, updateSettings]);

  const connectPhaseRef = useRef(connectSetup.phase);
  const activationPaused = connectSetup.phase === 'waitingForApproval' || connectSetup.phase === 'delayed';
  useLayoutEffect(() => {
    prepareConnectSettingsRef.current = connectSetup.prepareSettings;
    connectPhaseRef.current = connectSetup.phase;
  });

  const connectAccessRefreshRef = useRef('');
  useEffect(() => {
    if (!isHydrated || !settings.connect) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let refreshTimer: ReturnType<typeof setTimeout>;
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      if (connectPhaseRef.current === 'waitingForApproval' || connectPhaseRef.current === 'delayed') return;
      const remaining = Date.parse(settings.connect!.expiresAt) - Date.now();
      const refreshKey = `${settings.connect!.controlPlaneUrl}:${settings.connect!.machineId}:${settings.connect!.expiresAt}`;
      const recover = getConnectCredentialError(settings.connect, settings.password) || connectionRef.current.status === 'error';
      if (!recover && connectAccessRefreshRef.current === refreshKey) return;
      refreshTimer = setTimeout(() => {
        if (AppState.currentState === 'active' && connectPhaseRef.current !== 'waitingForApproval' && connectPhaseRef.current !== 'delayed') {
          connectAccessRefreshRef.current = refreshKey;
          void connect().then((result) => {
            if (cancelled || AppState.currentState !== 'active') return;
            if (result.status !== 'connected') { connectAccessRefreshRef.current = ''; refreshTimer = setTimeout(scheduleRefresh, 60_000); }
          });
        }
      }, recover ? 1000 : Math.min(Math.max(remaining - 5 * 60_000, 1000), 2_147_483_647));
    };
    const check = () => {
      const message = getConnectCredentialError(settings.connect, settings.password);
      if (message) {
        if (connectionRef.current.status !== 'error' || connectionRef.current.message !== message) {
          scopeGenerationRef.current += 1;
          serverGenerationRef.current += 1;
          clearProjectState();
          setSendingState({ active: false });
          setConnection({ status: 'error', message, kind: 'auth', checkedAt: Date.now() });
        }
        scheduleRefresh();
        return;
      }
      timer = setTimeout(check, Math.min(Date.parse(settings.connect!.expiresAt) - Date.now(), 2_147_483_647));
    };
    check();
    scheduleRefresh();
    const subscription = AppState.addEventListener('change', (state) => {
      clearTimeout(timer); clearTimeout(refreshTimer);
      if (state === 'active') { check(); scheduleRefresh(); }
    });
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(refreshTimer); subscription.remove(); };
  }, [activationPaused, clearProjectState, connect, connectionRef, isHydrated, scopeGenerationRef, serverGenerationRef, setConnection, setSendingState, settings.connect, settings.password]);

  return { connect, updateSettings, switchConnection, connectSetup, handleStreamAuthFailure };
}
