import { deleteProfileHeaders, getProfileHeaders, saveProfileHeaders, type ConnectionHeaders } from '@/lib/connection-headers';
import { createProfileId, deleteProfilePassword, findMatchingProfile, getProfilePassword, loadConnectionProfiles, mutateConnectionProfiles, pickModelPreferences, saveProfilePassword } from '@/lib/connection-profiles';
import { getConnectionScope, getConnectionUiScope } from '@/lib/connection-scope';
import { defaultConnectionSettings, type OpencodeConnectionSettings } from '@/lib/opencode/client';
import { getServerHostname } from '@/lib/opencode/client/url';
import { clearCapabilitiesSnapshots } from '@/providers/capabilities-snapshot';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import { createPersistenceWriter } from '@/providers/persistence-hydration';
import { listActiveSessions } from '@/providers/services/session-service';
import { createSharedEventStream } from '@/providers/shared-event-stream';
import type { WorkspaceShellState } from '@/providers/use-workspace-shell-state';
import { connectedWorkspaceTarget } from '@/providers/workspace-focus';
import { createWorkspaceWaiters } from '@/providers/workspace-lifecycle';
import { parseWorkspaces, serializeWorkspaces, WORKSPACES_STORAGE_KEY } from '@/providers/workspace-storage';
import { workspaceKey, type ConnectionRecord, type SessionTarget, type WorkspaceSnapshot, type WorkspaceTarget } from '@/providers/workspace-types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export const SERVER_PREFERENCE_KEYS = ['providerId', 'modelId', 'enabledModelIds', 'providerModelSelections', 'modelVariantSelections', 'recentModelIds', 'mode', 'autoApprove', 'autoModel'] as const;
export function serverPreferences(value: Partial<ChatPreferences>) {
  return Object.fromEntries(SERVER_PREFERENCE_KEYS.filter((key) => key in value).map((key) => [key, value[key]])) as Partial<ChatPreferences>;
}

