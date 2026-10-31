import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { loadTs, hookRuntime } from '../../tests/helpers/runtime.mjs';
import { projectClosedValues } from '@/runtime/workspace/workspace-projection';

const identity = { getConnectionScope: (value: any) => `${value.serverUrl}:${value.username}`, getConnectionUiScope: (value: any) => `${value.serverUrl}:${value.username}` };
const keys = { sessionKey: (value: any) => JSON.stringify([value.connectionId, value.projectPath, value.sessionId]) };
describe('multi-server contracts', () => {
  it('keeps colliding session identities separate and interleaves by current/running/recency', async () => {
    const { librarySessions } = await loadTs('features/sessions/model/workspace-library.ts', {
    '@/shared/contracts/connection-scope': identity,
    "@/shared/contracts/workspace": keys,
    "@/runtime/workspace/workspace-types": keys
  });
    const connection = (id: string) => ({ id, name: id, enabled: true, settings: { serverUrl: `http://${id}`, username: '' } });
    const session = (id: string, updated: number) => ({ id, directory: '/same', title: id, time: { updated } });
    const snapshot = (id: string, sessions: any[], current?: string) => ({ catalogSessions: sessions, catalogStatuses: { busy: { type: 'busy' } }, values: {
      connectionValue: { connection: { status: 'connected' } }, projectsValue: { activeProjectPath: '/same' }, currentSessionValue: { currentSessionId: current },
      sessionLibraryValue: { sessions, sessionStatuses: {}, favoriteSessions: [], sessionPreviewById: {} },
    } });
    const rows = librarySessions([connection('a'), connection('b')], {
      '["a","/same"]': snapshot('a', [session('same', 3), session('idle', 1)], 'same'),
      '["b","/same"]': snapshot('b', [session('same', 9), session('busy', 2)]),
    }, { connectionId: 'a', projectPath: '/same' });
    expect(rows.map((row: any) => [row.connectionId, row.sessionId])).toEqual([['a', 'same'], ['b', 'busy'], ['b', 'same'], ['a', 'idle']]);
    expect(rows.filter((row: any) => row.current)).toHaveLength(1);
  });
  it('keeps unrelated workspace domains stable when only chat data changes', async () => {
    const driver = hookRuntime();
    const { useWorkspaceValues } = await loadTs('runtime/workspace/use-workspace-values.ts', {
    react: driver.react,
    '@/shared/contracts/connection-scope': identity,
    "@/runtime/workspace/workspace-projection": { projectClosedValues }
  });
    const settings = { serverUrl: 'http://a', username: '' };
    const base = {
      onboardingValue: { isHydrated: true, onboardingCompleted: true, onboardingActive: false },
      connectionValue: { settings, connect: async () => ({}), switchConnection: async () => ({}), connectionProfiles: [], connectSetup: {}, services: {} },
      projectsValue: { activeProjectPath: '/repo', projects: [], selectProject: () => {} },
      currentSessionValue: { currentSessionId: 's', openDeepLinkSession: async () => ({ ok: true }) },
      sessionLibraryValue: { openSessionInProject: async () => {} },
      chatValue: { currentMessages: [] },
    };
    const overrides = {
      isHydrated: true,
      onboardingCompleted: true,
      onboardingActive: false,
      connectionProfiles: [],
      connectSetup: {},
      servicesValue: {},
      sharedInput: {},
      projectPathsByConnection: { 'http://a:': ['/repo'] },
      retry: async () => ({}),
      activate: async () => {},
      switchConnection: async () => ({}),
      openSession: async () => ({ ok: true }),
      openSessionInProject: async () => {},
    };
    driver.mount((props: any) => useWorkspaceValues(props.values, props.overrides), { values: base, overrides });
    const first = driver.value;

    driver.update({ values: { ...base, chatValue: { currentMessages: ['new'] } }, overrides });
    const next = driver.value;
    expect(next.chatValue).not.toBe(first.chatValue);
    expect(next.onboardingValue).toBe(first.onboardingValue);
    expect(next.connectionValue).toBe(first.connectionValue);
    expect(next.projectsValue).toBe(first.projectsValue);
    expect(next.currentSessionValue).toBe(first.currentSessionValue);
    expect(next.sessionLibraryValue).toBe(first.sessionLibraryValue);

    driver.update({ values: { ...base, chatValue: { currentMessages: ['new'] } }, overrides: { ...overrides, onboardingActive: true } });
    expect(driver.value.onboardingValue).not.toBe(first.onboardingValue);
    expect(driver.value.connectionValue).toBe(first.connectionValue);
    driver.unmount();
  });

  it('shares one SSE transport across workspaces and detaches only the last consumer', async () => {
    const { createSharedEventStream } = await loadTs('shared/network/shared-event-stream.ts', {
    "@/shared/network/realtime-timing": { SSE_STALENESS_MS: 90000, WATCHDOG_TICK_MS: 7000 }
  });
    let opens = 0, cancelled = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const subscribe = createSharedEventStream(async function* (_client: any, signal: AbortSignal) {
      opens++;
      signal.addEventListener('abort', () => { cancelled++; release(); });
      yield { type: 'connected' };
      await gate;
    });
    const observed = vi.fn();
    const detach = subscribe.observe(observed);
    const a = new AbortController(), b = new AbortController();
    const first = subscribe({}, a.signal), second = subscribe({}, b.signal);
    expect((await first.next()).value.type).toBe('connected');
    expect((await second.next()).value.type).toBe('connected');
    expect(opens).toBe(1);
    expect(observed).toHaveBeenCalledOnce(); detach();
    const pending = first.next(); a.abort(); await pending;
    expect(cancelled).toBe(0);
    const other = second.next(); b.abort(); await other;
    expect(cancelled).toBe(1);
  });
  it('validates registry identities and never persists credentials', async () => {
    const appearance = await loadTs('shared/ui/theme/appearance.ts');
    const autoModelPreferences = await loadTs('shared/preferences/auto-model.ts');
    const parsing = await loadTs('shared/storage/persisted-preferences.ts', {
    '@/shared/ui/theme/appearance': appearance,
    '@/shared/preferences/auto-model': autoModelPreferences,
    zod: { z },
    "@/shared/contracts/cloud-link": { parseConnectMetadata: () => undefined },
    "@/shared/contracts/server-url": { stripServerUrlCredentials: (value: string) => value },
    "@/shared/platform/voice/wake-phrase": { normalizeWakePhrase: (value: string) => value },
    "@/shared/platform/voice/local-wake-word/types": { normalizeLocalWakePhrase: (value: string) => value, normalizeLocalCommandModel: (value: string) => value },
    "@/shared/preferences/opencode-preferences": { normalizeTranscriptFontSize: (value: number) => value }
  });
    const { parseWorkspaces, serializeWorkspaces } = await loadTs('shared/storage/workspace-storage.ts', {
    '@/shared/contracts/connection-scope': identity,
    '@/shared/storage/persisted-preferences': parsing,
    "@/shared/storage/connection-password": { withoutConnectionSecrets: ({ password, headers, ...value }: any) => value },
    "@/shared/contracts/server-url": { isValidServerUrl: (value: string) => value.startsWith('http') }
  });
    const entry = { id: 'http://a:', name: 'A', enabled: true, settings: { serverUrl: 'http://a', username: '', directory: '', password: 'secret', headers: { 'CF-Access-Client-Secret': 'header-secret' } }, preferences: { autoApprove: false }, projects: ['/same'], events: () => {} };
    const serialized = serializeWorkspaces([entry], { connectionId: entry.id, projectPath: '/same' });
    expect(serialized).not.toContain('secret'); expect(serialized).not.toContain('password'); expect(serialized).not.toContain('headers');
    expect(parseWorkspaces(serialized).connections[0].enabled).toBe(true);
    expect(() => parseWorkspaces(serialized.replace('http://a:', 'wrong-id'))).toThrow();
    expect(() => parseWorkspaces(JSON.stringify({ version: 2, connections: [] }))).toThrow();
    expect(() => parseWorkspaces(JSON.stringify({ version: 1, connections: [{ ...entry, events: undefined }] }))).toThrow();
    expect(() => parseWorkspaces(JSON.stringify({ version: 1, connections: [{ ...entry, events: undefined, settings: { serverUrl: 'http://a', username: '', directory: '', headers: { 'CF-Access-Client-Secret': 'header-secret' } } }] }))).toThrow();
  });
});

