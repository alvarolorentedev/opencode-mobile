import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getConnectionScope, getConnectionUiScope } from '@/lib/connection-scope';
import { createProfileId, findMatchingProfile, getProfilePassword, loadConnectionProfiles, mutateConnectionProfiles, saveProfilePassword, deleteProfilePassword, pickModelPreferences } from '@/lib/connection-profiles';
import { deleteProfileHeaders, getProfileHeaders, saveProfileHeaders, type ConnectionHeaders } from '@/lib/connection-headers';
import { getServerHostname } from '@/lib/opencode/client/url';
import { defaultConnectionSettings, type OpencodeConnectionSettings } from '@/lib/opencode/client';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { OpencodeProviderState } from '@/providers/use-opencode-provider-state';
import { createPersistenceWriter } from '@/providers/persistence-hydration';
import { createSharedEventStream } from '@/providers/shared-event-stream';
import { connectedWorkspaceTarget } from '@/providers/workspace-focus';
import { parseWorkspaces, serializeWorkspaces, WORKSPACES_STORAGE_KEY } from '@/providers/workspace-storage';
import { workspaceKey, type ConnectionRecord, type SessionTarget, type WorkspaceSnapshot, type WorkspaceTarget } from '@/providers/workspace-types';

export const SERVER_PREFERENCE_KEYS = ['providerId', 'modelId', 'enabledModelIds', 'providerModelSelections', 'modelVariantSelections', 'recentModelIds', 'mode', 'autoApprove', 'autoModel'] as const;
export function serverPreferences(value: Partial<ChatPreferences>) {
  return Object.fromEntries(SERVER_PREFERENCE_KEYS.filter((key) => key in value).map((key) => [key, value[key]])) as Partial<ChatPreferences>;
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

export function useWorkspaceConnections(shell: OpencodeProviderState, hydrated: boolean) {
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [focus, setFocus] = useState<WorkspaceTarget>();
  const [ready, setReady] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<string, WorkspaceSnapshot>>({});
  const records = useRef(connections), selected = useRef(focus), live = useRef(snapshots);
  const lastAvailable = useRef<string | undefined>(undefined);
  const previousAvailable = useRef<string | undefined>(undefined);
  const shellRef = useRef(shell);
  const mounted = useRef(true);
  const canPersist = useRef(true);
  const activation = useRef(0);
  const [write] = useState(createPersistenceWriter);
  useLayoutEffect(() => { shellRef.current = shell; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = useCallback((update: (current: ConnectionRecord[]) => ConnectionRecord[]) => {
    const next = update(records.current);
    if (next.length === records.current.length && next.every((entry, index) => entry === records.current[index])) return;
    records.current = next; setConnections(next);
  }, []);
  const isEnabled = useCallback((id: string) => records.current.some((entry) => entry.id === id && entry.enabled), []);
  const select = useCallback((target: WorkspaceTarget, persist = true) => { if (persist) canPersist.current = true; selected.current = target; setFocus(target); }, []);
  const clearFocus = useCallback((persist = true) => {
    if (persist) canPersist.current = true;
    selected.current = undefined;
    setFocus(undefined);
  }, []);
  const publish = useCallback((key: string, snapshot: WorkspaceSnapshot) => {
    if (live.current[key] === snapshot) return;
    live.current = { ...live.current, [key]: snapshot }; setSnapshots(live.current);
  }, []);
  const forget = useCallback((key: string) => {
    const next = { ...live.current }; delete next[key]; live.current = next; setSnapshots(next);
  }, []);

  const saveProfile = useCallback(async (settings: OpencodeConnectionSettings) => mutateConnectionProfiles(async (profiles, save) => {
    const existing = findMatchingProfile(profiles, settings);
    const profile = existing ?? { id: createProfileId(), name: getServerHostname(settings.serverUrl), serverUrl: settings.serverUrl, username: settings.username, connect: settings.connect };
    const previousPassword = existing ? await getProfilePassword(profile.id) : '';
    const previousHeaders = existing ? await getProfileHeaders(profile.id) : {};
    // Cloud Link credentials are device secrets with no custom headers; a
    // manual connection keeps its gateway headers alongside the password.
    const headers = settings.connect ? {} : settings.headers;
    await saveProfilePassword(profile.id, settings.password, Boolean(settings.connect));
    await saveProfileHeaders(profile.id, headers);
    try { if (!existing) await save([...profiles, profile]); }
    catch (error) {
      if (existing) {
        await saveProfilePassword(profile.id, previousPassword, Boolean(settings.connect)).catch(() => undefined);
        await saveProfileHeaders(profile.id, previousHeaders).catch(() => undefined);
      } else {
        await deleteProfilePassword(profile.id).catch(() => undefined);
        await deleteProfileHeaders(profile.id).catch(() => undefined);
      }
      throw error;
    }
    return profile;
  }), []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      let stored;
      try { const raw = await AsyncStorage.getItem(WORKSPACES_STORAGE_KEY); stored = raw ? parseWorkspaces(raw) : undefined; }
      catch (error) { canPersist.current = false; console.warn('Could not read workspace registry.', error); }
      const initial = shellRef.current;
      const profiles = await loadConnectionProfiles();
      const entries: ConnectionRecord[] = stored ? await Promise.all(stored.connections.map(async (entry) => {
        const profile = findMatchingProfile(profiles, entry.settings);
        let password = '';
        let headers: ConnectionHeaders = {};
        if (profile) {
          password = await getProfilePassword(profile.id);
          headers = await getProfileHeaders(profile.id);
        }
        return { ...entry, settings: { ...entry.settings, password, headers }, events: createSharedEventStream() };
      })) : [];
      if (!entries.length) {
        const placeholder = !initial.onboardingVersion && getConnectionUiScope(initial.settings) === getConnectionUiScope(defaultConnectionSettings);
        const profile = placeholder ? { name: getServerHostname(initial.settings.serverUrl), modelPreferences: undefined } : await saveProfile(initial.settings);
        entries.push({ id: getConnectionUiScope(initial.settings), name: profile.name, settings: initial.settings,
          enabled: initial.onboardingVersion > 0, preferences: { ...profile.modelPreferences, ...serverPreferences(initial.chatPreferences) },
          projects: [initial.activeProjectPath ?? ''], events: createSharedEventStream() });
      }
      if (cancelled) return;
      const target = stored?.focus ?? { connectionId: entries[0].id, projectPath: entries[0].projects[0] ?? '' };
      change(() => entries); select(target, false); setReady(true);
    })().catch((error) => {
      console.error('Could not restore workspaces.', error);
      canPersist.current = false;
      if (cancelled) return;
      const initial = shellRef.current;
      const id = getConnectionUiScope(initial.settings);
      change(() => [{ id, name: getServerHostname(initial.settings.serverUrl), settings: initial.settings, enabled: initial.onboardingVersion > 0,
        preferences: serverPreferences(initial.chatPreferences), projects: [initial.activeProjectPath ?? ''], events: createSharedEventStream() }]);
      select({ connectionId: id, projectPath: initial.activeProjectPath ?? '' }, false); setReady(true);
    });
    return () => { cancelled = true; };
  }, [hydrated, change, select, saveProfile, write]);

  const persisted = useMemo(() => {
    const entries = connections.map((entry) => ({ ...entry, projects: [...new Set(entry.projects.map((projectPath) =>
      snapshots[workspaceKey({ connectionId: entry.id, projectPath })]?.values.projectsValue.activeProjectPath ?? projectPath))].filter((path) => shell.projectPathsByConnection[getConnectionScope(entry.settings)]?.includes(path) !== false) }));
    for (const entry of entries) if (!entry.projects.length) entry.projects = [''];
    const focused = focus ? Object.entries(snapshots).find(([key, snapshot]) => (JSON.parse(key) as string[])[0] === focus.connectionId &&
      ((JSON.parse(key) as string[])[1] === focus.projectPath || snapshot.values.projectsValue.activeProjectPath === focus.projectPath))?.[1] : undefined;
    const path = focus?.projectPath || focused?.values.projectsValue.activeProjectPath || '';
    return serializeWorkspaces(entries, focus ? { ...focus, projectPath: entries.find((entry) => entry.id === focus.connectionId)?.projects.includes(path) ? path : entries.find((entry) => entry.id === focus.connectionId)?.projects[0] ?? '' } : undefined);
  }, [connections, focus, snapshots, shell.projectPathsByConnection]);
  useEffect(() => {
    // Automatic capability refreshes must not overwrite an unread registry.
    if (ready && canPersist.current) void write(WORKSPACES_STORAGE_KEY, persisted, () => AsyncStorage.setItem(WORKSPACES_STORAGE_KEY, persisted))
      .catch((error) => console.warn('Could not save workspaces.', error));
  }, [persisted, ready, write]);

  const resolveKey = useCallback((target: WorkspaceTarget) => {
    const exact = workspaceKey(target);
    if (live.current[exact]) return exact;
    return Object.keys(live.current).find((key) => {
      const [id] = JSON.parse(key) as [string, string];
      return id === target.connectionId && live.current[key].values.projectsValue.activeProjectPath === target.projectPath;
    }) ?? exact;
  }, []);
  // Remember the two most recent healthy chat owners so a failure returns to
  // the server the user was actually using instead of an arbitrary connected one.
  useEffect(() => {
    if (!focus || !records.current.find((entry) => entry.id === focus.connectionId)?.enabled) return;
    if (live.current[resolveKey(focus)]?.values.connectionValue.connection.status !== 'connected') return;
    if (lastAvailable.current === focus.connectionId) return;
    previousAvailable.current = lastAvailable.current;
    lastAvailable.current = focus.connectionId;
  }, [focus, resolveKey, snapshots]);
  // A server that errors or is explicitly disconnected must not leave Chat on
  // its failure screen while another enabled server is still connected.
  useEffect(() => {
    if (!ready || !focus) return;
    const entry = records.current.find((item) => item.id === focus.connectionId);
    const status = live.current[resolveKey(focus)]?.values.connectionValue.connection.status;
    if (entry?.enabled && status !== 'error') return;
    const preferredConnectionId = lastAvailable.current === focus.connectionId ? previousAvailable.current : lastAvailable.current;
    const target = connectedWorkspaceTarget(records.current, live.current, {
      excludedConnectionId: focus.connectionId,
      preferredConnectionId,
    });
    // Never turn an unread registry into a writable one just because a server
    // failed during startup; focus locally and let the next user action persist.
    if (target) select(target, canPersist.current);
  }, [connections, focus, ready, resolveKey, select, snapshots]);
  const ensure = useCallback(async (target: WorkspaceTarget) => {
    let key = resolveKey(target);
    if (!live.current[key]) change((current) => current.map((entry) => entry.id === target.connectionId && !entry.projects.includes(target.projectPath)
      ? { ...entry, projects: [...entry.projects, target.projectPath] } : entry));
    const deadline = Date.now() + 20000;
    while (mounted.current && Date.now() < deadline) {
      key = resolveKey(target);
      const snapshot = live.current[key];
      const entry = records.current.find((item) => item.id === target.connectionId);
      if (snapshot && snapshot.enabled === entry?.enabled && snapshot.native.settings === entry.settings) return snapshot;
      if (!records.current.some((entry) => entry.id === target.connectionId)) throw new Error('This server is no longer available.');
      await tick();
    }
    throw new Error('Could not open this workspace.');
  }, [change, resolveKey]);
  const retry = useCallback(async (id: string) => {
    canPersist.current = true;
    const entry = records.current.find((item) => item.id === id);
    if (!entry) throw new Error('Server not found.');
    for (const [key, runtime] of Object.entries(live.current)) if ((JSON.parse(key) as string[])[0] === id) runtime.suspend();
    change((current) => current.map((item) => item.id === id ? { ...item, enabled: true, settings: { ...item.settings }, events: createSharedEventStream() } : item));
    // entry.projects also contains retained runtimes whose projects the user
    // closed. Reconnect must follow the opened-project list instead.
    const projectPath = shellRef.current.projectPathsByConnection[getConnectionScope(entry.settings)]?.[0] ?? '';
    const runtime = await ensure({ connectionId: id, projectPath });
    return runtime.values.connectionValue.connect();
  }, [change, ensure]);
  const connectedWorkspace = useCallback(async (target: WorkspaceTarget) => {
    const entry = records.current.find((item) => item.id === target.connectionId);
    if (!entry?.enabled) throw new Error('Connect this server before opening its workspace.');
    let snapshot = await ensure(target);
    if (snapshot.values.connectionValue.connection.status !== 'connected') {
      const status = snapshot.values.connectionValue.connection.status === 'error' ? await retry(target.connectionId) : await snapshot.values.connectionValue.connect();
      if (status.status !== 'connected') throw new Error(status.message);
    }
    const deadline = Date.now() + 20000;
    while (mounted.current && Date.now() < deadline) {
      snapshot = await ensure(target);
      if (snapshot.values.connectionValue.connection.status === 'connected') return snapshot;
      if (!records.current.find((item) => item.id === target.connectionId)?.enabled) throw new Error('Server disconnected.');
      await tick();
    }
    throw new Error('Could not connect to this workspace.');
  }, [ensure, retry]);
  const pauseConversation = useCallback(async () => {
    const previous = selected.current && live.current[resolveKey(selected.current)];
    if (previous?.values.conversationValue.conversation.active) await previous.values.conversationValue.toggleConversationMode();
  }, [resolveKey]);
  // Commits the workspace selection once the runtime is ready. App navigation
  // and external links share this step; it never reads the session list.
  const selectWorkspace = useCallback((target: WorkspaceTarget, next: WorkspaceSnapshot) => {
    const projectPath = target.projectPath || next.values.projectsValue.activeProjectPath || '';
    const scope = getConnectionScope(next.native.settings);
    const paths = shellRef.current.projectPathsByConnectionRef.current[scope] ?? [];
    if (projectPath && !paths.includes(projectPath)) {
      const opened = { ...shellRef.current.projectPathsByConnectionRef.current, [scope]: [projectPath, ...paths] };
      shellRef.current.projectPathsByConnectionRef.current = opened; shellRef.current.setProjectPathsByConnection(opened);
    }
    select({ connectionId: target.connectionId, projectPath });
  }, [select]);
  // In-app navigation. The caller already knows the workspace and session from
  // rendered data, so this only prepares the runtime and selects the session
  // locally. It must not validate against a server session list: that read is
  // slow on remote links and is unnecessary for a chat the app is showing.
  const navigate = useCallback(async (target: SessionTarget) => {
    const operation = ++activation.current;
    const check = () => { if (operation !== activation.current) throw new Error('This navigation was cancelled.'); };
    check();
    await pauseConversation();
    const next = await connectedWorkspace(target);
    check();
    // Rows are rendered from a runtime catalog or project list, so a normal tap
    // is known locally. Only stale references (for example an old favorite)
    // need one catalog read to report that the chat no longer exists.
    const known = () => Object.values(live.current).some((snapshot) => (
      snapshot.catalogSessions.some((session) => session.id === target.sessionId && (!session.directory || session.directory === target.projectPath))
      || snapshot.values.sessionLibraryValue.sessions.some((session) => session.id === target.sessionId && (!session.directory || session.directory === target.projectPath))
    ));
    if (!known()) {
      await next.values.currentSessionValue.activeSessions.refresh().catch(() => undefined);
      const deadline = Date.now() + 2000;
      while (!known() && Date.now() < deadline) await tick();
      if (!known()) throw new Error(`Session ${target.sessionId} was not found in the ${target.projectPath} project.`);
    }
    check();
    await next.values.currentSessionValue.openSession(target.sessionId);
    check();
    selectWorkspace(target, next);
  }, [connectedWorkspace, pauseConversation, selectWorkspace]);
  // Workspace focus without a session. Project switching and "new chat" use
  // this; session selection happens separately through navigate/openSession.
  const activate = useCallback(async (target: WorkspaceTarget) => {
    const operation = ++activation.current;
    const check = () => { if (operation !== activation.current) throw new Error('This navigation was cancelled.'); };
    check();
    await pauseConversation();
    const next = await connectedWorkspace(target);
    check();
    selectWorkspace(target, next);
  }, [connectedWorkspace, pauseConversation, selectWorkspace]);
  // External link resolution (notifications, widgets, quick actions, OS links)
  // confirms the target against the owning server before switching. In-app
  // navigation must not use this path.
  const openExternalSession = useCallback(async (target: SessionTarget, signal?: AbortSignal) => {
    const operation = ++activation.current;
    const check = () => { if (signal?.aborted || operation !== activation.current) throw new Error('This session link was cancelled.'); };
    check();
    await pauseConversation();
    const next = await connectedWorkspace(target);
    check();
    if (target.connectionId !== selected.current?.connectionId) {
      await next.values.sessionLibraryValue.refreshSessions();
      check();
    }
    const opened = await next.values.currentSessionValue.openDeepLinkSession({ sessionId: target.sessionId, projectPath: target.projectPath || undefined }, signal);
    if (!opened.ok) throw new Error(opened.error);
    check();
    selectWorkspace(target, next);
  }, [connectedWorkspace, pauseConversation, selectWorkspace]);
  const switchConnection = useCallback(async (settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username' | 'password' | 'headers' | 'connect'>, preferences?: Partial<ChatPreferences>, selectWorkspace = true) => {
    const full = { ...settings, directory: '' };
    const profile = await saveProfile(full);
    const id = getConnectionUiScope(full);
    const found = records.current.find((entry) => entry.id === id);
    if (found) for (const [key, runtime] of Object.entries(live.current)) if ((JSON.parse(key) as string[])[0] === id) runtime.suspend();
    // A retained runtime can outlive its opened project; reconnect to the
    // opened list, never to the first stale entry.
    const projectPath = shellRef.current.projectPathsByConnection[getConnectionScope(full)]?.[0] ?? '';
    change((current) => found ? current.map((entry) => entry.id === id ? { ...entry, settings: full, enabled: true,
      // A retained workspace already holds the live server choices. A profile
      // write can lag behind it, so only fill fields the entry is missing.
      preferences: { ...serverPreferences(preferences ?? {}), ...entry.preferences }, events: createSharedEventStream() } : entry)
      : [...current.filter((entry) => shellRef.current.onboardingVersion > 0 || entry.enabled || entry.id !== getConnectionUiScope(defaultConnectionSettings)), { id, name: profile.name, settings: full, enabled: true, preferences: { autoApprove: false, ...serverPreferences(preferences ?? profile.modelPreferences ?? {}) }, projects: [projectPath], events: createSharedEventStream() }]);
    const target = { connectionId: id, projectPath };
    const runtime = await ensure(target);
    if (selectWorkspace) { await pauseConversation(); select(target); }
    return runtime.values.connectionValue.connect();
  }, [change, ensure, pauseConversation, saveProfile, select]);
  const disconnect = useCallback(async (id: string) => {
    canPersist.current = true;
    for (const [key, runtime] of Object.entries(live.current)) if ((JSON.parse(key) as string[])[0] === id) {
      if (runtime.values.conversationValue.conversation.active) await runtime.values.conversationValue.toggleConversationMode();
      runtime.suspend();
    }
    change((current) => current.map((entry) => entry.id === id ? { ...entry, enabled: false } : entry));
  }, [change]);
  const updateSettings = useCallback((id: string, value: OpencodeConnectionSettings, origin?: string) => {
    const previous = records.current.find((entry) => entry.id === id);
    if (!previous || JSON.stringify(previous.settings) === JSON.stringify(value)) return;
    const manualChange = !value.connect;
    if (manualChange) canPersist.current = true;
    for (const [key, runtime] of Object.entries(live.current)) if ((JSON.parse(key) as string[])[0] === id && key !== origin) runtime.suspend();
    const nextId = getConnectionUiScope(value);
    change((current) => current.map((entry) => entry.id === id ? { ...entry, id: nextId, settings: value, events: createSharedEventStream(), ...(manualChange ? { enabled: false } : {}),
      ...(nextId === id ? {} : { enabled: false, projects: [''], preferences: { autoApprove: false }, events: createSharedEventStream() }) } : entry));
    if (selected.current?.connectionId === id) { if (nextId !== id) select({ connectionId: nextId, projectPath: '' }); shellRef.current.setSettings(value); }
  }, [change, select]);
  const updatePreferences = useCallback((id: string, value: ChatPreferences) => {
    if (!records.current.some((entry) => entry.id === id)) return;
    const preferences = serverPreferences(value);
    const previous = records.current.find((entry) => entry.id === id);
    const serverChanged = !previous || JSON.stringify(previous.preferences) !== JSON.stringify(preferences);
    change((current) => current.map((entry) => entry.id === id && JSON.stringify(entry.preferences) !== JSON.stringify(preferences) ? { ...entry, preferences } : entry));
    shellRef.current.setChatPreferences((current) => {
      const next = { ...value, ...serverPreferences(current) };
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
    // UI-only preference changes (text size, language, delivery, ...) must not
    // rewrite profile metadata; only server-relevant selections do.
    const entry = records.current.find((item) => item.id === id);
    if (serverChanged && entry) void mutateConnectionProfiles(async (profiles, save) => {
      const profile = findMatchingProfile(profiles, entry.settings);
      if (profile) await save(profiles.map((item) => item.id === profile.id ? { ...item, modelPreferences: pickModelPreferences(value) } : item));
    }).catch((error) => console.warn('Could not save model preferences.', error));
  }, [change]);
  const closeProjects = useCallback(async (targets: WorkspaceTarget[]) => {
    const byConnection = new Map<string, Set<string>>();
    for (const target of targets) {
      const paths = byConnection.get(target.connectionId);
      if (paths) paths.add(target.projectPath);
      else byConnection.set(target.connectionId, new Set([target.projectPath]));
    }
    for (const [connectionId, paths] of byConnection) {
      const entry = records.current.find((item) => item.id === connectionId);
      if (!entry) continue;
      const scope = getConnectionScope(entry.settings);
      const remaining = (shellRef.current.projectPathsByConnectionRef.current[scope] ?? []).filter((path) => !paths.has(path));
      const opened = { ...shellRef.current.projectPathsByConnectionRef.current, [scope]: remaining };
      shellRef.current.projectPathsByConnectionRef.current = opened;
      shellRef.current.setProjectPathsByConnection(opened);
      if (selected.current?.connectionId === connectionId && paths.has(selected.current.projectPath)) {
        if (remaining.length) await activate({ connectionId, projectPath: remaining[0] });
        else {
          await pauseConversation();
          clearFocus();
        }
      }
    }
  }, [activate, clearFocus, pauseConversation]);
  const closeProject = useCallback(async (target: WorkspaceTarget) => {
    await closeProjects([target]);
  }, [closeProjects]);
  const removeConnection = useCallback(async (id: string) => {
    await disconnect(id);
    change((current) => current.filter((entry) => entry.id !== id));
    for (const key of Object.keys(live.current)) if ((JSON.parse(key) as string[])[0] === id) forget(key);
  }, [change, disconnect, forget]);
  return { isEnabled, closeProject, closeProjects, connectedWorkspace, removeConnection, connections, focus, snapshots, ready, change, select, publish, forget, ensure, resolveKey, activate, navigate, openExternalSession, switchConnection, disconnect, retry, updateSettings, updatePreferences };
}
