import AsyncStorage from '@react-native-async-storage/async-storage';

import { deleteProfileHeaders, getProfileHeaders, saveProfileHeaders } from '@/shared/storage/connection-headers';
import { getProfileCertificate, saveProfileCertificate } from '@/shared/storage/connection-certificates';
import { connectionOrigin, releaseHostTrust } from '@/shared/platform/tls-trust';
import type { ConnectionCertificate } from '@/shared/contracts/connection-certificate';
import type { ConnectionHeaders } from '@/shared/contracts/connection-headers';
import type { ModelOption } from '@/shared/contracts/model-options';
import { createProfileId, deleteProfilePassword, getProfilePassword, loadConnectionProfiles, mutateConnectionProfiles, readProfileConnection, saveProfilePassword } from '@/shared/storage/connection-profiles';
import { findMatchingProfile, findProfileByConnectionScope, pickModelPreferences, type ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { HIDDEN_PROJECTS_MAX } from '@/features/projects/runtime';
import type { ConnectionState } from '@/features/connections/index';
import type { SessionDeepLinkTarget } from '@/features/sessions/index';
import { defaultConnectionSettings, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';
import { getServerHostname } from '@/shared/contracts/server-url';
import { agentsOptions, capabilitiesOptions, clearCapabilitiesSnapshots, getConfiguredProviderIds, patchModelPreferences } from '@/features/ai/runtime';
import { clearMissionStatsCaches } from '@/features/sessions/runtime';
import { defaultChatPreferences, type ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { configurationOptions } from '@/shared/server-data/catalogs';
import { createPersistenceWriter } from '@/shared/storage/persistence-hydration';
import { connectedWorkspaceTarget } from '@/runtime/workspace/workspace-focus';
import { parseWorkspaces, serializeWorkspaces, WORKSPACES_STORAGE_KEY } from '@/shared/storage/workspace-storage';
import type { ConnectionRecord, WorkspaceTarget } from '@/shared/contracts/workspace';

import type { CommandContext } from './context';
import type { createWorkspaceCommands } from './workspace';

const SERVER_PREFERENCE_KEYS = ['enabledModelIds', 'knownModelIds', 'autoEnableNewModels', 'recentModelIds', 'mode', 'autoApprove', 'autoModel'] as const;
export function serverPreferences(value: Partial<ChatPreferences>) {
  return Object.fromEntries(SERVER_PREFERENCE_KEYS.filter((key) => key in value).map((key) => [key, value[key]])) as Partial<ChatPreferences>;
}
const defaultServerPreferences = serverPreferences(defaultChatPreferences);

export function workspaceChatPreferences(device: ChatPreferences, server?: Partial<ChatPreferences>): ChatPreferences {
  return { ...device, ...defaultServerPreferences, ...server };
}

export function createConnectionCommands(
  { store, queryClient, connections }: Pick<CommandContext, 'store' | 'queryClient'> & { connections: Pick<CommandContext['connections'], 'get'> },
  commands: ReturnType<typeof createWorkspaceCommands>,
) {
  const { change, select, ensure, forget, resolveKey, pauseConversation, retry, navigate, openExternalSession } = commands;
  const registry = () => store.getState().registry;
  const { setRegistry, setShellValue } = store.getState();
  const write = createPersistenceWriter();

  function saveProfile(settings: OpencodeConnectionSettings) {
    return mutateConnectionProfiles(async (profiles, save) => {
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
    });
  }

  async function hydrate(signal: AbortSignal) {
    try {
      let stored;
      try { const raw = await AsyncStorage.getItem(WORKSPACES_STORAGE_KEY); stored = raw ? parseWorkspaces(raw) : undefined; }
      catch (error) {
        if (signal.aborted) return;
        commands.setPersistenceAllowed(false);
        console.warn('Could not read workspace registry.', error);
      }
      if (signal.aborted) return;
      if (stored) {
        // Project lists are server-derived; never restore locally remembered
        // projects. Every connection boots from the placeholder runtime and
        // derives its project from the server catalog.
        stored = { ...stored, connections: stored.connections.map((entry) => ({ ...entry, projects: [''] })),
          focus: stored.focus ? { connectionId: stored.focus.connectionId, projectPath: '' } : undefined };
      }
      const initial = store.getState().shell;
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
      if (signal.aborted) return;
      if (!entries.length) {
        const placeholder = !initial.onboardingVersion && getConnectionUiScope(initial.settings) === getConnectionUiScope(defaultConnectionSettings);
        const profile = placeholder ? { name: getServerHostname(initial.settings.serverUrl), modelPreferences: undefined } : await saveProfile(initial.settings);
        entries.push({ id: getConnectionUiScope(initial.settings), name: profile.name, settings: initial.settings,
          enabled: initial.onboardingVersion > 0, preferences: { ...profile.modelPreferences, ...serverPreferences(initial.chatPreferences) },
          projects: [''] });
      }
      if (signal.aborted) return;
      const target = stored?.focus ?? { connectionId: entries[0].id, projectPath: entries[0].projects[0] ?? '' };
      change(() => entries); select(target, false); setRegistry({ ready: true });
    } catch (error) {
      if (signal.aborted) return;
      console.error('Could not restore workspaces.', error);
      commands.setPersistenceAllowed(false);
      const initial = store.getState().shell;
      const id = getConnectionUiScope(initial.settings);
      change(() => [{ id, name: getServerHostname(initial.settings.serverUrl), settings: initial.settings, enabled: initial.onboardingVersion > 0,
        preferences: serverPreferences(initial.chatPreferences), projects: [''] }]);
      select({ connectionId: id, projectPath: '' }, false); setRegistry({ ready: true });
    }
  }

  async function persist() {
    const { connections: records, focus, ready } = registry();
    if (!ready || !commands.isPersistenceAllowed()) return;
    // Projects always derive from the server catalog after restart.
    const entries = records.map((entry) => ({ ...entry, projects: [''] }));
    const serialized = serializeWorkspaces(entries, focus ? { connectionId: focus.connectionId, projectPath: '' } : undefined);
    await write(WORKSPACES_STORAGE_KEY, serialized, () => AsyncStorage.setItem(WORKSPACES_STORAGE_KEY, serialized))
      .catch((error) => console.warn('Could not save workspaces.', error));
  }

  function reconcileFocus() {
    const { connections: records, focus, snapshots, ready, lastHealthyConnectionId, previousHealthyConnectionId } = registry();
    if (!focus) return;
    const entry = records.find((item) => item.id === focus.connectionId);
    const status = snapshots[resolveKey(focus)]?.values.connectionValue.connection.status;
    if (entry?.enabled && status === 'connected' && lastHealthyConnectionId !== focus.connectionId) {
      // Keep the last two healthy owners so failover returns to the prior server.
      setRegistry({ lastHealthyConnectionId: focus.connectionId, previousHealthyConnectionId: lastHealthyConnectionId });
    }
    if (!ready || (entry?.enabled && status !== 'error')) return;
    const target = connectedWorkspaceTarget(records, snapshots, {
      excludedConnectionId: focus.connectionId,
      preferredConnectionId: lastHealthyConnectionId === focus.connectionId ? previousHealthyConnectionId : lastHealthyConnectionId,
    });
    if (target) select(target, commands.isPersistenceAllowed());
  }

  function connect(id: string): Promise<ConnectionState> {
    return connections.get(id)?.connect() ?? Promise.resolve({ status: 'idle', message: 'Disconnected' });
  }

  async function registerConnection(full: OpencodeConnectionSettings, profile: ConnectionProfile, preferences?: Partial<ChatPreferences>, selectWorkspace = true, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('This session link was cancelled.');
    const id = getConnectionUiScope(full);
    const found = registry().connections.find((entry) => entry.id === id);
    if (found) for (const [key, runtime] of Object.entries(registry().snapshots)) if ((JSON.parse(key) as string[])[0] === id) runtime.suspend();
    // Switching boots the placeholder runtime; its catalog read derives the
    // project from the server (most recently active first).
    change((current) => found ? current.map((entry) => entry.id === id ? { ...entry, settings: full, enabled: true,
      // A retained workspace already holds the live server choices. A profile
      // write can lag behind it, so only fill fields the entry is missing.
      preferences: { ...serverPreferences(preferences ?? {}), ...entry.preferences } } : entry)
      : [...current, { id, name: profile.name, settings: full, enabled: true, preferences: { autoApprove: false, ...serverPreferences(preferences ?? profile.modelPreferences ?? {}) }, projects: [''] }]);
    const target = { connectionId: id, projectPath: '' };
    await ensure(target, { signal });
    if (signal?.aborted) throw new Error('This session link was cancelled.');
    if (selectWorkspace) {
      await pauseConversation(); select(target);
      // Retire the onboarding placeholder only after its replacement published,
      // so changing servers never unmounts the onboarding route tree.
      change((current) => current.filter((entry) => entry.id === id || entry.enabled || entry.id !== getConnectionUiScope(defaultConnectionSettings)));
    }
    return connect(id);
  }

  async function switchConnection(settings: Omit<OpencodeConnectionSettings, 'directory'>, preferences?: Partial<ChatPreferences>) {
    const full = { ...settings, directory: '' };
    return registerConnection(full, await saveProfile(full), preferences);
  }

  async function connectSavedProfile(profile: ConnectionProfile, signal?: AbortSignal) {
    return registerConnection(await readProfileConnection(profile), profile, undefined, false, signal);
  }

  async function disconnect(id: string) {
    commands.setPersistenceAllowed(true);
    commands.cancelNavigation();
    for (const [key, runtime] of Object.entries(registry().snapshots)) if ((JSON.parse(key) as string[])[0] === id) {
      if (runtime.values.conversationValue.conversation.active) await runtime.values.conversationValue.toggleConversationMode();
      runtime.suspend();
    }
    change((current) => current.map((entry) => entry.id === id ? { ...entry, enabled: false } : entry));
  }

  function updateSettings(id: string, value: OpencodeConnectionSettings, origin?: string) {
    const previous = registry().connections.find((entry) => entry.id === id);
    if (!previous || JSON.stringify(previous.settings) === JSON.stringify(value)) return;
    const manualChange = !value.connect;
    if (manualChange) commands.setPersistenceAllowed(true);
    for (const [key, runtime] of Object.entries(registry().snapshots)) if ((JSON.parse(key) as string[])[0] === id && key !== origin) runtime.suspend();
    const nextId = getConnectionUiScope(value);
    change((current) => current.map((entry) => entry.id === id ? { ...entry, id: nextId, settings: value, ...(manualChange ? { enabled: false } : {}),
      ...(nextId === id ? {} : { enabled: false, projects: [''], preferences: { autoApprove: false } }) } : entry));
    if (previous.settings.certificate && !value.certificate) {
      const origin = connectionOrigin(previous.settings.serverUrl);
      const stillUsed = origin && registry().connections.some((entry) => entry.settings.certificate && connectionOrigin(entry.settings.serverUrl) === origin);
      if (origin && !stillUsed) void releaseHostTrust(previous.settings.serverUrl);
    }
    if (registry().focus?.connectionId === id) { if (nextId !== id) select({ connectionId: nextId, projectPath: '' }); setShellValue('settings', value); }
  }

  function updatePreferences(id: string, value: ChatPreferences) {
    const previous = registry().connections.find((entry) => entry.id === id);
    if (!previous) return;
    const preferences = serverPreferences(value);
    const serverChanged = JSON.stringify(previous.preferences) !== JSON.stringify(preferences);
    change((current) => current.map((entry) => entry.id === id && JSON.stringify(entry.preferences) !== JSON.stringify(preferences) ? { ...entry, preferences } : entry));
    // The shell mirrors the focused workspace. A background connection must not
    // overwrite the focused server choices, and the focused update must win over
    // the previous shell value so a close immediately after the change persists
    // the new server-scoped preference instead of the stale one.
    const focused = registry().focus?.connectionId === id;
    setShellValue('chatPreferences', (current) => {
      const next = focused ? value : current;
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
    // UI-only preference changes (text size, language, delivery, ...) must not
    // rewrite profile metadata; only server-relevant selections do.
    const entry = registry().connections.find((item) => item.id === id);
    if (serverChanged && entry) void mutateConnectionProfiles(async (profiles, save) => {
      const profile = findMatchingProfile(profiles, entry.settings);
      if (profile) await save(profiles.map((item) => item.id === profile.id ? { ...item, modelPreferences: pickModelPreferences(value) } : item));
    }).catch((error) => console.warn('Could not save model preferences.', error));
  }

  function patchPreferences(target: WorkspaceTarget, patch: Partial<ChatPreferences>) {
    const { registry, selection, shell } = store.getState();
    const entry = registry.connections.find(({ id }) => id === target.connectionId);
    if (!entry) return;
    const directory = selection[resolveKey(target)]?.activeProjectPath ?? target.projectPath;
    const client = connections.get(entry.id)?.getProjectClient(directory);
    const identity = { connectionId: entry.id, connectionScope: getConnectionScope(entry.settings), authRevision: entry.authRevision ?? 0 };
    const discovery = client && queryClient.getQueryData(capabilitiesOptions(identity, client).queryKey);
    const config = client && queryClient.getQueryData(configurationOptions(identity, client).queryKey);
    const agents = client && queryClient.getQueryData(agentsOptions(identity, client).queryKey);
    let models: ModelOption[] = [];
    if (discovery && config && agents) {
      const configured = getConfiguredProviderIds(config.config, discovery.connected, discovery.models);
      for (const provider of discovery.providers) if (provider.configured) configured.add(provider.id);
      models = discovery.models.filter((model) => configured.has(model.providerID));
    }
    updatePreferences(entry.id, patchModelPreferences(workspaceChatPreferences(shell.chatPreferences, entry.preferences), patch, models));
  }

  function hiddenScope(connectionId: string) {
    const entry = registry().connections.find((item) => item.id === connectionId);
    return entry ? getConnectionScope(entry.settings) : undefined;
  }

  function hideProject(target: WorkspaceTarget) {
    const scope = hiddenScope(target.connectionId);
    if (!scope) return;
    setShellValue('hiddenProjects', (current) => ({
      ...current,
      [scope]: [target.projectPath, ...(current[scope] ?? []).filter((path) => path !== target.projectPath)].slice(0, HIDDEN_PROJECTS_MAX),
    }));
  }

  function restoreProject(target: WorkspaceTarget) {
    const scope = hiddenScope(target.connectionId);
    if (!scope) return;
    setShellValue('hiddenProjects', (current) => {
      const remaining = (current[scope] ?? []).filter((path) => path !== target.projectPath);
      const next = { ...current };
      if (remaining.length) next[scope] = remaining;
      else delete next[scope];
      return next;
    });
  }

  async function removeConnection(id: string) {
    const settings = registry().connections.find((entry) => entry.id === id)?.settings;
    await disconnect(id);
    if (settings) void clearMissionStatsCaches(getConnectionScope(settings));
    change((current) => current.filter((entry) => entry.id !== id));
    for (const key of Object.keys(registry().snapshots)) if ((JSON.parse(key) as string[])[0] === id) forget(key);
  }

  async function openSession(target: SessionDeepLinkTarget, signal?: AbortSignal) {
    const { connections: records, focus } = registry();
    try {
      let entry: Pick<ConnectionRecord, 'id' | 'projects' | 'enabled'> | undefined = target.connectionScope ? records.find((value) => getConnectionScope(value.settings) === target.connectionScope) : records.find((value) => value.id === focus?.connectionId);
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
  }

  // In-app library navigation. The session id came from rendered data, so this
  // resolves the owning connection locally and never validates against a
  // server list. Cross-server favorites still switch and connect the target.
  async function openSessionInProject(projectPath: string, sessionId: string, targetConnectionScope: string) {
    const entry = registry().connections.find((item) => getConnectionScope(item.settings) === targetConnectionScope);
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
  }

  return {
    hydrate, persist, reconcileFocus, connect, switchConnection, connectSavedProfile, disconnect,
    retry, removeConnection, updateSettings, updatePreferences, patchPreferences, hideProject, restoreProject, openSession, openSessionInProject,
  };
}