it('tracks unsaved drafts across hidden servers without counting clean editors or scroll state', async () => {
  const { hasWorkspaceDrafts, clearWorkspacePresentation } = await loadTs('runtime/presentation/workspace-presentation.ts');
  const editor = `editor:${JSON.stringify(['a', '/repo', 'file'])}`;
  const states = new Map<string, unknown>([
    [editor, { original: 'before', value: 'before' }],
    ['scroll:a:/repo/session', { offset: 10, follow: false }],
    [`composer:${JSON.stringify([JSON.stringify(['b', '/repo']), 'session'])}`, { draft: '', attachments: [{ uri: 'file://test' }] }],
  ]);
  expect(hasWorkspaceDrafts(states, 'a')).toBe(false);
  expect(hasWorkspaceDrafts(states, 'b')).toBe(true);
  expect(hasWorkspaceDrafts(states)).toBe(true);
  states.set(editor, { original: 'before', value: 'after' });
  expect(hasWorkspaceDrafts(states, 'a')).toBe(true);
  clearWorkspacePresentation(states, 'a');
  expect(states.has(editor)).toBe(false);
  expect(hasWorkspaceDrafts(states)).toBe(true);
  clearWorkspacePresentation(states, 'b');
  expect(hasWorkspaceDrafts(states)).toBe(false);
});

