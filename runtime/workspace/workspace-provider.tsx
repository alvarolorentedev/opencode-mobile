// App-wide workspace registry, connection focus, and persistence.
// See docs/architecture/state-and-data.md#state-ownership-overview.
import { getProfileHeaders } from '@/shared/storage/connection-headers';
import { findProfileByConnectionScope, type ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { getProfilePassword, loadConnectionProfiles } from '@/shared/storage/connection-profiles';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { defaultConnectionSettings } from '@/shared/protocol/opencode/client';
import { ConnectionRuntime } from '@/runtime/connections/connection-runtime';
import { CURRENT_ONBOARDING_VERSION, isOnboardingComplete } from '@/features/onboarding/runtime';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import { OpencodeProviderTree } from '@/runtime/workspace/domain-provider-tree';
import type { ConnectionContextValue } from '@/features/connections/index';
import type { SessionDeepLinkTarget } from '@/shared/contracts/domain';
import { ServerDataActivity, ServerDataScope } from '@/shared/server-data/client';
import { useAppUpdates } from '@/features/updates/runtime';
import { useConnectState , useServicesState } from '@/features/cloud-link/runtime';
import { useConnectionProfiles } from '@/features/connections/runtime';
import { useFileClipboard } from '@/features/projects/runtime';
import { useNetworkStatus } from '@/shared/network/use-network-status';
import { useOpencodePersistence } from '@/runtime/persistence/use-opencode-persistence';
import { useShareState } from '@/features/sharing/runtime';
import { useVoiceSetupTest, VoiceSetupTestContext } from '@/features/voice/runtime';
import { useWorkspaceAutoApprove } from '@/runtime/composition/use-workspace-auto-approve';
import { serverPreferences, useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import { useWorkspaceShellState } from '@/runtime/workspace/use-workspace-shell-state';
import { useWorkspaceValues, type WorkspaceValueOverrides } from '@/runtime/workspace/use-workspace-values';
import { WorkspaceActionsContext, WorkspaceContext, WorkspacePresentationContext, type WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import { librarySessions } from '@/features/sessions/runtime';
import { WorkspaceNative } from '@/runtime/composition/workspace-native';
import { clearWorkspacePresentation, hasWorkspaceDrafts } from '@/runtime/presentation/workspace-presentation';
import { projectClosedValues } from '@/runtime/workspace/workspace-projection';
import { WorkspaceRuntime } from '@/runtime/workspace/workspace-runtime';
import { workspaceKey, type ConnectionRecord, type NewWorktreeChatResult, type NewWorktreeChatTarget, type WorkspaceCatalog, type WorkspaceTarget } from '@/shared/contracts/workspace';
import type { SharedWorkspaceState, WorkspaceValues } from '@/runtime/workspace/workspace-types';
import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { usePathname } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { migrateConnectConnectionScope } from '@/runtime/persistence/connection-refresh';
import { clearCapabilitiesSnapshots } from '@/features/ai/runtime';

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const shell = useWorkspaceShellState();
  const pathname = usePathname();
  // One NetInfo owner for every retained project. See use-network-status.ts:
  // configure() is process-global and resets listeners.
  const network = useNetworkStatus();
  const { isHydrated } = useOpencodePersistence({ ...shell, defaultChatPreferences, defaultSettings: defaultConnectionSettings });
  const [presentation] = useState(() => new Map<string, unknown>());
  const [catalogs, setCatalogs] = useState<Record<string, WorkspaceCatalog>>({});
  const publishCatalog = useCallback((connectionId: string, catalog: WorkspaceCatalog) => {
    setCatalogs((current) => current[connectionId] === catalog ? current : { ...current, [connectionId]: catalog });
  }, []);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const onboardingCompleted = isOnboardingComplete(shell.onboardingVersion);
  const manager = useWorkspaceConnections(shell, isHydrated);
  useWorkspaceAutoApprove(manager);
  const { updateSettings: updateWorkspaceSettings, retry, change, removeConnection: removeWorkspaceConnection, connectedWorkspace, isEnabled } = manager;
  const { setFavoriteSessions, setLastSessionByConnection, setProjectPathsByConnection, setSettings, setActiveProjectPath, setChatPreferences } = shell;
  const { connections, focus, retainedFocus, snapshots, ensure, resolveKey, switchConnection, activate, navigate, openExternalSession, disconnect } = manager;
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
    setLastSessionByConnection((value) => ({ ...value, [newScope]: { ...value[oldScope], ...value[newScope] } }));
    setProjectPathsByConnection((value) => ({ ...value, [newScope]: value[newScope] ?? value[oldScope] ?? [] }));
  }, [setFavoriteSessions, setLastSessionByConnection, setProjectPathsByConnection]);
  const beforeProfileRefresh = useCallback(async () => {}, []);
  const connectSetup = useConnectState({ controlPlaneUrl: shell.controlPlaneUrl, setControlPlaneUrl: shell.setControlPlaneUrl,
    switchConnection, disconnect: disconnectProfile, isHydrated, activeMachineId: settings.connect?.machineId,
    beforeProfileRefresh, migrateConnectConnectionScope, profiles, setProfiles, onProfileRefreshed: profileRefreshed, isActiveProfile });
  const profileSaved = useCallback((profile: ConnectionProfile, secrets: { password: string; headers: Record<string, string> }, previous?: ConnectionProfile) => {
    const id = getConnectionUiScope(previous ?? profile);
    change((current) => current.map((entry) => entry.id === id ? { ...entry, name: profile.name } : entry));
    updateWorkspaceSettings(id, { serverUrl: profile.serverUrl, username: profile.username, connect: profile.connect, password: secrets.password, headers: secrets.headers, directory: '' });
  }, [change, updateWorkspaceSettings]);
  const removeConnection = useCallback(async (id: string) => {
    await removeWorkspaceConnection(id);
    clearWorkspacePresentation(presentation, id);
    setCatalogs((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, [removeWorkspaceConnection, presentation]);
  const profileRemoved = useCallback(async (profile: ConnectionProfile) => removeConnection(getConnectionUiScope(profile)), [removeConnection]);
  const connectionProfiles = useConnectionProfiles({ clearCapabilitiesSnapshots, settings, switchConnection, updateSettings, profiles, setProfiles, onSaved: profileSaved, onRemoved: profileRemoved });
  const { servicesValue } = useServicesState({ settings, connectSetup, connections: manager.connections, visible: pathname === '/settings' || pathname === '/service' });
  const [terminalTarget, setTerminalTarget] = useState<WorkspaceTarget>();
  const [inspectionTarget, setInspectionTarget] = useState<WorkspaceTarget>();
  const selectTerminalTarget = useCallback(async (target: WorkspaceTarget) => { await ensure(target); setTerminalTarget(target); }, [ensure]);
  const inspect = useCallback(async (target: WorkspaceTarget) => { await ensure(target); setInspectionTarget(target); }, [ensure]);
  const openSession = useCallback(async (target: SessionDeepLinkTarget, signal?: AbortSignal) => {
    try {
      let entry: Pick<ConnectionRecord, 'id' | 'projects' | 'enabled'> | undefined = target.connectionScope ? connections.find((value) => getConnectionScope(value.settings) === target.connectionScope) : connections.find((value) => value.id === focus?.connectionId);
      if (!entry && target.connectionScope) {
        const profile = findProfileByConnectionScope(await loadConnectionProfiles(), target.connectionScope);
        if (!profile) throw new Error('The saved connection for this session is not available.');
        const [password, headers] = await Promise.all([getProfilePassword(profile.id), getProfileHeaders(profile.id)]);
        if (signal?.aborted) throw new Error('This session link was cancelled.');
        await switchConnection({ serverUrl: profile.serverUrl, username: profile.username, connect: profile.connect, password, headers }, profile.modelPreferences, false);
        entry = { id: getConnectionUiScope(profile), projects: [''], enabled: true };
      }
      if (!entry) throw new Error('The saved connection for this session is not available.');
      if (!entry.enabled) await retry(entry.id);
      await openExternalSession({ connectionId: entry.id, projectPath: target.projectPath ?? entry.projects[0] ?? '', sessionId: target.sessionId }, signal);
      return { ok: true };
    } catch (reason) { return { ok: false, error: reason instanceof Error ? reason.message : 'Could not open this chat.' }; }
  }, [connections, focus?.connectionId, openExternalSession, retry, switchConnection]);
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
  const createChat = useCallback(async (target: WorkspaceTarget) => {
    if (!target.projectPath) throw new Error('Choose a project before creating a chat.');
    const runtime = await connectedWorkspace(target);
    const session = await runtime.values.currentSessionValue.createSession();
    await runtime.values.currentSessionValue.openSession(session.id);
    await activate(target);
    return session;
  }, [activate, connectedWorkspace]);
  const createChatInWorktree = useCallback(async (target: NewWorktreeChatTarget): Promise<NewWorktreeChatResult> => {
    let checkout: import('@/shared/protocol/opencode/project').ProjectWorktree | undefined;
    try {
      const root = await connectedWorkspace({ connectionId: target.connectionId, projectPath: target.projectRoot });
      checkout = await root.values.projectFilesValue.createWorktree(target.name);
      const runtime = await connectedWorkspace({ connectionId: target.connectionId, projectPath: checkout.directory });
      const session = await runtime.values.currentSessionValue.createSession();
      await runtime.values.currentSessionValue.openSession(session.id);
      await activate({ connectionId: target.connectionId, projectPath: checkout.directory });
      return { session, checkout };
    } catch (reason) {
      return { checkout, error: reason instanceof Error ? reason.message : 'Could not create the worktree chat.' };
    }
  }, [activate, connectedWorkspace]);
  const refreshTargets = useCallback(async () => {
    await Promise.all(Object.values(catalogs).map((catalog) => catalog.refresh()));
  }, [catalogs]);
  const shareTargets = useMemo(() => librarySessions(connections, snapshots, focus)
    .filter((row) => row.connected && (!shell.chatPreferences.hideSubagentChats || !row.session.parentID))
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
    lastSessionByConnection: shell.lastSessionByConnection, setLastSessionByConnection: shell.setLastSessionByConnection,
    favoriteSessions: shell.favoriteSessions, setFavoriteSessions: shell.setFavoriteSessions,
    projectPathsByConnectionRef: shell.projectPathsByConnectionRef,
    projectPathsByConnection: shell.projectPathsByConnection, setProjectPathsByConnection: shell.setProjectPathsByConnection,
  }), [fileClipboard, shell.controlPlaneUrl, shell.setControlPlaneUrl, shell.onboardingVersion, shell.setOnboardingVersion,
    shell.onboardingActive, shell.setOnboardingActive, shell.lastSessionByConnection, shell.setLastSessionByConnection,
    shell.favoriteSessions, shell.setFavoriteSessions, shell.projectPathsByConnection, shell.setProjectPathsByConnection, shell.projectPathsByConnectionRef]);
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
    projectPathsByConnection: shell.projectPathsByConnection,
    retry,
    activate,
    switchConnection,
    openSession,
    openSessionInProject,
  }), [voiceSetupTest, activate, connectionProfiles, connectSetup, isHydrated, onboardingCompleted, openSession, openSessionInProject, retry, servicesValue, sharedInput, shell.onboardingActive, shell.projectPathsByConnection, switchConnection]);
  const focusedValues = useWorkspaceValues(current?.values, workspaceOverrides);
  const valuesFor = useCallback((target?: WorkspaceTarget): WorkspaceValues | undefined => {
    const snapshot = target ? snapshots[resolveKey(target)] : current;
    if (!snapshot) return undefined;
    let values = snapshot.values;
    const path = values.projectsValue.activeProjectPath;
    const opened = shell.projectPathsByConnection[getConnectionScope(values.connectionValue.settings)];
    if (opened && path && !opened.includes(path)) values = projectClosedValues(values);
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
  }, [voiceSetupTest, activate, retry, connectionProfiles, connectSetup, current, onboardingCompleted, openSession, openSessionInProject, resolveKey, servicesValue, sharedInput, snapshots, switchConnection, shell.projectPathsByConnection, isHydrated, shell.onboardingActive]);
  const registry = useMemo<WorkspaceRegistry>(() => ({ ...manager, createChat, createChatInWorktree, removeConnection,
    terminalTarget: connections.some((entry) => entry.id === terminalTarget?.connectionId) ? terminalTarget : undefined, selectTerminalTarget,
    inspectionTarget: connections.some((entry) => entry.id === inspectionTarget?.connectionId) ? inspectionTarget : undefined, inspect, valuesFor, catalogs, projectPathsByConnection: shell.projectPathsByConnection }), [manager, createChat, createChatInWorktree, removeConnection, connections, terminalTarget, selectTerminalTarget, inspectionTarget, inspect, valuesFor, catalogs, shell.projectPathsByConnection]);
  const updates = useAppUpdates({ initialized: isHydrated && shell.onboardingVersion >= CURRENT_ONBOARDING_VERSION && !shell.onboardingActive,
    blocked: Object.values(fileClipboard.busy).some(Boolean) || Object.values(snapshots).some((runtime) => runtime.busy) || connectSetup.busy || hasWorkspaceDrafts(presentation) });
  useEffect(() => {
    if (!current) return;
    setSettings(current.values.connectionValue.settings);
    setActiveProjectPath(focus ? current.values.projectsValue.activeProjectPath : undefined);
    const preferences = serverPreferences(current.values.preferencesValue.chatPreferences);
    setChatPreferences((previous) => JSON.stringify(serverPreferences(previous)) === JSON.stringify(preferences) ? previous : { ...previous, ...preferences });
  }, [current, focus, setSettings, setActiveProjectPath, setChatPreferences]);
  const values = focusedValues;
  const readTarget = pathname === '/service' ? undefined : pathname === '/settings' ? inspectionTarget ?? focus
    : pathname === '/terminal' ? terminalTarget ?? focus : focus;
  const workspaceActions = useMemo(() => ({ createChat, createChatInWorktree, focus }), [createChat, createChatInWorktree, focus]);
  return <VoiceSetupTestContext.Provider value={voiceSetupTest}><WorkspacePresentationContext.Provider value={presentation}>
    <WorkspaceActionsContext.Provider value={workspaceActions}>
    <WorkspaceContext.Provider value={registry}>
    {connections.map((entry) => <ServerDataScope key={entry.id} connection={entry} active={readTarget?.connectionId === entry.id}>
      <ConnectionRuntime entry={entry} setup={connectSetup} updateSettings={updateWorkspaceSettings} online={network.online} hydrated={isHydrated} libraryVisible={pathname === '/' && focus?.connectionId === entry.id && Boolean(selectedRuntime?.libraryVisible)} onCatalog={publishCatalog}>
      {entry.projects.map((path, index) => {
        const visible = shell.projectPathsByConnection[getConnectionScope(entry.settings)]?.includes(path || current?.values.projectsValue.activeProjectPath || '') !== false && focus?.connectionId === entry.id && (focus.projectPath === path || current === snapshots[workspaceKey({ connectionId: entry.id, projectPath: path })]);
        const demanded = readTarget?.connectionId === entry.id && (readTarget.projectPath === path || readTarget === focus && visible);
        return <ServerDataActivity key={workspaceKey({ connectionId: entry.id, projectPath: path })} active={demanded}><WorkspaceRuntime
          connection={entry} switchConnection={switchConnection} projectPath={path || undefined} shared={shared} network={network} defaults={shell.chatPreferences} isHydrated={isHydrated}
          visible={visible} isConnectionOwner={index === 0} connectSetup={connectSetup} connectionProfiles={connectionProfiles} servicesValue={servicesValue}
          updateSettings={updateWorkspaceSettings} updatePreferences={manager.updatePreferences} publish={manager.publish} forget={manager.forget} />
        </ServerDataActivity>;
      })}
      </ConnectionRuntime>
    </ServerDataScope>)}
    {values && current ? <OpencodeProviderTree values={values} updates={updates}>
      <WorkspaceNative runtime={current} preferences={shell.chatPreferences} ready={isHydrated} active={Boolean(focus)} busy={Object.values(snapshots).some((runtime) => runtime.busy)} />
      {children}
    </OpencodeProviderTree> : <View style={{ flex: 1, backgroundColor: '#101212', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#C3CECB" /></View>}
    </WorkspaceContext.Provider>
    </WorkspaceActionsContext.Provider>
  </WorkspacePresentationContext.Provider></VoiceSetupTestContext.Provider>;
}
