// App-wide workspace registry, connection focus, and persistence.
// See docs/architecture/state-and-data.md#state-ownership-overview.
import { findProfileByConnectionScope, type ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { loadConnectionProfiles } from '@/shared/storage/connection-profiles';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { HIDDEN_PROJECTS_MAX } from '@/shared/contracts/domain';
import { defaultConnectionSettings } from '@/shared/protocol/opencode/client';
import { ConnectionCatalog, useConnectionDemand, useConnectionRegistryBinding } from '@/runtime/connections/connection-runtime';
import { CURRENT_ONBOARDING_VERSION, isOnboardingComplete } from '@/features/onboarding/runtime';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ConnectionContextValue } from '@/features/connections/index';
import type { SessionDeepLinkTarget } from '@/shared/contracts/domain';
import { ServerDataScope } from '@/shared/server-data/client';
import { useAppUpdates } from '@/features/updates/runtime';
import { UpdatesContext } from '@/features/updates/context';
import { PreferencesContext } from '@/shared/preferences/context';
import { useConnectState , useServicesState } from '@/features/cloud-link/runtime';
import { useConnectionProfiles } from '@/features/connections/runtime';
import { useFileClipboard } from '@/features/projects/runtime';
import { useNetworkStatus } from '@/shared/network/use-network-status';
import { useOpencodePersistence } from '@/runtime/persistence/use-opencode-persistence';
import { useAppCore, useAppStore } from '@/runtime/core/context';
import { useShareState } from '@/features/sharing/runtime';
import { useVoiceSetupTest, VoiceSetupTestContext } from '@/features/voice/runtime';
import { useWorkspaceAutoApprove } from '@/runtime/composition/use-workspace-auto-approve';
import { useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import { serverPreferences } from '@/runtime/core/commands/connection';
import { useWorkspaceShellState } from '@/runtime/workspace/use-workspace-shell-state';
import { useWorkspaceValues, type WorkspaceValueOverrides } from '@/runtime/workspace/use-workspace-values';
import { WorkspaceActionsContext, WorkspaceContext, type WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import { librarySessions, useMissionOverview } from '@/features/sessions/runtime';
import { MISSION_PATH } from '@/shared/contracts/mission-control';
import { WorkspaceNative } from '@/runtime/composition/workspace-native';
import { useMissionWidget } from '@/features/widgets/runtime';
import { clearWorkspacePresentation, hasWorkspaceDrafts } from '@/runtime/presentation/workspace-presentation';
import { WorkspaceRuntime } from '@/runtime/workspace/workspace-runtime';
import { workspaceKey, type ConnectionRecord, type WorkspaceCatalog, type WorkspaceTarget } from '@/shared/contracts/workspace';
import type { SharedWorkspaceState, WorkspaceValues } from '@/runtime/workspace/workspace-types';
import { useCallback, useEffect, useMemo, useState, type PropsWithChildren, type SetStateAction } from 'react';
import { usePathname } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { migrateConnectConnectionScope } from '@/runtime/persistence/connection-refresh';
import { clearCapabilitiesSnapshots } from '@/features/ai/runtime';

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const core = useAppCore();
  const shell = useWorkspaceShellState();
  const pathname = usePathname();
  // One NetInfo owner for every retained project. See use-network-status.ts:
  // configure() is process-global and resets listeners.
  const network = useNetworkStatus();
  const { isHydrated } = useOpencodePersistence({ ...shell, defaultChatPreferences, defaultSettings: defaultConnectionSettings });
  const presentation = useAppStore((state) => state.presentation);
  // Catalog publications compose Query snapshots and command handles for the root view.
  const [catalogPublications, setCatalogs] = useState<Record<string, { revision?: number; catalog: WorkspaceCatalog }>>({});
  const publishCatalog = useCallback(({ id, revision }: ConnectionRecord, catalog: WorkspaceCatalog) => {
    setCatalogs((current) => current[id]?.catalog === catalog && current[id]?.revision === revision
      ? current : { ...current, [id]: { revision, catalog } });
  }, []);
  const profiles = useAppStore((state) => state.shell.profiles);
  const setProfiles = useCallback((value: SetStateAction<ConnectionProfile[]>) => core.store.getState().setShellValue('profiles', value), [core]);
  const onboardingCompleted = isOnboardingComplete(shell.onboardingVersion);
  const registryState = useAppStore((state) => state.registry);
  const manager = useWorkspaceConnections(isHydrated, {
    registry: registryState,
    commands: core.commands,
    hiddenProjects: shell.hiddenProjects,
  });
  useWorkspaceAutoApprove(manager);
  const { updateSettings: updateWorkspaceSettings, retry, change, removeConnection: removeWorkspaceConnection, connectedWorkspace, isEnabled } = manager;
  const { setFavoriteSessions, setSettings, setChatPreferences, setHiddenProjects } = shell;
  const { connections, focus, retainedFocus, snapshots, resolveKey, switchConnection, activate, navigate, openExternalSession, connectSavedProfile, disconnect } = manager;
  const catalogs = useMemo(() => {
    const current: Record<string, WorkspaceCatalog> = {};
    for (const { id, revision } of connections) {
      const published = catalogPublications[id];
      if (published && published.revision === revision) current[id] = published.catalog;
    }
    return current;
  }, [catalogPublications, connections]);
  const mission = useMissionOverview(connections, catalogs);
  const missionWidgetScope = JSON.stringify(connections.filter((entry) => entry.enabled)
    .map(({ id, authRevision }) => [id, authRevision, mission.servers.find((server) => server.id === id)?.authorized === false]));
  useMissionWidget(mission, missionWidgetScope, isHydrated && manager.ready, shell.chatPreferences.language);
  const fileClipboard = useFileClipboard(connections);
  const selectedRuntime = focus ? snapshots[resolveKey(focus)] : undefined;
  const current = selectedRuntime ?? (retainedFocus ? snapshots[resolveKey(retainedFocus)] : undefined);
  const settings = current?.values.connectionValue.settings ?? shell.settings;
  const settingsConnectionId = focus?.connectionId
    ?? (current ? getConnectionUiScope(current.values.connectionValue.settings) : undefined);
  const updateSettings = useCallback<ConnectionContextValue['updateSettings']>((patch) => {
    if (settingsConnectionId) updateWorkspaceSettings(settingsConnectionId, { ...settings, ...patch });
  }, [settingsConnectionId, updateWorkspaceSettings, settings]);
  const disconnectProfile = useCallback(async (profile: ConnectionProfile) => disconnect(getConnectionUiScope(profile)), [disconnect]);
  const isActiveProfile = useCallback((profile: ConnectionProfile) => isEnabled(getConnectionUiScope(profile)), [isEnabled]);
  const profileRefreshed = useCallback((previous: ConnectionProfile, next: ConnectionProfile) => {
    const oldScope = getConnectionScope(previous), newScope = getConnectionScope(next);
    setFavoriteSessions((items) => items.map((entry) => entry.connectionScope === oldScope ? { ...entry, connectionScope: newScope } : entry));
    if (oldScope === newScope) return;
    setHiddenProjects((items) => {
      if (!(oldScope in items)) return items;
      const nextItems = { ...items,
        [newScope]: [...new Set([...(items[newScope] ?? []), ...items[oldScope]])].slice(0, HIDDEN_PROJECTS_MAX) };
      delete nextItems[oldScope];
      return nextItems;
    });
  }, [setFavoriteSessions, setHiddenProjects]);
  const beforeProfileRefresh = useCallback(async () => {}, []);
  const connectSetup = useConnectState({ controlPlaneUrl: shell.controlPlaneUrl, setControlPlaneUrl: shell.setControlPlaneUrl,
    switchConnection, disconnect: disconnectProfile, isHydrated, activeMachineId: settings.connect?.machineId,
    beforeProfileRefresh, migrateConnectConnectionScope, profiles, setProfiles, onProfileRefreshed: profileRefreshed, isActiveProfile });
  useConnectionRegistryBinding(connectSetup, updateWorkspaceSettings, isHydrated);
  const profileSaved = useCallback((profile: ConnectionProfile, secrets: { password: string; headers: Record<string, string>; certificate?: import('@/shared/contracts/connection-certificate').ConnectionCertificate }, previous?: ConnectionProfile) => {
    const id = getConnectionUiScope(previous ?? profile);
    change((current) => current.map((entry) => entry.id === id ? { ...entry, name: profile.name } : entry));
    updateWorkspaceSettings(id, { serverUrl: profile.serverUrl, username: profile.username, connect: profile.connect, oidc: profile.oidc, password: secrets.password, headers: secrets.headers, certificate: secrets.certificate, directory: '' });
  }, [change, updateWorkspaceSettings]);
  const removeConnection = useCallback(async (id: string) => {
    await removeWorkspaceConnection(id);
    core.store.getState().clearPromptOutboxes(id);
    core.store.getState().clearWorkspaceUi(id);
    clearWorkspacePresentation(presentation, id);
    setCatalogs((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, [core, removeWorkspaceConnection, presentation]);
  const profileRemoved = useCallback(async (profile: ConnectionProfile) => removeConnection(getConnectionUiScope(profile)), [removeConnection]);
  const connectionProfiles = useConnectionProfiles({ clearCapabilitiesSnapshots, settings, switchConnection, updateSettings, profiles, setProfiles, onSaved: profileSaved, onRemoved: profileRemoved });
  const { servicesValue } = useServicesState({ settings, connectSetup, connections: manager.connections, visible: pathname === '/settings' || pathname === '/service' });
  const { terminalTarget, inspectionTarget } = registryState;
  const { selectTerminalTarget, inspect } = core.commands.workspace;
  const openSession = useCallback(async (target: SessionDeepLinkTarget, signal?: AbortSignal) => {
    try {
      let entry: Pick<ConnectionRecord, 'id' | 'projects' | 'enabled'> | undefined = target.connectionScope ? connections.find((value) => getConnectionScope(value.settings) === target.connectionScope) : connections.find((value) => value.id === focus?.connectionId);
      if (!entry && target.connectionScope) {
        const profile = findProfileByConnectionScope(await loadConnectionProfiles(), target.connectionScope);
        if (!profile) throw new Error('The saved connection for this session is not available.');
        await connectSavedProfile(profile, signal);
        entry = { id: getConnectionUiScope(profile), projects: [''], enabled: true };
      }
      if (!entry) throw new Error('The saved connection for this session is not available.');
      if (!entry.enabled) await retry(entry.id);
      await openExternalSession({ connectionId: entry.id, projectPath: target.projectPath ?? entry.projects[0] ?? '', sessionId: target.sessionId }, signal);
      return { ok: true };
    } catch (reason) { return { ok: false, error: reason instanceof Error ? reason.message : 'Could not open this chat.' }; }
  }, [connections, focus?.connectionId, openExternalSession, retry, connectSavedProfile]);
  // In-app library navigation. The session id came from rendered data, so this
  // resolves the owning connection locally and never validates against a
  // server list. Cross-server favorites still switch and connect the target.
  const openSessionInProject = useCallback(async (projectPath: string, sessionId: string, targetConnectionScope: string) => {
    const entry = connections.find((item) => getConnectionScope(item.settings) === targetConnectionScope);
    if (!entry) {
      // A favorite can outlive its workspace registration. That is an external
      // target rather than a rendered row, so resolve it through the saved
      // profile path instead of failing locally.
      const opened = await openSession({ projectPath, sessionId, connectionScope: targetConnectionScope });
      if (!opened.ok) throw new Error(opened.error);
      return;
    }
    if (!entry.enabled) await retry(entry.id);
    await navigate({ connectionId: entry.id, projectPath, sessionId });
  }, [connections, navigate, openSession, retry]);
  const { createChat, createChatInWorktree } = core.commands.workspace;
  const refreshTargets = useCallback(async () => {
    await Promise.all(Object.values(catalogs).map((catalog) => catalog.refresh()));
  }, [catalogs]);
  const shareTargets = useMemo(() => librarySessions(connections, snapshots, focus)
    .filter((row) => !shell.chatPreferences.hideSubagentChats || !row.session.parentID)
    .map((row) => ({ connectionScope: getConnectionScope(connections.find((entry) => entry.id === row.connectionId)!.settings),
      projectPath: row.projectPath, sessionId: row.sessionId, title: `${row.serverName} · ${row.session.title}` })), [connections, snapshots, focus, shell.chatPreferences.hideSubagentChats]);
  const sharedInput = useShareState({ hydrated: isHydrated, connectionScope: getConnectionScope(settings),
    projectPath: focus ? current?.values.projectsValue.activeProjectPath : undefined,
    currentSessionId: focus ? current?.values.currentSessionValue.currentSessionId : undefined,
    availableTargets: shareTargets,
    createAt: async (target) => {
      const entry = connections.find((item) => getConnectionScope(item.settings) === target.connectionScope);
      if (!entry) throw new Error('This server is no longer available.');
      const workspace = await connectedWorkspace({ connectionId: entry.id, projectPath: target.projectPath });
      return workspace.values.currentSessionValue.createSession();
    },
    sessions: current?.catalogSessions ?? [], hideSubagentChats: shell.chatPreferences.hideSubagentChats, refreshTargets,
    createSession: async () => { if (!current) throw new Error('Choose a workspace.'); return current.values.currentSessionValue.createSession(); }, openSession });
  const shared = useMemo<SharedWorkspaceState>(() => ({
    fileClipboard,
    controlPlaneUrl: shell.controlPlaneUrl, setControlPlaneUrl: shell.setControlPlaneUrl,
    onboardingVersion: shell.onboardingVersion, setOnboardingVersion: shell.setOnboardingVersion,
    onboardingActive: shell.onboardingActive, setOnboardingActive: shell.setOnboardingActive,
    favoriteSessions: shell.favoriteSessions, setFavoriteSessions: shell.setFavoriteSessions,
    hiddenProjects: shell.hiddenProjects, setHiddenProjects: shell.setHiddenProjects,
  }), [fileClipboard, shell.controlPlaneUrl, shell.setControlPlaneUrl, shell.onboardingVersion, shell.setOnboardingVersion,
    shell.onboardingActive, shell.setOnboardingActive, shell.favoriteSessions, shell.setFavoriteSessions,
    shell.hiddenProjects, shell.setHiddenProjects]);
  const voiceSetupTest = useVoiceSetupTest(shell.chatPreferences, Object.values(snapshots).some((snapshot) => snapshot.values.conversationValue.conversation.phase !== 'off'));
  const workspaceOverrides = useMemo<WorkspaceValueOverrides>(() => ({
    voiceSetupTest,
    isHydrated,
    onboardingCompleted,
    onboardingActive: shell.onboardingActive,
    connectionProfiles,
    connectSetup,
    servicesValue,
    sharedInput,
    retry,
    activate,
    switchConnection,
    openSession,
    openSessionInProject,
  }), [voiceSetupTest, activate, connectionProfiles, connectSetup, isHydrated, onboardingCompleted, openSession, openSessionInProject, retry, servicesValue, sharedInput, shell.onboardingActive, switchConnection]);
  const focusedValues = useWorkspaceValues(current?.values, workspaceOverrides);
  const valuesFor = useCallback((target?: WorkspaceTarget): WorkspaceValues | undefined => {
    const snapshot = target ? snapshots[resolveKey(target)] : current;
    if (!snapshot) return undefined;
    const values = snapshot.values;
    const id = getConnectionUiScope(values.connectionValue.settings);
    return { ...values,
      conversationValue: { ...values.conversationValue, toggleConversationMode: () => voiceSetupTest.runConversation(values.conversationValue.toggleConversationMode) },
      onboardingValue: { ...values.onboardingValue, isHydrated, onboardingCompleted, onboardingActive: shell.onboardingActive },
      connectionValue: { ...values.connectionValue, connect: () => retry(id), switchConnection, connectionProfiles, connectSetup, services: servicesValue },
      projectsValue: { ...values.projectsValue, selectProject: (projectPath) => { void activate({ connectionId: id, projectPath }); } },
      currentSessionValue: { ...values.currentSessionValue, openDeepLinkSession: openSession },
      sessionLibraryValue: { ...values.sessionLibraryValue, openSessionInProject: (projectPath, sessionId, connectionScope) => openSessionInProject(projectPath, sessionId, connectionScope ?? getConnectionScope(values.connectionValue.settings)) },
      chatValue: { ...values.chatValue, sharedInput },
    };
  }, [voiceSetupTest, activate, retry, connectionProfiles, connectSetup, current, onboardingCompleted, openSession, openSessionInProject, resolveKey, servicesValue, sharedInput, snapshots, switchConnection, isHydrated, shell.onboardingActive]);
  const registry = useMemo<WorkspaceRegistry>(() => ({ ...manager, createChat, createChatInWorktree, removeConnection,
    terminalTarget: connections.some((entry) => entry.id === terminalTarget?.connectionId) ? terminalTarget : undefined, selectTerminalTarget,
    inspectionTarget: connections.some((entry) => entry.id === inspectionTarget?.connectionId) ? inspectionTarget : undefined, inspect, valuesFor, catalogs, mission }), [manager, createChat, createChatInWorktree, removeConnection, connections, terminalTarget, selectTerminalTarget, inspectionTarget, inspect, valuesFor, catalogs, mission]);
  const updates = useAppUpdates({ initialized: isHydrated && shell.onboardingVersion >= CURRENT_ONBOARDING_VERSION && !shell.onboardingActive,
    blocked: Object.values(fileClipboard.busy).some(Boolean) || Object.values(snapshots).some((runtime) => runtime.busy) || connectSetup.busy || hasWorkspaceDrafts(presentation) });
  useEffect(() => {
    if (!current) return;
    setSettings(current.values.connectionValue.settings);
    const preferences = serverPreferences(current.values.preferencesValue.chatPreferences);
    setChatPreferences((previous) => JSON.stringify(serverPreferences(previous)) === JSON.stringify(preferences) ? previous : { ...previous, ...preferences });
  }, [current, setSettings, setChatPreferences]);
  const setFocusedValues = core.store.getState().setFocusedValues;
  useEffect(() => {
    setFocusedValues(focusedValues);
    return () => setFocusedValues(undefined);
  }, [focusedValues, setFocusedValues]);
  const readTarget = pathname === '/service' ? undefined : pathname === '/settings' ? inspectionTarget ?? focus
    : pathname === '/terminal' ? terminalTarget ?? focus : focus;
  useConnectionDemand(readTarget?.connectionId, network.online);
  const workspaceActions = useMemo(() => ({ createChat, createChatInWorktree, focus }), [createChat, createChatInWorktree, focus]);
  return <VoiceSetupTestContext.Provider value={voiceSetupTest}>
    <WorkspaceActionsContext.Provider value={workspaceActions}>
    <WorkspaceContext.Provider value={registry}>
    {connections.map((entry) => <ServerDataScope key={entry.id} connection={entry} active={readTarget?.connectionId === entry.id}>
      <ConnectionCatalog entry={entry} online={network.online} libraryVisible={pathname === '/' && focus?.connectionId === entry.id && Boolean(selectedRuntime?.libraryVisible)} missionVisible={pathname === MISSION_PATH} onCatalog={publishCatalog} />
    </ServerDataScope>)}
    {connections.flatMap((entry) => entry.projects.map((path, index) => {
        const key = workspaceKey({ connectionId: entry.id, projectPath: path });
        const visible = focus?.connectionId === entry.id && (focus.projectPath === path || current === snapshots[key]);
        const demanded = readTarget?.connectionId === entry.id && (readTarget.projectPath === path || readTarget === focus && visible);
        return <ServerDataScope key={key} connection={entry} active={demanded}><WorkspaceRuntime
          connection={entry} catalog={catalogs[entry.id]} switchConnection={switchConnection} projectPath={path || undefined} shared={shared} network={network} defaults={shell.chatPreferences} isHydrated={isHydrated}
          visible={visible} isConnectionOwner={index === 0} connectSetup={connectSetup} connectionProfiles={connectionProfiles} servicesValue={servicesValue}
          updateSettings={updateWorkspaceSettings} updatePreferences={manager.updatePreferences} publish={manager.publish} forget={manager.forget} />
        </ServerDataScope>;
    }))}
    {focusedValues && current ? <UpdatesContext.Provider value={updates}>
      <PreferencesContext.Provider value={focusedValues.preferencesValue}>
        <WorkspaceNative runtime={current} preferences={shell.chatPreferences} ready={isHydrated} active={Boolean(focus)} busy={Object.values(snapshots).some((runtime) => runtime.busy)} />
        {children}
      </PreferencesContext.Provider>
    </UpdatesContext.Provider> : <View style={{ flex: 1, backgroundColor: '#101212', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#C3CECB" /></View>}
    </WorkspaceContext.Provider>
    </WorkspaceActionsContext.Provider>
  </VoiceSetupTestContext.Provider>;
}