it('auto-approves colliding requests only on the owning server with the policy enabled', async () => {
  const driver = hookRuntime();
  const { useWorkspaceAutoApprove } = await loadTs('runtime/composition/use-workspace-auto-approve.ts', { react: driver.react }, driver.globals);
  const a = vi.fn(async () => {}), b = vi.fn(async () => {});
  const snapshot = (replyToPermission: typeof a) => ({ values: { connectionValue: { connection: { status: 'connected' } }, chatValue: { replyToPermission } }, pendingPermissions: { session: [{ id: 'same-request' }] } });
  const connections = [{ id: 'a', enabled: true, preferences: { autoApprove: true } }, { id: 'b', enabled: true, preferences: { autoApprove: false } }];
  const snapshots = { '["a","/repo"]': snapshot(a), '["b","/repo"]': snapshot(b) };
  driver.mount(useWorkspaceAutoApprove, { connections, snapshots });
  await driver.settle();
  expect(a).toHaveBeenCalledWith('same-request', 'once'); expect(b).not.toHaveBeenCalled();
  driver.update({ connections: connections.map((entry) => ({ ...entry, preferences: { autoApprove: true } })) });
  await driver.settle();
  expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledWith('same-request', 'once');
  driver.update({ snapshots: { ...snapshots } }); await driver.settle();
  expect(b).toHaveBeenCalledOnce(); driver.unmount();
});

it('restarts a silent shared stream even when a widget consumer stays attached', async () => {
  let watchdog!: () => void, release!: () => void, now = 0;
  const { createSharedEventStream } = await loadTs('shared/network/shared-event-stream.ts', {
    "@/shared/network/realtime-timing": { SSE_STALENESS_MS: 100, WATCHDOG_TICK_MS: 10 }
  }, { setInterval: (callback: () => void) => { watchdog = callback; return 1; }, clearInterval: () => {}, Date: class extends Date { static now() { return now; } } });
  const source = createSharedEventStream(async function* (_client: unknown, signal: AbortSignal) {
    const stopped = new Promise<void>((resolve) => { release = resolve; });
    signal.addEventListener('abort', () => release());
    yield { type: 'connected' }; await stopped;
  });
  const widget = source({}, new AbortController().signal);
  expect((await widget.next()).value.type).toBe('connected');
  now = 101; watchdog();
  expect((await widget.next()).done).toBe(true);
});

