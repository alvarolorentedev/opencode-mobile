// App-wide workspace registry, connection focus, and persistence.
// See docs/architecture/state-and-data.md#state-ownership-overview.
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { defaultConnectionSettings } from '@/shared/protocol/opencode/client';
import { ConnectionCatalog, useConnectionDemand, useConnectionRegistryBinding } from '@/runtime/connections/connection-runtime';
import { CURRENT_ONBOARDING_VERSION } from '@/features/onboarding/runtime';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ConnectionContextValue } from '@/features/connections/index';
import { useAppUpdates } from '@/features/updates/runtime';
import { UpdatesContext } from '@/features/updates/context';
import { useConnectState , useServicesState } from '@/features/cloud-link/runtime';
import { useConnectionProfiles } from '@/features/connections/runtime';
import { HIDDEN_PROJECTS_MAX, useFileClipboard } from '@/features/projects/runtime';
import { useNetworkStatus } from '@/shared/network/use-network-status';
import { useOpencodePersistence } from '@/runtime/persistence/use-opencode-persistence';
import { useAppCore, useAppStore } from '@/runtime/core/context';
import { workspaceReadTarget } from '@/runtime/core/project-scope';
import { useShareState } from '@/features/sharing/runtime';
import { useVoiceSetupTest, VoiceSetupTestContext } from '@/features/voice/runtime';
import { useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import { serverPreferences, workspaceChatPreferences } from '@/runtime/core/commands/connection';
import { useWorkspaceShellState } from '@/runtime/workspace/use-workspace-shell-state';
import { WorkspaceContext, type WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import { useLibrarySessions, useMissionOverview } from '@/features/sessions/runtime';
import { MISSION_PATH } from '@/shared/contracts/mission-control';
import { WorkspaceNative } from '@/runtime/composition/workspace-native';
import { useMissionWidget } from '@/features/widgets/runtime';
import { clearWorkspacePresentation, hasWorkspaceDrafts } from '@/runtime/presentation/workspace-presentation';
import { RetainedProject } from '@/runtime/workspace/retained-project';
import { workspaceKey, type ConnectionRecord, type WorkspaceCatalog } from '@/shared/contracts/workspace';
import type { SharedWorkspaceState } from '@/runtime/workspace/workspace-types';
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
  useNetworkStatus(core.connections.setNetwork);
  const network = useAppStore((state) => state.network);
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
  const registryState = useAppStore((state) => state.registry);
  const manager = useWorkspaceConnections(isHydrated, {
    registry: registryState,
    commands: core.commands,
    hiddenProjects: shell.hiddenProjects,
  });
  useEffect(() => core.autoApproval.start(), [core]);
  useEffect(() => core.terminal.start(), [core]);
  useEffect(() => core.events.observeMcpStatus(), [core]);
  const { updateSettings: updateWorkspaceSettings, change, removeConnection: removeWorkspaceConnection, connectedWorkspace, isEnabled } = manager;
  const { setFavoriteSessions, setSettings, setChatPreferences, setHiddenProjects } = shell;
  const { connections, focus, snapshots, resolveKey, switchConnection, disconnect } = manager;
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
  const focusedKey = focus && resolveKey(focus);
  const current = focusedKey ? snapshots[focusedKey] : undefined;
  const selection = useAppStore((state) => focusedKey ? state.selection[focusedKey] : undefined);
  const focusedSettings = current?.native.settings;
  const settings = focusedSettings ?? shell.settings;
  const focusedPreferences = connections.find(({ id }) => id === focus?.connectionId)?.preferences;
  const settingsConnectionId = focus?.connectionId;
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
  const connectionControls = useMemo(() => ({ connectionProfiles, connectSetup, services: servicesValue }), [connectionProfiles, connectSetup, servicesValue]);
  const { terminalTarget, inspectionTarget } = registryState;
  const { createSession, selectTerminalTarget, inspect } = core.commands.workspace;
  const { openSession } = core.commands.connection;
  const refreshTargets = useCallback(async () => {
    await Promise.all(Object.values(catalogs).map((catalog) => catalog.refresh()));
  }, [catalogs]);
  const shareSessions = useLibrarySessions(catalogs, { includePreviews: false });
  const shareTargets = useMemo(() => shareSessions
    .filter((row) => !shell.chatPreferences.hideSubagentChats || !row.session.parentID)
    .map((row) => ({ connectionScope: getConnectionScope(connections.find((entry) => entry.id === row.connectionId)!.settings),
      projectPath: row.projectPath, sessionId: row.sessionId, title: `${row.serverName} · ${row.session.title}` })), [connections, shareSessions, shell.chatPreferences.hideSubagentChats]);
  const sharedInput = useShareState({ hydrated: isHydrated, connectionScope: getConnectionScope(settings),
    projectPath: selection?.activeProjectPath ?? (focus?.projectPath || undefined),
    currentSessionId: selection?.currentSessionId,
    availableTargets: shareTargets,
    createAt: async (target) => {
      const entry = connections.find((item) => getConnectionScope(item.settings) === target.connectionScope);
      if (!entry) throw new Error('This server is no longer available.');
      const workspace = { connectionId: entry.id, projectPath: target.projectPath };
      await connectedWorkspace(workspace);
      return createSession(workspace);
    },
    sessions: (focus && catalogs[focus.connectionId]?.sessions) || [], hideSubagentChats: shell.chatPreferences.hideSubagentChats, refreshTargets,
    createSession: async () => { if (!focus) throw new Error('Choose a workspace.'); return createSession(focus); }, openSession });
  const shared = useMemo<SharedWorkspaceState>(() => ({
    fileClipboard,
    controlPlaneUrl: shell.controlPlaneUrl, setControlPlaneUrl: shell.setControlPlaneUrl,
    hiddenProjects: shell.hiddenProjects, setHiddenProjects: shell.setHiddenProjects,
  }), [fileClipboard, shell.controlPlaneUrl, shell.setControlPlaneUrl, shell.hiddenProjects, shell.setHiddenProjects]);
  const voiceSetupTest = useVoiceSetupTest(shell.chatPreferences, Object.values(snapshots).some((snapshot) => snapshot.values.conversationValue.conversation.phase !== 'off'));
  const registry = useMemo<WorkspaceRegistry>(() => ({ ...manager, removeConnection,
    terminalTarget: connections.some((entry) => entry.id === terminalTarget?.connectionId) ? terminalTarget : undefined, selectTerminalTarget,
    inspectionTarget: connections.some((entry) => entry.id === inspectionTarget?.connectionId) ? inspectionTarget : undefined, inspect, sharedInput, connectionControls, catalogs, mission }), [manager, removeConnection, connections, terminalTarget, selectTerminalTarget, inspectionTarget, inspect, sharedInput, connectionControls, catalogs, mission]);
  const updates = useAppUpdates({ initialized: isHydrated && shell.onboardingVersion >= CURRENT_ONBOARDING_VERSION && !shell.onboardingActive,
    blocked: Object.values(fileClipboard.busy).some(Boolean) || Object.values(snapshots).some((runtime) => runtime.busy) || connectSetup.busy || hasWorkspaceDrafts(presentation) });
  useEffect(() => {
    if (!focusedSettings) return;
    setSettings(focusedSettings);
    if (!focusedPreferences) return;
    setChatPreferences((previous) => {
      const next = workspaceChatPreferences(previous, focusedPreferences);
      return JSON.stringify(serverPreferences(previous)) === JSON.stringify(serverPreferences(next)) ? previous : next;
    });
  }, [focusedSettings, focusedPreferences, setSettings, setChatPreferences]);
  const readTarget = workspaceReadTarget(pathname, registryState);
  useConnectionDemand(readTarget?.connectionId);
  return <VoiceSetupTestContext.Provider value={voiceSetupTest}>
    <WorkspaceContext.Provider value={registry}>
    {connections.map((entry) => <ConnectionCatalog key={entry.id} entry={entry} demanded={readTarget?.connectionId === entry.id} online={network.online} libraryVisible={pathname === '/' && focus?.connectionId === entry.id && Boolean(selection?.activeSessionsVisible)} missionVisible={pathname === MISSION_PATH} onCatalog={publishCatalog} />)}
    {connections.flatMap((entry) => entry.projects.map((path, index) => {
        const key = workspaceKey({ connectionId: entry.id, projectPath: path });
        const visible = focus?.connectionId === entry.id && (focus.projectPath === path || current === snapshots[key]);
        const demanded = readTarget?.connectionId === entry.id && (readTarget.projectPath === path || readTarget === focus && visible);
        return <RetainedProject key={key} demanded={demanded}
          connection={entry} catalog={catalogs[entry.id]} projectPath={path || undefined} shared={shared} network={network} defaults={shell.chatPreferences} isHydrated={isHydrated}
          visible={visible} isConnectionOwner={index === 0}
          updateSettings={updateWorkspaceSettings} updatePreferences={manager.updatePreferences} publish={manager.publish} forget={manager.forget} />;
    }))}
    {current ? <UpdatesContext.Provider value={updates}>
      <WorkspaceNative runtime={current} currentSessionId={selection?.currentSessionId} preferences={shell.chatPreferences} ready={isHydrated} active={Boolean(focus)} busy={Object.values(snapshots).some((runtime) => runtime.busy)} />
      {children}
    </UpdatesContext.Provider> : <View style={{ flex: 1, backgroundColor: '#101212', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#C3CECB" /></View>}
    </WorkspaceContext.Provider>
  </VoiceSetupTestContext.Provider>;
}