export function useWorkspaceConnections(shell: WorkspaceShellState, hydrated: boolean) {
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [focus, setFocus] = useState<WorkspaceTarget>();
  const [retainedFocus, setRetainedFocus] = useState<WorkspaceTarget>();
  const [ready, setReady] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<string, WorkspaceSnapshot>>({});
  const records = useRef(connections), selected = useRef(focus), live = useRef(snapshots);
  const lastAvailable = useRef<string | undefined>(undefined);
  const previousAvailable = useRef<string | undefined>(undefined);
  const shellRef = useRef(shell);
  const [waiters] = useState(createWorkspaceWaiters);
  const navigation = useRef<AbortController | undefined>(undefined);
  const canPersist = useRef(true);
  const activation = useRef(0);
  const [write] = useState(createPersistenceWriter);
  useLayoutEffect(() => { shellRef.current = shell; });
  useEffect(() => { waiters.resume(); return () => { waiters.dispose(); navigation.current?.abort(); }; }, [waiters]);
  const change = useCallback((update: (current: ConnectionRecord[]) => ConnectionRecord[]) => {
    const next = update(records.current);
    if (next.length === records.current.length && next.every((entry, index) => entry === records.current[index])) return;
    const revisioned = next.map((entry) => {
      const previous = records.current.find((value) => value.id === entry.id);
      return previous && (previous.settings !== entry.settings || previous.enabled !== entry.enabled || previous.events !== entry.events)
        ? { ...entry, revision: (previous.revision ?? 0) + 1, authRevision: (previous.authRevision ?? 0) + (previous.settings.password !== entry.settings.password || JSON.stringify(previous.settings.headers) !== JSON.stringify(entry.settings.headers) || getConnectionScope(previous.settings) !== getConnectionScope(entry.settings) ? 1 : 0) } : entry;
    });
    records.current = revisioned; setConnections(revisioned); waiters.notify();
  }, [waiters]);
  const isEnabled = useCallback((id: string) => records.current.some((entry) => entry.id === id && entry.enabled), []);
  const select = useCallback((target: WorkspaceTarget, persist = true) => {
    if (persist) canPersist.current = true; selected.current = target; setFocus(target);
    if (Object.entries(live.current).some(([key, value]) => (JSON.parse(key) as string[])[0] === target.connectionId && ((JSON.parse(key) as string[])[1] === target.projectPath || value.values.projectsValue.activeProjectPath === target.projectPath))) setRetainedFocus(target);
  }, []);
  const clearFocus = useCallback((persist = true) => {
    if (persist) canPersist.current = true;
    selected.current = undefined;
    setFocus(undefined);
  }, []);
  const publish = useCallback((key: string, snapshot: WorkspaceSnapshot) => {
    if (live.current[key] === snapshot) return;
    live.current = { ...live.current, [key]: snapshot }; setSnapshots(live.current);
    const target = selected.current;
    if (target && (JSON.parse(key) as string[])[0] === target.connectionId && ((JSON.parse(key) as string[])[1] === target.projectPath || snapshot.values.projectsValue.activeProjectPath === target.projectPath)) {
      setRetainedFocus((previous) => previous?.connectionId === target.connectionId && previous.projectPath === target.projectPath ? previous : target);
    }
    waiters.notify();
  }, [waiters]);
  const forget = useCallback((key: string) => {
    const next = { ...live.current }; delete next[key]; live.current = next; setSnapshots(next); waiters.notify();
  }, [waiters]);

  const saveProfile = useCallback(async (settings: OpencodeConnectionSettings) => mutateConnectionProfiles(async (profiles, save) => {
    const existing = findMatchingProfile(profiles, settings);
    const profile = existing ?? { id: createProfileId(), name: getServerHostname(settings.serverUrl), serverUrl: settings.serverUrl, username: settings.username, connect: settings.connect };
    const previousPassword = existing ? await getProfilePassword(profile.id) : '';
    const previousHeaders = existing ? await getProfileHeaders(profile.id) : {};
    // Cloud Link credentials are device secrets with no custom headers; a
    // manual connection keeps its gateway headers alongside the password.
    const headers = settings.connect ? {} : settings.headers;
    if (!settings.connect && (previousPassword !== settings.password || JSON.stringify(previousHeaders) !== JSON.stringify(settings.headers ?? {}))) await clearCapabilitiesSnapshots(getConnectionScope(settings));
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
  const readWorkspace = useCallback((target: WorkspaceTarget) => {
    const entry = records.current.find((item) => item.id === target.connectionId);
    if (!entry) throw new Error('This server is no longer available.');
    const snapshot = live.current[resolveKey(target)];
    return snapshot && snapshot.enabled === entry.enabled && (snapshot.revision ?? 0) === (entry.revision ?? 0) ? snapshot : undefined;
  }, [resolveKey]);
  const ensure = useCallback(async (target: WorkspaceTarget, options?: { signal?: AbortSignal }) => {
    if (!live.current[resolveKey(target)]) change((current) => current.map((entry) => entry.id === target.connectionId && !entry.projects.includes(target.projectPath)
      ? { ...entry, projects: [...entry.projects, target.projectPath] } : entry));
    return waiters.wait(() => readWorkspace(target), options?.signal);
  }, [change, readWorkspace, resolveKey, waiters]);
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
  const connectedWorkspace = useCallback(async (target: WorkspaceTarget, options?: { signal?: AbortSignal }) => {
    const entry = records.current.find((item) => item.id === target.connectionId);
    if (!entry?.enabled) throw new Error('Connect this server before opening its workspace.');
    const snapshot = await ensure(target, options);
    let failure: unknown;
    if (snapshot.values.connectionValue.connection.status !== 'connected') {
      if (options?.signal?.aborted) throw new Error('This navigation was cancelled.');
      const attempt = snapshot.values.connectionValue.connection.status === 'error' ? retry(target.connectionId) : snapshot.values.connectionValue.connect();
      void attempt.catch((error) => { failure = error; waiters.notify(); });
    }
    return waiters.wait(() => {
      if (failure) throw failure;
      if (!records.current.find((item) => item.id === target.connectionId)?.enabled) throw new Error('Server disconnected.');
      const current = readWorkspace(target);
      const connection = current?.values.connectionValue.connection;
      if (connection?.status === 'error') throw new Error(connection.message);
      return connection?.status === 'connected' ? current : undefined;
    }, options?.signal);
  }, [ensure, readWorkspace, retry, waiters]);
  const beginActivation = useCallback((externalSignal?: AbortSignal) => {
    navigation.current?.abort();
    const controller = new AbortController(); navigation.current = controller;
    if (externalSignal) {
      const cancel = () => controller.abort();
      externalSignal.addEventListener('abort', cancel, { once: true });
      controller.signal.addEventListener('abort', () => externalSignal.removeEventListener('abort', cancel), { once: true });
      if (externalSignal.aborted) controller.abort();
    }
    return controller.signal;
  }, []);
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
    const signal = beginActivation();
    const operation = ++activation.current;
    const check = () => { if (signal.aborted || operation !== activation.current) throw new Error('This navigation was cancelled.'); };
    check();
    await pauseConversation();
    const next = await connectedWorkspace(target, { signal });
    check();
    // Rows are rendered from a runtime catalog or project list, so a normal tap
    // is known locally. Only stale references (for example an old favorite)
    // need one catalog read to report that the chat no longer exists.
    const known = () => Object.entries(live.current).some(([key, snapshot]) => (
      (JSON.parse(key) as string[])[0] === target.connectionId && (
      snapshot.catalogSessions.some((session) => session.id === target.sessionId && (!session.directory || session.directory === target.projectPath))
      || snapshot.values.sessionLibraryValue.sessions.some((session) => session.id === target.sessionId && (!session.directory || session.directory === target.projectPath))
    )));
    if (!known()) {
      const catalog = await listActiveSessions(next.catalogClient);
      check();
      if (!catalog.sessions.some((session) => session.id === target.sessionId && (!session.directory || session.directory === target.projectPath))) {
        throw new Error(`Session ${target.sessionId} was not found in the ${target.projectPath} project.`);
      }
    }
    check();
    await next.values.currentSessionValue.openSession(target.sessionId);
    check();
    selectWorkspace(target, next);
    navigation.current?.abort();
  }, [beginActivation, connectedWorkspace, pauseConversation, selectWorkspace]);
  // Workspace focus without a session. Project switching and "new chat" use
  // this; session selection happens separately through navigate/openSession.
  const activate = useCallback(async (target: WorkspaceTarget) => {
    const signal = beginActivation();
    const operation = ++activation.current;
    const check = () => { if (signal.aborted || operation !== activation.current) throw new Error('This navigation was cancelled.'); };
    check();
    await pauseConversation();
    const next = await connectedWorkspace(target, { signal });
    check();
    selectWorkspace(target, next);
    navigation.current?.abort();
  }, [beginActivation, connectedWorkspace, pauseConversation, selectWorkspace]);
  // External link resolution (notifications, widgets, quick actions, OS links)
  // confirms the target against the owning server before switching. In-app
  // navigation must not use this path.
  const openExternalSession = useCallback(async (target: SessionTarget, externalSignal?: AbortSignal) => {
    const signal = beginActivation(externalSignal);
    const operation = ++activation.current;
    const check = () => { if (signal.aborted || operation !== activation.current) throw new Error('This session link was cancelled.'); };
    check();
    await pauseConversation();
    const next = await connectedWorkspace(target, { signal });
    check();
    if (target.connectionId !== selected.current?.connectionId) {
      await next.values.sessionLibraryValue.refreshSessions();
      check();
    }
    const opened = await next.values.currentSessionValue.openDeepLinkSession({ sessionId: target.sessionId, projectPath: target.projectPath || undefined }, signal);
    if (!opened.ok) throw new Error(opened.error);
    check();
    selectWorkspace(target, next);
    navigation.current?.abort();
  }, [beginActivation, connectedWorkspace, pauseConversation, selectWorkspace]);
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
      : [...current, { id, name: profile.name, settings: full, enabled: true, preferences: { autoApprove: false, ...serverPreferences(preferences ?? profile.modelPreferences ?? {}) }, projects: [projectPath], events: createSharedEventStream() }]);
    const target = { connectionId: id, projectPath };
    const runtime = await ensure(target);
    if (selectWorkspace) {
      await pauseConversation(); select(target);
      // Retire the onboarding placeholder only after its replacement published,
      // so changing servers never unmounts the onboarding route tree.
      change((current) => current.filter((entry) => entry.id === id || entry.enabled || entry.id !== getConnectionUiScope(defaultConnectionSettings)));
    }
    return runtime.values.connectionValue.connect();
  }, [change, ensure, pauseConversation, saveProfile, select]);
  const disconnect = useCallback(async (id: string) => {
    canPersist.current = true;
    navigation.current?.abort();
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
  return { isEnabled, closeProject, closeProjects, connectedWorkspace, removeConnection, connections, focus, retainedFocus, snapshots, ready, change, select, publish, forget, ensure, resolveKey, activate, navigate, openExternalSession, switchConnection, disconnect, retry, updateSettings, updatePreferences };
}