it('keeps lifecycle decisions current and closes projects without resetting retained runtimes', async () => {
  const driver = hookRuntime();
  const entries = ['a', 'b'].map((id) => ({ id, name: id, settings: { serverUrl: `http://${id}`, username: '', password: '', directory: '' }, projects: ['/repo', '/other'], preferences: {}, enabled: true }));
  const paths = { 'http://a:': ['/repo', '/other'], 'http://b:': ['/repo'] };
  const shell: any = { settings: entries[0].settings, onboardingVersion: 1, chatPreferences: {}, projectPathsByConnection: paths,
    projectPathsByConnectionRef: { current: paths }, setProjectPathsByConnection: vi.fn(), setSettings: vi.fn() };
  const writer = Object.assign(async () => {}, { preserveUnread: vi.fn() });
  const workspaceFocus = await loadTs('runtime/workspace/workspace-focus.ts');
  const { useWorkspaceConnections } = await loadTs('runtime/workspace/use-workspace-connections.ts', {
    react: driver.react,
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => 'stored', setItem: async () => {} } },
    '@/runtime/workspace/workspace-focus': workspaceFocus,
    "@/shared/contracts/connection-scope": { ...identity, getConnectionUiScope: (value: any) => value.serverUrl.slice(7) },
    "@/shared/storage/connection-profiles": { createProfileId: () => 'new', getProfilePassword: async () => '', loadConnectionProfiles: async () => [], mutateConnectionProfiles: vi.fn(), saveProfilePassword: vi.fn(), deleteProfilePassword: vi.fn() },
    "@/shared/contracts/connection-profiles": { findMatchingProfile: () => undefined, pickModelPreferences: () => ({}) },
    "@/shared/storage/connection-headers": { getProfileHeaders: async () => ({}), saveProfileHeaders: vi.fn(), deleteProfileHeaders: vi.fn() },
    "@/shared/protocol/opencode/client/types": { defaultConnectionSettings: { serverUrl: 'http://default', username: '' } },
    "@/shared/contracts/server-url": { getServerHostname: (value: string) => value },
    "@/shared/storage/persistence-hydration": { createPersistenceWriter: () => writer },
    "@/shared/network/shared-event-stream": { createSharedEventStream: () => () => {} },
    "@/shared/protocol/services/session-service": { listActiveSessions: vi.fn(async () => ({ sessions: [], statuses: {} })) },
    "@/shared/storage/workspace-storage": { WORKSPACES_STORAGE_KEY: 'workspaces', parseWorkspaces: () => ({ connections: entries, focus: { connectionId: 'a', projectPath: '/repo' } }), serializeWorkspaces: () => 'stored' },
    "@/shared/contracts/workspace": { workspaceKey: ({ connectionId, projectPath }: any) => JSON.stringify([connectionId, projectPath]) }
  }, driver.globals);
  driver.mount(({ shell }: any) => useWorkspaceConnections(shell, true), { shell });
  const isEnabled = driver.value.isEnabled;
  await driver.settle();
  expect(isEnabled('a')).toBe(true);
  const snapshot = (id: string, path: string) => ({ enabled: true, native: { settings: driver.value.connections.find((entry: any) => entry.id === id).settings },
    catalogSessions: [], suspend: vi.fn(), values: { sessionLibraryValue: { sessions: [], refreshSessions: vi.fn(async () => []) }, currentSessionValue: { openSession: vi.fn(async () => {}), openDeepLinkSession: vi.fn(async () => ({ ok: true })) }, projectsValue: { activeProjectPath: path }, conversationValue: { conversation: { active: true }, toggleConversationMode: vi.fn(async () => {}) }, connectionValue: { connection: { status: 'connected' } } } });
  const original = snapshot('a', '/repo'), other = snapshot('a', '/other'), b = snapshot('b', '/repo');
  driver.value.publish('["a","/repo"]', original); driver.value.publish('["a","/other"]', other); driver.value.publish('["b","/repo"]', b); driver.flush();
  original.catalogSessions = [{ id: 'collision', directory: '/repo' }] as never[];
  await expect(driver.value.navigate({ connectionId: 'b', projectPath: '/repo', sessionId: 'collision' })).rejects.toThrow('was not found');
  expect(b.values.currentSessionValue.openSession).not.toHaveBeenCalled();
  b.catalogSessions = [{ id: 'collision', directory: '/repo' }] as never[];
  await driver.value.navigate({ connectionId: 'b', projectPath: '/repo', sessionId: 'collision' }); driver.flush();
  expect(b.values.currentSessionValue.openSession).toHaveBeenCalledWith('collision');
  driver.value.select({ connectionId: 'a', projectPath: '/repo' }); driver.flush();
  await driver.value.openExternalSession({ connectionId: 'b', projectPath: '/repo', sessionId: 'collision' });
  expect(b.values.currentSessionValue.openDeepLinkSession).toHaveBeenCalledWith({ sessionId: 'collision', projectPath: '/repo' }, expect.any(AbortSignal));
  expect(original.values.currentSessionValue.openDeepLinkSession).not.toHaveBeenCalled();
  driver.value.select({ connectionId: 'a', projectPath: '/repo' }); driver.flush();
  await driver.value.closeProject({ connectionId: 'a', projectPath: '/repo' }); driver.flush();
  expect(driver.value.focus).toEqual({ connectionId: 'a', projectPath: '/other' });
  expect(shell.projectPathsByConnectionRef.current['http://a:']).toEqual(['/other']);
  expect(driver.value.snapshots['["a","/repo"]']).toBe(original);
  expect(original.suspend).not.toHaveBeenCalled();
  expect(original.values.conversationValue.toggleConversationMode).toHaveBeenCalledTimes(4);
  await driver.value.disconnect('a'); driver.flush();
  expect(isEnabled('a')).toBe(false); expect(isEnabled('b')).toBe(true);
  expect(original.suspend).toHaveBeenCalledOnce(); expect(other.suspend).toHaveBeenCalledOnce(); expect(b.suspend).not.toHaveBeenCalled();
  driver.unmount();
});

