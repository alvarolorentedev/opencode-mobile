import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { getProfilePassword, loadConnectionProfiles, findProfileByConnectionScope, type ConnectionProfile } from '@/lib/connection-profiles';
import { getConnectionScope, getConnectionUiScope } from '@/lib/connection-scope';
import { defaultConnectionSettings } from '@/lib/opencode/client';
import type { ConnectionContextValue, SessionDeepLinkTarget } from '@/providers/opencode-provider-types';
import { defaultChatPreferences } from '@/providers/opencode-preferences';
import { CURRENT_ONBOARDING_VERSION, isOnboardingComplete } from '@/providers/onboarding-state';
import { useOpencodeProviderState } from '@/providers/use-opencode-provider-state';
import { useOpencodePersistence } from '@/providers/use-opencode-persistence';
import { useWorkspaceConnections, serverPreferences } from '@/providers/use-workspace-connections';
import { WorkspaceContext, type WorkspaceRegistry } from '@/providers/workspace-context';
import { WorkspaceRuntime } from '@/providers/workspace-runtime';
import { workspaceKey, type SharedWorkspaceState, type WorkspaceTarget, type WorkspaceValues, type ConnectionRecord } from '@/providers/workspace-types';
import { useConnectState } from '@/providers/use-connect-state';
import { useConnectionProfiles } from '@/providers/use-connection-profiles';
import { useServicesState } from '@/providers/use-services-state';
import { useShareState } from '@/providers/use-share-state';
import { useAppUpdates } from '@/providers/use-app-updates';
import { OpencodeProviderTree } from '@/providers/opencode-provider-tree';
import { useWorkspaceAutoApprove } from '@/providers/use-workspace-auto-approve';
import { aggregateSessionUsage } from '@/lib/opencode/usage';
import { clearWorkspacePresentation, hasWorkspaceDrafts } from '@/providers/workspace-presentation';
import { librarySessions } from '@/providers/workspace-library';
import { WorkspaceNative } from '@/providers/workspace-native';

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const shell = useOpencodeProviderState();
  const { isHydrated } = useOpencodePersistence({ ...shell, defaultChatPreferences, defaultSettings: defaultConnectionSettings });
  const [presentation] = useState(() => new Map<string, unknown>());
  const manager = useWorkspaceConnections(shell, isHydrated);
  useWorkspaceAutoApprove(manager);
  const { updateSettings: updateWorkspaceSettings, retry, change, removeConnection: removeWorkspaceConnection, connectedWorkspace, isEnabled } = manager;
  const { setFavoriteSessions, setLastSessionByConnection, setProjectPathsByConnection, setSettings, setActiveProjectPath, setChatPreferences } = shell;
  const { connections, focus, snapshots, ensure, resolveKey, switchConnection, activate, disconnect } = manager;
  const selectedRuntime = focus ? snapshots[resolveKey(focus)] : undefined;
  const [retainedRuntime, setRetainedRuntime] = useState(selectedRuntime);
  if (selectedRuntime && retainedRuntime !== selectedRuntime) setRetainedRuntime(selectedRuntime);
  const current = selectedRuntime ?? retainedRuntime;
  const settings = current?.values.connectionValue.settings ?? shell.settings;
  const updateSettings = useCallback<ConnectionContextValue['updateSettings']>((patch) => {
    if (focus) updateWorkspaceSettings(focus.connectionId, { ...settings, ...patch });
  }, [focus, updateWorkspaceSettings, settings]);
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
    beforeProfileRefresh, onProfileRefreshed: profileRefreshed, isActiveProfile });
  const profileSaved = useCallback((profile: ConnectionProfile, password: string, previous?: ConnectionProfile) => {
    const id = getConnectionUiScope(previous ?? profile);
    change((current) => current.map((entry) => entry.id === id ? { ...entry, name: profile.name } : entry));
    updateWorkspaceSettings(id, { serverUrl: profile.serverUrl, username: profile.username, connect: profile.connect, password, directory: '' });
  }, [change, updateWorkspaceSettings]);
  const removeConnection = useCallback(async (id: string) => {
    await removeWorkspaceConnection(id);
    clearWorkspacePresentation(presentation, id);
  }, [removeWorkspaceConnection, presentation]);
  const profileRemoved = useCallback(async (profile: ConnectionProfile) => removeConnection(getConnectionUiScope(profile)), [removeConnection]);
  const connectionProfiles = useConnectionProfiles({ settings, switchConnection, updateSettings, profileSnapshot: connectSetup.profiles, onSaved: profileSaved, onRemoved: profileRemoved });
  const { servicesValue } = useServicesState({ settings, connectSetup, scopeGenerationRef: shell.scopeGenerationRef });
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
        const password = await getProfilePassword(profile.id);
        if (signal?.aborted) throw new Error('This session link was cancelled.');
        await switchConnection({ serverUrl: profile.serverUrl, username: profile.username, connect: profile.connect, password }, profile.modelPreferences, false);
        entry = { id: getConnectionUiScope(profile), projects: [''], enabled: true };
      }
      if (!entry) throw new Error('The saved connection for this session is not available.');
      if (!entry.enabled) await retry(entry.id);
      await activate({ connectionId: entry.id, projectPath: target.projectPath ?? entry.projects[0] ?? '' }, target.sessionId, signal);
      return { ok: true };
    } catch (reason) { return { ok: false, error: reason instanceof Error ? reason.message : 'Could not open this chat.' }; }
  }, [activate, connections, focus?.connectionId, retry, switchConnection]);
  const createChat = useCallback(async (target: WorkspaceTarget) => {
    if (!target.projectPath) throw new Error('Choose a project before creating a chat.');
    const runtime = await connectedWorkspace(target);
    const session = await runtime.values.currentSessionValue.createSession();
    await runtime.values.currentSessionValue.openSession(session.id);
    await activate(target);
    return session;
  }, [activate, connectedWorkspace]);
  const refreshTargets = useCallback(async () => {
    await Promise.all(Object.values(snapshots).map((runtime) => runtime.values.currentSessionValue.activeSessions.refresh()));
  }, [snapshots]);
  const shareTargets = useMemo(() => librarySessions(connections, snapshots, focus)
    .filter((row) => row.connected && (!shell.chatPreferences.hideSubagentChats || !row.session.parentID))
    .map((row) => ({ connectionScope: getConnectionScope(connections.find((entry) => entry.id === row.connectionId)!.settings),
      projectPath: row.projectPath, sessionId: row.sessionId, title: `${row.serverName} · ${row.session.title}` })), [connections, snapshots, focus, shell.chatPreferences.hideSubagentChats]);
  const sharedInput = useShareState({ hydrated: isHydrated, connectionScope: getConnectionScope(settings),
    projectPath: current?.values.projectsValue.activeProjectPath, currentSessionId: current?.values.currentSessionValue.currentSessionId,
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
    controlPlaneUrl: shell.controlPlaneUrl, setControlPlaneUrl: shell.setControlPlaneUrl,
    onboardingVersion: shell.onboardingVersion, setOnboardingVersion: shell.setOnboardingVersion,
    onboardingActive: shell.onboardingActive, setOnboardingActive: shell.setOnboardingActive,
    lastSessionByConnection: shell.lastSessionByConnection, setLastSessionByConnection: shell.setLastSessionByConnection,
    favoriteSessions: shell.favoriteSessions, setFavoriteSessions: shell.setFavoriteSessions,
    projectPathsByConnectionRef: shell.projectPathsByConnectionRef,
    projectPathsByConnection: shell.projectPathsByConnection, setProjectPathsByConnection: shell.setProjectPathsByConnection,
  }), [shell.controlPlaneUrl, shell.setControlPlaneUrl, shell.onboardingVersion, shell.setOnboardingVersion,
    shell.onboardingActive, shell.setOnboardingActive, shell.lastSessionByConnection, shell.setLastSessionByConnection,
    shell.favoriteSessions, shell.setFavoriteSessions, shell.projectPathsByConnection, shell.setProjectPathsByConnection, shell.projectPathsByConnectionRef]);
  const valuesFor = useCallback((target?: WorkspaceTarget): WorkspaceValues | undefined => {
    const snapshot = target ? snapshots[resolveKey(target)] : current;
    if (!snapshot) return undefined;
    let values = snapshot.values;
    const path = values.projectsValue.activeProjectPath;
    const opened = shell.projectPathsByConnection[getConnectionScope(values.connectionValue.settings)];
    if (!target && path && opened && !opened.includes(path)) {
      values = { ...values,
        projectsValue: { ...values.projectsValue, activeProject: undefined, activeProjectPath: undefined },
        currentSessionValue: { ...values.currentSessionValue, currentSessionId: undefined, activeSession: undefined,
          createSession: async () => { throw new Error('Choose a project before creating a chat.'); }, ensureActiveSession: async () => undefined },
        chatValue: { ...values.chatValue, currentMessages: [], currentTranscript: [], currentTodos: [], currentDiffs: [],
          currentPendingPermissions: [], currentPendingQuestions: [], pendingPrompts: [], currentUsage: aggregateSessionUsage([]),
          latestAssistantTurnUsage: undefined, sendingState: { active: false }, transcriptPaging: { ...values.chatValue.transcriptPaging, hasOlder: false } },
      };
    }
    const id = getConnectionUiScope(values.connectionValue.settings);
    return { ...values,
      onboardingValue: { ...values.onboardingValue, isHydrated, onboardingCompleted: isOnboardingComplete(shell.onboardingVersion), onboardingActive: shell.onboardingActive },
      connectionValue: { ...values.connectionValue, connect: () => retry(id), switchConnection, connectionProfiles, connectSetup, services: servicesValue },
      projectsValue: { ...values.projectsValue, selectProject: (projectPath) => { void activate({ connectionId: id, projectPath }); } },
      currentSessionValue: { ...values.currentSessionValue, openDeepLinkSession: openSession },
      sessionLibraryValue: { ...values.sessionLibraryValue, openSessionInProject: async (projectPath, sessionId, connectionScope) => {
        const opened = await openSession({ projectPath, sessionId, connectionScope: connectionScope ?? getConnectionScope(values.connectionValue.settings) });
        if (!opened.ok) throw new Error(opened.error);
      } },
      chatValue: { ...values.chatValue, sharedInput },
    };
  }, [activate, retry, connectionProfiles, connectSetup, current, openSession, resolveKey, servicesValue, sharedInput, snapshots, switchConnection, shell.projectPathsByConnection, isHydrated, shell.onboardingVersion, shell.onboardingActive]);
  const registry = useMemo<WorkspaceRegistry>(() => ({ ...manager, createChat, removeConnection,
    terminalTarget: connections.some((entry) => entry.id === terminalTarget?.connectionId) ? terminalTarget : undefined, selectTerminalTarget,
    inspectionTarget: connections.some((entry) => entry.id === inspectionTarget?.connectionId) ? inspectionTarget : undefined, inspect, valuesFor, presentation }), [manager, createChat, removeConnection, connections, terminalTarget, selectTerminalTarget, inspectionTarget, inspect, valuesFor, presentation]);
  const updates = useAppUpdates({ initialized: isHydrated && shell.onboardingVersion >= CURRENT_ONBOARDING_VERSION && !shell.onboardingActive,
    blocked: Object.values(snapshots).some((runtime) => runtime.busy) || connectSetup.busy || hasWorkspaceDrafts(presentation) });
  useEffect(() => {
    if (!current) return;
    setSettings(current.values.connectionValue.settings);
    setActiveProjectPath(current.values.projectsValue.activeProjectPath);
    const preferences = serverPreferences(current.values.preferencesValue.chatPreferences);
    setChatPreferences((previous) => JSON.stringify(serverPreferences(previous)) === JSON.stringify(preferences) ? previous : { ...previous, ...preferences });
  }, [current, setSettings, setActiveProjectPath, setChatPreferences]);
  const values = valuesFor();
  return <WorkspaceContext.Provider value={registry}>
    {connections.flatMap((entry) => entry.projects.map((path, index) => <WorkspaceRuntime key={workspaceKey({ connectionId: entry.id, projectPath: path })}
      connection={entry} projectPath={path || undefined} shared={shared} defaults={shell.chatPreferences} isHydrated={isHydrated}
      visible={shell.projectPathsByConnection[getConnectionScope(entry.settings)]?.includes(path || current?.values.projectsValue.activeProjectPath || '') !== false && focus?.connectionId === entry.id && (focus.projectPath === path || current === snapshots[workspaceKey({ connectionId: entry.id, projectPath: path })])}
      isConnectionOwner={index === 0} connectSetup={connectSetup} connectionProfiles={connectionProfiles} servicesValue={servicesValue}
      updateSettings={updateWorkspaceSettings} updatePreferences={manager.updatePreferences}
      publish={manager.publish} forget={manager.forget} />))}
    {values && current ? <OpencodeProviderTree values={values} updates={updates}>
      <WorkspaceNative runtime={current} preferences={shell.chatPreferences} ready={isHydrated} busy={Object.values(snapshots).some((runtime) => runtime.busy)} />
      {children}
    </OpencodeProviderTree> : <View style={{ flex: 1, backgroundColor: '#0F1614', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#7AE7C0" /></View>}
  </WorkspaceContext.Provider>;
}
