import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';

import {
  findMatchingProfile,
  loadConnectionProfiles,
  pickModelPreferences,
  saveConnectionProfiles,
} from '@/lib/connection-profiles';
import { getConnectionScope } from '@/lib/connection-scope';
import { getConnectCredentialError } from '@/lib/connect';
import { saveConnectionPassword } from '@/lib/connection-password';
import {
  buildClient,
  detectServerContract,
  getConnectionError,
  getNormalizedServerUrl,
  isContractMismatchError,
  isRetryableCloudLinkStartupError,
  isValidServerUrl,
  type OpencodeConnectionSettings,
  type ScopedOpencodeClient,
  type ServerContract,
} from '@/lib/opencode/client';
import type { ConnectionProfile } from '@/lib/connection-profiles';
import type { ChatPreferences, ConnectionState, WorkspaceCatalog } from '@/providers/opencode-provider-types';
import { useConnectState } from '@/providers/use-connect-state';
import type { ConnectionActionsInput } from '@/providers/opencode-provider-action-inputs';

export function useConnectionConnectActions({
  settings,
  setSettings,
  controlPlaneUrl,
  setControlPlaneUrl,
  activeProjectPath,
  setActiveProjectPath,
  activeProjectPathRef,
  clearProjectState,
  isHydrated,
  isCurrentCatalogClient,
  loadWorkspaceCatalog,
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
  setFavoriteSessions,
  setLastSessionByConnection,
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
}: ConnectionActionsInput) {
  const prepareConnectSettingsRef = useRef<(settings: OpencodeConnectionSettings) => Promise<OpencodeConnectionSettings>>(async (value) => value);

  const runConnect = useCallback(async (targetSettings: OpencodeConnectionSettings): Promise<ConnectionState> => {
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
          settingsRef.current = prepared;
          setSettings(prepared);
          scopeGenerationRef.current += 1;
          serverGenerationRef.current += 1;
          generation = serverGenerationRef.current;
          clearProjectState();
        }
        targetSettings = prepared;
      } catch (reason) {
        if (!current()) return connectionRef.current;
        const failed: ConnectionState = { status: 'error', message: reason instanceof Error ? reason.message : 'Could not recover Cloud Link access.', checkedAt: Date.now() };
        setConnection(failed);
        return failed;
      }
    }
    const credentialError = getConnectCredentialError(targetSettings.connect, targetSettings.password);
    if (credentialError) {
      const failed: ConnectionState = { status: 'error', message: credentialError, checkedAt: Date.now() };
      setConnection(failed);
      return failed;
    }
    if (!isValidServerUrl(targetSettings.serverUrl)) {
      const failed: ConnectionState = {
        status: 'error',
        message: getConnectionError(targetSettings.serverUrl, new Error('Invalid server URL.')),
        checkedAt: Date.now(),
      };
      setConnection(failed);
      return failed;
    }

    setConnection({
      status: 'connecting',
      message: `Connecting to ${getNormalizedServerUrl(targetSettings.serverUrl)}...`,
    });

    let detectedContract = serverContractRef.current;
    try {
      detectedContract = (await detectServerContract(targetSettings)).contract;
    } catch {
      detectedContract = serverContractRef.current;
    }
    if (!current()) return connectionRef.current;

    const candidates: ServerContract[] = detectedContract === 'v1' ? ['v1', 'v2'] : ['v2', 'v1'];
    let catalog: WorkspaceCatalog | undefined;
    let activeCatalogClient: ScopedOpencodeClient | undefined;
    let usedContract: ServerContract | undefined;
    let lastError: unknown;

    for (const candidate of candidates) {
      const candidateClient = buildClient({ ...targetSettings, directory: '' }, candidate);
      catalogGenerationRef.current.set(candidateClient, serverGenerationRef.current);
      try {
        const result = await loadWorkspaceCatalog(true, candidateClient);
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
      const failed: ConnectionState = {
        status: 'error',
        message: getConnectionError(targetSettings.serverUrl, lastError ?? new Error('Could not reach the OpenCode server.')),
        retryableStartup: Boolean(targetSettings.connect) && isRetryableCloudLinkStartupError(lastError),
        checkedAt: Date.now(),
      };
      setConnection(failed);
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

    const projectDirectory = catalog.currentProjectPath || catalog.serverRootPath;
    const connected: ConnectionState = {
      status: 'connected',
      message: `Connected to ${getNormalizedServerUrl(targetSettings.serverUrl)} (OpenCode ${usedContract === 'v2' ? '2.x' : '1.x'})`,
      checkedAt: Date.now(),
      projectDirectory,
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
  }, [activeProjectPath, catalogGenerationRef, clearProjectState, isCurrentCatalogClient, loadWorkspaceCatalog, initialConnectStartedRef, serverContractRef, serverGenerationRef, scopeGenerationRef, settingsRef, setAvailableAgents, setAvailableModels, setAvailableProviders, setConnection, setCurrentConfig, setCurrentProjectPath, setProviderAuthMethodsById, setServerContract, setServerProjects, setServerRootPath, setSessionStatuses, setSessions, setSettings, serverProjectsRef, connectionRef]);

  const connect = useCallback(() => runConnect(settingsRef.current), [runConnect, settingsRef]);

  const updateSettings = useCallback((patch: Partial<OpencodeConnectionSettings>) => {
    const connectionChanged = (['serverUrl', 'username', 'password'] as const)
      .some((key) => patch[key] !== undefined && patch[key] !== settingsRef.current[key]);
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
    const profiles = await loadConnectionProfiles();
    const active = findMatchingProfile(profiles, settingsRef.current);
    if (!active) {
      return;
    }
    await saveConnectionProfiles(profiles.map((profile) => (
      profile.id === active.id ? { ...profile, modelPreferences: pickModelPreferences(chatPreferencesRef.current) } : profile
    )));
  }, [chatPreferencesRef, settingsRef]);

  const switchConnection = useCallback(async (
    next: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username' | 'password' | 'connect'>,
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

  const disconnectConnectProfile = useCallback(async (profile: ConnectionProfile) => {
    if (!findMatchingProfile([profile], settingsRef.current)) return;
    updateSettings({ serverUrl: '', username: '', password: '', connect: undefined });
    await saveConnectionPassword('');
  }, [settingsRef, updateSettings]);

  const onConnectProfileRefreshed = useCallback((previous: ConnectionProfile, next: ConnectionProfile) => {
    const oldScope = getConnectionScope(previous), newScope = getConnectionScope(next);
    if (oldScope === newScope) return;
    setFavoriteSessions((current) => current.map((entry) => entry.connectionScope === oldScope ? { ...entry, connectionScope: newScope } : entry));
    setLastSessionByConnection((current) => ({ ...current, [newScope]: { ...current[oldScope], ...current[newScope] } }));
  }, [setFavoriteSessions, setLastSessionByConnection]);

  const isActiveProfile = useCallback((profile: ConnectionProfile) => Boolean(settingsRef.current.connect && findMatchingProfile([profile], settingsRef.current)), [settingsRef]);
  const connectSetup = useConnectState({ controlPlaneUrl, setControlPlaneUrl, switchConnection, disconnect: disconnectConnectProfile, isHydrated, activeMachineId: settings.connect?.machineId, beforeProfileRefresh: captureActiveProfilePreferences, onProfileRefreshed: onConnectProfileRefreshed, isActiveProfile });
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
          setConnection({ status: 'error', message, checkedAt: Date.now() });
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

  return { connect, updateSettings, switchConnection, connectSetup };
}