it('selects a connected fallback for failover and prefers the last healthy server', async () => {
  const { connectedWorkspaceTarget } = await loadTs('runtime/workspace/workspace-focus.ts');
  const connection = (id: string, enabled = true) => ({ id, enabled });
  const snapshot = (id: string, status: string, path = '/repo', activeProjectPath = path) => ({ values: {
    connectionValue: { connection: { status } }, projectsValue: { activeProjectPath },
  }, native: { settings: { serverUrl: `http://${id}`, username: '' } } });
  const snapshots = {
    '["a","/repo"]': snapshot('a', 'connected'),
    '["b","/repo"]': snapshot('b', 'connecting'),
    '["c","/repo"]': snapshot('c', 'connected', '/c', '/c'),
    '["d","/repo"]': snapshot('d', 'connected'),
  };
  expect(connectedWorkspaceTarget([connection('a', false), connection('b'), connection('c'), connection('d')], snapshots))
    .toEqual({ connectionId: 'c', projectPath: '/c' });
  expect(connectedWorkspaceTarget([connection('a'), connection('b'), connection('c'), connection('d')], snapshots, { preferredConnectionId: 'd' }))
    .toEqual({ connectionId: 'd', projectPath: '/repo' });
  expect(connectedWorkspaceTarget([connection('a', false), connection('b'), connection('c'), connection('d')], snapshots, { excludedConnectionId: 'c' }))
    .toEqual({ connectionId: 'd', projectPath: '/repo' });
  expect(connectedWorkspaceTarget([connection('b')], snapshots)).toBeUndefined();
});

