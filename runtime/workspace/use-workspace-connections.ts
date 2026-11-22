import { deleteProfileHeaders, getProfileHeaders, saveProfileHeaders } from '@/shared/storage/connection-headers';
import { getProfileCertificate, saveProfileCertificate } from '@/shared/storage/connection-certificates';
import { connectionOrigin, releaseHostTrust } from '@/shared/platform/tls-trust';
import type { ConnectionCertificate } from '@/shared/contracts/connection-certificate';
import type { ConnectionHeaders } from '@/shared/contracts/connection-headers';
import { createProfileId, deleteProfilePassword, getProfilePassword, loadConnectionProfiles, mutateConnectionProfiles, readProfileConnection, saveProfilePassword } from '@/shared/storage/connection-profiles';
import { findMatchingProfile, pickModelPreferences, type ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { HIDDEN_PROJECTS_MAX } from '@/shared/contracts/domain';
import { defaultConnectionSettings, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';
import { getServerHostname } from '@/shared/contracts/server-url';
import { clearCapabilitiesSnapshots } from '@/features/ai/runtime';
import { clearMissionStatsCaches } from '@/features/sessions/runtime';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { createPersistenceWriter } from '@/shared/storage/persistence-hydration';
import type { WorkspaceShellState } from '@/runtime/workspace/use-workspace-shell-state';
import type { AppState, RegistryState, ShellState } from '@/runtime/core/store';
import { connectedWorkspaceTarget } from '@/runtime/workspace/workspace-focus';
import type { createWorkspaceCommands } from '@/runtime/core/commands/workspace';
import { parseWorkspaces, serializeWorkspaces, WORKSPACES_STORAGE_KEY } from '@/shared/storage/workspace-storage';
import type { ConnectionRecord, WorkspaceTarget } from '@/shared/contracts/workspace';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const SERVER_PREFERENCE_KEYS = ['enabledModelIds', 'knownModelIds', 'autoEnableNewModels', 'recentModelIds', 'mode', 'autoApprove', 'autoModel'] as const;
export function serverPreferences(value: Partial<ChatPreferences>) {
  return Object.fromEntries(SERVER_PREFERENCE_KEYS.filter((key) => key in value).map((key) => [key, value[key]])) as Partial<ChatPreferences>;
}

export type WorkspaceRegistryAccess = {
  registry: RegistryState;
  commands: ReturnType<typeof createWorkspaceCommands>;
  getRegistry: () => RegistryState;
  getShell: () => ShellState;
  setRegistry: AppState['setRegistry'];
};

export function useWorkspaceConnections(shell: WorkspaceShellState, hydrated: boolean, access: WorkspaceRegistryAccess) {
  const { registry, commands, getRegistry, getShell, setRegistry } = access;
  const { setSettings, setChatPreferences, setHiddenProjects } = shell;
  const { connections, focus, retainedFocus, ready, snapshots } = registry;
  const records = { get current() { return getRegistry().connections; } };
  const selected = { get current() { return getRegistry().focus; } };
  const live = { get current() { return getRegistry().snapshots; } };
  const { change, select, publish, forget, resolveKey, ensure, connectedWorkspace, isEnabled,
    activate, navigate, openExternalSession, pauseConversation, retry } = commands;
  const setReady = useCallback((next: boolean) => setRegistry({ ready: next }), [setRegistry]);
  const [write] = useState(createPersistenceWriter);
  useEffect(() => { commands.resume(); return commands.dispose; }, [commands]);

  const saveProfile = useCallback(async (settings: OpencodeConnectionSettings) => mutateConnectionProfiles(async (profiles, save) => {
    const existing = findMatchingProfile(profiles, settings);
    const profile = existing ?? { id: createProfileId(), name: getServerHostname(settings.serverUrl), serverUrl: settings.serverUrl, username: settings.username, connect: settings.connect, ...(settings.oidc ? { oidc: settings.oidc } : {}) };
    const previousPassword = existing ? await getProfilePassword(profile.id) : '';
    const previousHeaders = existing ? await getProfileHeaders(profile.id) : {};
    const previousCertificate = existing ? await getProfileCertificate(profile.id) : undefined;
    // Cloud Link credentials are device secrets with no custom headers or CA;
    // a manual connection keeps its gateway headers and certificate.
    const headers = settings.connect ? {} : settings.headers ?? {};
    const certificate = settings.connect ? undefined : settings.certificate;
    if (!settings.connect && (previousPassword !== settings.password || JSON.stringify(previousHeaders) !== JSON.stringify(settings.headers ?? {}) || JSON.stringify(previousCertificate) !== JSON.stringify(certificate) || JSON.stringify(existing?.oidc) !== JSON.stringify(settings.oidc))) await clearCapabilitiesSnapshots(getConnectionScope(settings));
    // Reconnects repeat the same credentials; only touch secure storage when a
    // value actually changed.
    try {
      if (previousPassword !== settings.password) await saveProfilePassword(profile.id, settings.password, Boolean(settings.connect));
      if (JSON.stringify(previousHeaders) !== JSON.stringify(headers)) await saveProfileHeaders(profile.id, headers);
      if (JSON.stringify(previousCertificate) !== JSON.stringify(certificate)) await saveProfileCertificate(profile.id, certificate);
      if (!existing) await save([...profiles, profile]);
    } catch (error) {
      if (existing) {
        await saveProfilePassword(profile.id, previousPassword, Boolean(settings.connect)).catch(() => undefined);
        await saveProfileHeaders(profile.id, previousHeaders).catch(() => undefined);
        await saveProfileCertificate(profile.id, previousCertificate).catch(() => undefined);
      } else {
        await deleteProfilePassword(profile.id).catch(() => undefined);
        await deleteProfileHeaders(profile.id).catch(() => undefined);
        await saveProfileCertificate(profile.id, undefined).catch(() => undefined);
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
      catch (error) { commands.setPersistenceAllowed(false); console.warn('Could not read workspace registry.', error); }
      if (stored) {
        // Project lists are server-derived; never restore locally remembered
        // projects. Every connection boots from the placeholder runtime and
        // derives its project from the server catalog.
        stored = { ...stored, connections: stored.connections.map((entry) => ({ ...entry, projects: [''] })),
          focus: stored.focus ? { connectionId: stored.focus.connectionId, projectPath: '' } : undefined };
      }
      const initial = getShell();
      const profiles = await loadConnectionProfiles();
      const entries: ConnectionRecord[] = stored ? await Promise.all(stored.connections.map(async (entry) => {
        const profile = findMatchingProfile(profiles, entry.settings);
        let password = '';
        let headers: ConnectionHeaders = {};
        let certificate: ConnectionCertificate | undefined;
        if (profile) {
          [password, headers, certificate] = await Promise.all([getProfilePassword(profile.id), getProfileHeaders(profile.id), getProfileCertificate(profile.id)]);
        }
        return { ...entry, settings: { ...entry.settings, password, headers, ...(certificate ? { certificate } : {}), ...(profile?.oidc ? { oidc: profile.oidc } : {}) } };
      })) : [];
      if (!entries.length) {
        const placeholder = !initial.onboardingVersion && getConnectionUiScope(initial.settings) === getConnectionUiScope(defaultConnectionSettings);
        const profile = placeholder ? { name: getServerHostname(initial.settings.serverUrl), modelPreferences: undefined } : await saveProfile(initial.settings);
        entries.push({ id: getConnectionUiScope(initial.settings), name: profile.name, settings: initial.settings,
          enabled: initial.onboardingVersion > 0, preferences: { ...profile.modelPreferences, ...serverPreferences(initial.chatPreferences) },
          projects: [''] });
      }
      if (cancelled) return;
      const target = stored?.focus ?? { connectionId: entries[0].id, projectPath: entries[0].projects[0] ?? '' };
      change(() => entries); select(target, false); setReady(true);
    })().catch((error) => {
      console.error('Could not restore workspaces.', error);
      commands.setPersistenceAllowed(false);
      if (cancelled) return;
      const initial = getShell();
      const id = getConnectionUiScope(initial.settings);
      change(() => [{ id, name: getServerHostname(initial.settings.serverUrl), settings: initial.settings, enabled: initial.onboardingVersion > 0,
        preferences: serverPreferences(initial.chatPreferences), projects: [''] }]);
      select({ connectionId: id, projectPath: '' }, false); setReady(true);
    });
    return () => { cancelled = true; };
  }, [hydrated, change, commands, getShell, select, saveProfile, setReady, write]);

  const persisted = useMemo(() => {
    // Only the connection list and the focused connection survive a restart.
    // Project runtimes always boot from the placeholder and derive the project
    // from the server catalog (most recently active first).
    const entries = connections.map((entry) => ({ ...entry, projects: [''] as string[] }));
    return serializeWorkspaces(entries, focus ? { connectionId: focus.connectionId, projectPath: '' } : undefined);
  }, [connections, focus]);
  useEffect(() => {
    // Automatic capability refreshes must not overwrite an unread registry.
    if (ready && commands.isPersistenceAllowed()) void write(WORKSPACES_STORAGE_KEY, persisted, () => AsyncStorage.setItem(WORKSPACES_STORAGE_KEY, persisted))
      .catch((error) => console.warn('Could not save workspaces.', error));
  }, [commands, persisted, ready, write]);

  // Remember the two most recent healthy chat owners so a failure returns to
  // the server the user was actually using instead of an arbitrary connected one.
  useEffect(() => {
    if (!focus || !records.current.find((entry) => entry.id === focus.connectionId)?.enabled) return;
    if (live.current[resolveKey(focus)]?.values.connectionValue.connection.status !== 'connected') return;
    const last = getRegistry().lastHealthyConnectionId;
    if (last === focus.connectionId) return;
    setRegistry({ lastHealthyConnectionId: focus.connectionId, previousHealthyConnectionId: last });
  }, [focus, getRegistry, resolveKey, setRegistry, snapshots]);
  // A server that errors or is explicitly disconnected must not leave Chat on
  // its failure screen while another enabled server is still connected.
  useEffect(() => {
    if (!ready || !focus) return;
    const entry = records.current.find((item) => item.id === focus.connectionId);
    const status = live.current[resolveKey(focus)]?.values.connectionValue.connection.status;
    if (entry?.enabled && status !== 'error') return;
    const { lastHealthyConnectionId, previousHealthyConnectionId } = getRegistry();
    const preferredConnectionId = lastHealthyConnectionId === focus.connectionId ? previousHealthyConnectionId : lastHealthyConnectionId;
    const target = connectedWorkspaceTarget(records.current, live.current, {
      excludedConnectionId: focus.connectionId,
      preferredConnectionId,
    });
    // Never turn an unread registry into a writable one just because a server
    // failed during startup; focus locally and let the next user action persist.
    if (target) select(target, commands.isPersistenceAllowed());
  }, [commands, connections, focus, ready, resolveKey, select, snapshots]);
  const registerConnection = useCallback(async (full: OpencodeConnectionSettings, profile: ConnectionProfile, preferences?: Partial<ChatPreferences>, selectWorkspace = true, signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error('This session link was cancelled.');
    const id = getConnectionUiScope(full);
    const found = records.current.find((entry) => entry.id === id);
    if (found) for (const [key, runtime] of Object.entries(live.current)) if ((JSON.parse(key) as string[])[0] === id) runtime.suspend();
    // Switching boots the placeholder runtime; its catalog read derives the
    // project from the server (most recently active first).
    change((current) => found ? current.map((entry) => entry.id === id ? { ...entry, settings: full, enabled: true,
      // A retained workspace already holds the live server choices. A profile
      // write can lag behind it, so only fill fields the entry is missing.
      preferences: { ...serverPreferences(preferences ?? {}), ...entry.preferences } } : entry)
      : [...current, { id, name: profile.name, settings: full, enabled: true, preferences: { autoApprove: false, ...serverPreferences(preferences ?? profile.modelPreferences ?? {}) }, projects: [''] }]);
    const target = { connectionId: id, projectPath: '' };
    const runtime = await ensure(target, { signal });
    if (selectWorkspace) {
      await pauseConversation(); select(target);
      // Retire the onboarding placeholder only after its replacement published,
      // so changing servers never unmounts the onboarding route tree.
      change((current) => current.filter((entry) => entry.id === id || entry.enabled || entry.id !== getConnectionUiScope(defaultConnectionSettings)));
    }
    return runtime.values.connectionValue.connect();
  }, [change, ensure, pauseConversation, select]);
  const switchConnection = useCallback(async (settings: Omit<OpencodeConnectionSettings, 'directory'>, preferences?: Partial<ChatPreferences>) => {
    const full = { ...settings, directory: '' };
    return registerConnection(full, await saveProfile(full), preferences);
  }, [registerConnection, saveProfile]);
  const connectSavedProfile = useCallback(async (profile: ConnectionProfile, signal?: AbortSignal) => {
    return registerConnection(await readProfileConnection(profile), profile, undefined, false, signal);
  }, [registerConnection]);
  const disconnect = useCallback(async (id: string) => {
    commands.setPersistenceAllowed(true);
    commands.cancelNavigation();
    for (const [key, runtime] of Object.entries(live.current)) if ((JSON.parse(key) as string[])[0] === id) {
      if (runtime.values.conversationValue.conversation.active) await runtime.values.conversationValue.toggleConversationMode();
      runtime.suspend();
    }
    change((current) => current.map((entry) => entry.id === id ? { ...entry, enabled: false } : entry));
  }, [change, commands]);
  const updateSettings = useCallback((id: string, value: OpencodeConnectionSettings, origin?: string) => {
    const previous = records.current.find((entry) => entry.id === id);
    if (!previous || JSON.stringify(previous.settings) === JSON.stringify(value)) return;
    const manualChange = !value.connect;
    if (manualChange) commands.setPersistenceAllowed(true);
    for (const [key, runtime] of Object.entries(live.current)) if ((JSON.parse(key) as string[])[0] === id && key !== origin) runtime.suspend();
    const nextId = getConnectionUiScope(value);
    change((current) => current.map((entry) => entry.id === id ? { ...entry, id: nextId, settings: value, ...(manualChange ? { enabled: false } : {}),
      ...(nextId === id ? {} : { enabled: false, projects: [''], preferences: { autoApprove: false } }) } : entry));
    if (previous.settings.certificate && !value.certificate) {
      const origin = connectionOrigin(previous.settings.serverUrl);
      const stillUsed = origin && records.current.some((entry) => entry.settings.certificate && connectionOrigin(entry.settings.serverUrl) === origin);
      if (origin && !stillUsed) void releaseHostTrust(previous.settings.serverUrl);
    }
    if (selected.current?.connectionId === id) { if (nextId !== id) select({ connectionId: nextId, projectPath: '' }); setSettings(value); }
  }, [change, commands, select, setSettings]);
  const updatePreferences = useCallback((id: string, value: ChatPreferences) => {
    if (!records.current.some((entry) => entry.id === id)) return;
    const preferences = serverPreferences(value);
    const previous = records.current.find((entry) => entry.id === id);
    const serverChanged = !previous || JSON.stringify(previous.preferences) !== JSON.stringify(preferences);
    change((current) => current.map((entry) => entry.id === id && JSON.stringify(entry.preferences) !== JSON.stringify(preferences) ? { ...entry, preferences } : entry));
    // The shell mirrors the focused workspace. A background connection must not
    // overwrite the focused server choices, and the focused update must win over
    // the previous shell value so a close immediately after the change persists
    // the new server-scoped preference instead of the stale one.
    const focused = selected.current?.connectionId === id;
    setChatPreferences((current) => {
      const next = focused ? value : current;
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
    // UI-only preference changes (text size, language, delivery, ...) must not
    // rewrite profile metadata; only server-relevant selections do.
    const entry = records.current.find((item) => item.id === id);
    if (serverChanged && entry) void mutateConnectionProfiles(async (profiles, save) => {
      const profile = findMatchingProfile(profiles, entry.settings);
      if (profile) await save(profiles.map((item) => item.id === profile.id ? { ...item, modelPreferences: pickModelPreferences(value) } : item));
    }).catch((error) => console.warn('Could not save model preferences.', error));
  }, [change, setChatPreferences]);
  const hiddenScope = useCallback((connectionId: string) => {
    const entry = records.current.find((item) => item.id === connectionId);
    return entry ? getConnectionScope(entry.settings) : undefined;
  }, []);
  const hideProject = useCallback((target: WorkspaceTarget) => {
    const scope = hiddenScope(target.connectionId);
    if (!scope) return;
    setHiddenProjects((current) => ({
      ...current,
      [scope]: [target.projectPath, ...(current[scope] ?? []).filter((path) => path !== target.projectPath)].slice(0, HIDDEN_PROJECTS_MAX),
    }));
  }, [hiddenScope, setHiddenProjects]);
  const restoreProject = useCallback((target: WorkspaceTarget) => {
    const scope = hiddenScope(target.connectionId);
    if (!scope) return;
    setHiddenProjects((current) => {
      const remaining = (current[scope] ?? []).filter((path) => path !== target.projectPath);
      const next = { ...current };
      if (remaining.length) next[scope] = remaining;
      else delete next[scope];
      return next;
    });
  }, [hiddenScope, setHiddenProjects]);
  const removeConnection = useCallback(async (id: string) => {
    const settings = records.current.find((entry) => entry.id === id)?.settings;
    await disconnect(id);
    if (settings) void clearMissionStatsCaches(getConnectionScope(settings));
    change((current) => current.filter((entry) => entry.id !== id));
    for (const key of Object.keys(live.current)) if ((JSON.parse(key) as string[])[0] === id) forget(key);
  }, [change, disconnect, forget]);
  return { isEnabled, hideProject, restoreProject, hiddenProjects: shell.hiddenProjects, connectedWorkspace, removeConnection, connections, focus, retainedFocus, snapshots, ready, change, select, publish, forget, ensure, resolveKey, activate, navigate, openExternalSession, switchConnection, connectSavedProfile, disconnect, retry, updateSettings, updatePreferences };
}