it('moves chat focus to a connected server when the focused server fails', async () => {
  const driver = hookRuntime();
  const entries = ['a', 'b'].map((id) => ({ id, name: id, settings: { serverUrl: `http://${id}`, username: '', password: '', directory: '' }, projects: ['/repo'], preferences: {}, enabled: true }));
  const paths = { 'http://a:': ['/repo'], 'http://b:': ['/repo'] };
  const shell: any = { settings: entries[1].settings, onboardingVersion: 1, chatPreferences: {}, projectPathsByConnection: paths,
    projectPathsByConnectionRef: { current: paths }, setProjectPathsByConnection: vi.fn(), setSettings: vi.fn() };
  const writer = Object.assign(async () => {}, { preserveUnread: vi.fn() });
  const workspaceFocus = await loadTs('runtime/workspace/workspace-focus.ts');
  const { useWorkspaceConnections } = await loadTs('runtime/workspace/use-workspace-connections.ts', {
    react: driver.react,
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => 'stored', setItem: async () => {} } },
    '@/runtime/workspace/workspace-focus': workspaceFocus,
    "@/shared/contracts/connection-scope": { ...identity, getConnectionUiScope: (value: any) => value.serverUrl.slice(7) },
    "@/shared/storage/connection-profiles": { createProfileId: () => 'new', getProfilePassword: async () => '', loadConnectionProfiles: async () => [], mutateConnectionProfiles: vi.fn(), saveProfilePassword: vi.fn(), deleteProfilePassword: vi.fn() },
    "@/shared/contracts/connection-profiles": { findMatchingProfile: () => undefined, pickModelPreferences: () => ({}) },
    "@/shared/storage/connection-headers": { getProfileHeaders: async () => ({}), saveProfileHeaders: vi.fn(), deleteProfileHeaders: vi.fn() },
    "@/shared/protocol/opencode/client/types": { defaultConnectionSettings: { serverUrl: 'http://default', username: '' } },
    "@/shared/contracts/server-url": { getServerHostname: (value: string) => value },
    "@/shared/storage/persistence-hydration": { createPersistenceWriter: () => writer },
    "@/shared/network/shared-event-stream": { createSharedEventStream: () => () => {} },
    "@/shared/storage/workspace-storage": { WORKSPACES_STORAGE_KEY: 'workspaces', parseWorkspaces: () => ({ connections: entries, focus: { connectionId: 'b', projectPath: '/repo' } }), serializeWorkspaces: () => 'stored' },
    "@/shared/contracts/workspace": { workspaceKey: ({ connectionId, projectPath }: any) => JSON.stringify([connectionId, projectPath]) }
  }, driver.globals);
  driver.mount(({ shell }: any) => useWorkspaceConnections(shell, true), { shell });
  await driver.settle();
  const snapshot = (id: string, status: string) => ({ enabled: true, native: { settings: entries.find((entry) => entry.id === id)!.settings }, suspend: vi.fn(),
    values: { projectsValue: { activeProjectPath: '/repo' }, conversationValue: { conversation: { active: false }, toggleConversationMode: vi.fn(async () => {}) }, connectionValue: { connection: { status } } } });
  driver.value.publish('["a","/repo"]', snapshot('a', 'connected'));
  driver.value.publish('["b","/repo"]', snapshot('b', 'connected'));
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: 'b', projectPath: '/repo' });
  driver.value.publish('["b","/repo"]', snapshot('b', 'error'));
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: 'a', projectPath: '/repo' });
  driver.value.publish('["b","/repo"]', snapshot('b', 'connected'));
  driver.value.select({ connectionId: 'b', projectPath: '/repo' });
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: 'b', projectPath: '/repo' });
  await driver.value.disconnect('b');
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: 'a', projectPath: '/repo' });
  expect(driver.value.isEnabled('b')).toBe(false);
  driver.unmount();
});

it('flattens terminal catalogs once per server PTY and keeps the owning workspace actions', async () => {
  const { workspaceTerminals } = await loadTs('features/terminal/ui/use-workspace-terminals.ts', {
    react: {}
  });
  const connections = ['a', 'b'].map((id) => ({ id, name: id, settings: { serverUrl: `http://${id}` } }));
  const pty = { id: 'same', cwd: '/repo', title: 'Terminal' };
  const runtime = (path: string) => ({ values: { projectsValue: { activeProjectPath: path }, terminalValue: { terminals: [pty] } } });
  const owner = runtime('/repo'), unrelated = runtime('/other'), otherServer = runtime('/repo');
  const rows = workspaceTerminals(connections, { '["a","/repo"]': owner, '["a","/other"]': unrelated, '["b","/repo"]': otherServer });
  expect(rows).toHaveLength(2);
  expect(rows.map((row: any) => row.serverName)).toEqual(['a', 'b']);
  expect(rows[0].actions).toBe(owner.values.terminalValue);
  expect(rows[1].actions).toBe(otherServer.values.terminalValue);
});

it('clears focus and keeps the retained runtime when the last opened project closes', async () => {
  const driver = hookRuntime();
  const entries = [{ id: 'a', name: 'a', settings: { serverUrl: 'http://a', username: '', password: '', directory: '' }, projects: ['/repo'], preferences: {}, enabled: true }];
  const paths = { 'http://a:': ['/repo'] };
  const shell: any = { settings: entries[0].settings, onboardingVersion: 1, chatPreferences: {}, projectPathsByConnection: paths,
    projectPathsByConnectionRef: { current: paths }, setProjectPathsByConnection: vi.fn(), setSettings: vi.fn() };
  const writer = Object.assign(async () => {}, { preserveUnread: vi.fn() });
  const workspaceFocus = await loadTs('runtime/workspace/workspace-focus.ts');
  const { useWorkspaceConnections } = await loadTs('runtime/workspace/use-workspace-connections.ts', {
    react: driver.react,
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => 'stored', setItem: async () => {} } },
    '@/runtime/workspace/workspace-focus': workspaceFocus,
    "@/shared/contracts/connection-scope": { ...identity, getConnectionUiScope: (value: any) => value.serverUrl.slice(7) },
    "@/shared/storage/connection-profiles": { createProfileId: () => 'new', getProfilePassword: async () => '', loadConnectionProfiles: async () => [], mutateConnectionProfiles: vi.fn(), saveProfilePassword: vi.fn(), deleteProfilePassword: vi.fn() },
    "@/shared/contracts/connection-profiles": { findMatchingProfile: () => undefined, pickModelPreferences: () => ({}) },
    "@/shared/storage/connection-headers": { getProfileHeaders: async () => ({}), saveProfileHeaders: vi.fn(), deleteProfileHeaders: vi.fn() },
    "@/shared/protocol/opencode/client/types": { defaultConnectionSettings: { serverUrl: 'http://default', username: '' } },
    "@/shared/contracts/server-url": { getServerHostname: (value: string) => value },
    "@/shared/storage/persistence-hydration": { createPersistenceWriter: () => writer },
    "@/shared/network/shared-event-stream": { createSharedEventStream: () => () => {} },
    "@/shared/storage/workspace-storage": { WORKSPACES_STORAGE_KEY: 'workspaces', parseWorkspaces: () => ({ connections: entries, focus: { connectionId: 'a', projectPath: '/repo' } }), serializeWorkspaces: () => 'stored' },
    "@/shared/contracts/workspace": { workspaceKey: ({ connectionId, projectPath }: any) => JSON.stringify([connectionId, projectPath]) }
  }, driver.globals);
  driver.mount(({ shell }: any) => useWorkspaceConnections(shell, true), { shell });
  await driver.settle();
  const runtime = { enabled: true, native: { settings: entries[0].settings }, suspend: vi.fn(),
    values: { projectsValue: { activeProjectPath: '/repo' }, conversationValue: { conversation: { active: false }, toggleConversationMode: vi.fn(async () => {}) }, connectionValue: { connection: { status: 'connected' } } } };
  driver.value.publish('["a","/repo"]', runtime); driver.flush();
  await driver.value.closeProject({ connectionId: 'a', projectPath: '/repo' }); driver.flush();
  expect(driver.value.focus).toBeUndefined();
  expect(shell.projectPathsByConnectionRef.current['http://a:']).toEqual([]);
  expect(driver.value.snapshots['["a","/repo"]']).toBe(runtime);
  expect(runtime.suspend).not.toHaveBeenCalled();
  driver.unmount();
});

it('projects a closed project out of every project-scoped workspace domain', () => {
  const base: any = {
    projectsValue: { projects: [{ path: '/repo' }], activeProjectPath: '/repo', activeProject: { path: '/repo' }, isRefreshingProjectCatalog: true },
    projectFilesValue: {
      projectFileStatuses: [{ path: 'src/a.ts' }], projectFile: { selected: { path: 'src/a.ts' } },
      vcsInfo: { branch: 'main' }, worktrees: { entries: [{ directory: '/repo/wt' }], loading: true },
    },
    currentSessionValue: { currentSessionId: 's', activeSession: { id: 's' }, createSession: async () => ({ id: 'new' }), ensureActiveSession: async () => 's' },
    sessionLibraryValue: { sessions: [{ id: 's' }], sessionStatuses: { s: { type: 'idle' } }, sessionPreviewById: { s: 'preview' } },
    chatValue: {
      pendingPrompts: [{ id: 'p' }], currentMessages: [{ id: 'm' }], currentTranscript: [{ id: 'm' }],
      currentUsage: { total: 1 }, latestAssistantTurnUsage: { total: 1 }, currentDiffs: [{ file: 'a' }], diffTurns: [{ id: 'm' }],
      selectedDiffMessageId: 'm', currentTodos: [{ id: 't' }], currentPendingPermissions: [{ id: 'perm' }], currentPendingQuestions: [{ id: 'q' }],
      isRefreshingMessages: true, transcriptReadError: 'error', isRefreshingDiffs: true, isBootstrappingChat: true,
      transcriptPaging: { hasOlder: true, isLoadingOlder: true }, commands: [{ name: 'cmd' }], availableSkills: [{ name: 'skill' }],
      availableReferences: [{ name: 'ref' }], sendingState: { active: true, sessionId: 's' }, promptError: { message: 'failed' },
    },
    conversationValue: { conversation: { active: true, phase: 'listening', inputPhase: 'listening', readbackPhase: 'speaking', isListening: true, level: 0.8, statusLabel: 'Listening' } },
    terminalValue: { terminals: [{ id: 'pty' }], activeTerminalId: 'pty', terminalRuntime: { scope: 1, instances: [{ ptyId: 'pty' }] } },
  };
  const closed = projectClosedValues(base);
  expect(closed.projectsValue.projects).toEqual([]);
  expect(closed.projectsValue.activeProjectPath).toBeUndefined();
  expect(closed.projectFilesValue.projectFileStatuses).toEqual([]);
  expect(closed.projectFilesValue.projectFile.selected).toBeUndefined();
  expect(closed.projectFilesValue.vcsInfo).toBeUndefined();
  expect(closed.projectFilesValue.worktrees.entries).toEqual([]);
  expect(closed.currentSessionValue.currentSessionId).toBeUndefined();
  expect(closed.sessionLibraryValue.sessions).toEqual([]);
  expect(closed.sessionLibraryValue.sessionStatuses).toEqual({});
  expect(closed.chatValue.currentMessages).toEqual([]);
  expect(closed.chatValue.currentTranscript).toEqual([]);
  expect(closed.chatValue.currentPendingPermissions).toEqual([]);
  expect(closed.chatValue.currentPendingQuestions).toEqual([]);
  expect(closed.chatValue.transcriptPaging.hasOlder).toBe(false);
  expect(closed.chatValue.sendingState.active).toBe(false);
  expect(closed.conversationValue.conversation.active).toBe(false);
  expect(closed.terminalValue.terminals).toEqual([]);
  expect(closed.terminalValue.terminalRuntime.instances).toEqual([]);
});

it('reads the shared active-session catalog only for the owning runtime', async () => {
  const driver = hookRuntime();
  const listActiveSessions = vi.fn(async () => ({ sessions: [], statuses: {} }));
  const { useActiveSessions } = await loadTs('features/sessions/state/use-active-sessions.ts', {
    react: driver.react,
    "@/features/sessions/model/active-sessions": { getActiveSessions: () => [] },
    "@/features/sessions/model/session-utils": { areSessionListsEqual: () => true, areSessionStatusMapsEqual: () => true },
    "@/shared/protocol/services/session-service": { listActiveSessions }
  });
  driver.mount((props: any) => useActiveSessions(props), {
    catalogClient: {}, isCurrentCatalogClient: () => true, connectionScope: 'scope',
    connected: false, currentSessionId: undefined, hideSubagentChats: false, visible: false,
  });
  await driver.value.refreshActiveSessions();
  expect(listActiveSessions).not.toHaveBeenCalled();
  driver.update({ connected: true });
  await driver.value.refreshActiveSessions();
  driver.flush();
  expect(listActiveSessions).toHaveBeenCalledOnce();
  driver.unmount();
});
