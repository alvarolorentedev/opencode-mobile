import { z } from 'zod';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { loadTs, hookRuntime } from '../../tests/helpers/runtime.mjs';
import { createAppStore, type AppState } from '@/runtime/core/store';
import { CURRENT_ONBOARDING_VERSION } from '@/features/onboarding/runtime';
import type { createWorkspaceCommands as WorkspaceCommands } from '@/runtime/core/commands/workspace';
import type { createConnectionCommands as ConnectionCommands } from '@/runtime/core/commands/connection';
import { workspaceKey } from '@/shared/contracts/workspace';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';
import type { ConnectionState } from '@/features/connections/index';

const identity = { getConnectionScope: (value: any) => `${value.serverUrl}:${value.username}`, getConnectionUiScope: (value: any) => `${value.serverUrl}:${value.username}` };
const keys = { sessionKey: (value: any) => JSON.stringify([value.connectionId, value.projectPath, value.sessionId]) };

type TestConnections = Parameters<typeof WorkspaceCommands>[0]['connections'];
function mountWorkspaceConnections(driver: ReturnType<typeof hookRuntime>, useWorkspaceConnections: any, createWorkspaceCommands: typeof WorkspaceCommands, createConnectionCommands: typeof ConnectionCommands, shell: any,
  connections: TestConnections = { get: () => undefined, subscribeState: () => () => {} },
) {
  const store = createAppStore({ settings: shell.settings, chatPreferences: shell.chatPreferences, controlPlaneUrl: '' });
  store.getState().setShellValue('onboardingVersion', shell.onboardingVersion);
  const workspace = createWorkspaceCommands({ store, connections });
  const commands = { workspace, connection: createConnectionCommands({ store, connections, queryClient: new QueryClient() }, workspace) };
  const getRegistry = () => store.getState().registry;
  driver.mount(() => {
    const registry = driver.react.useSyncExternalStore(store.subscribe, getRegistry);
    return useWorkspaceConnections(true, { registry, commands, hiddenProjects: store.getState().shell.hiddenProjects });
  }, {});
  return store;
}
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
      projectsValue: { activeProjectPath: '/same' }, currentSessionValue: { currentSessionId: current },
      sessionLibraryValue: { sessions, sessionStatuses: {}, favoriteSessions: [], sessionPreviewById: {} },
    } });
    const rows = librarySessions([connection('a'), connection('b')], {
      '["a","/same"]': snapshot('a', [session('same', 3), session('idle', 1)], 'same'),
      '["b","/same"]': snapshot('b', [session('same', 9), session('busy', 2)]),
    }, new Map(['a', 'b'].map((id) => [id, { connection: { status: 'connected' } }])), { connectionId: 'a', projectPath: '/same' });
    expect(rows.map((row: any) => [row.connectionId, row.sessionId])).toEqual([['a', 'same'], ['b', 'busy'], ['b', 'same'], ['a', 'idle']]);
    expect(rows.filter((row: any) => row.current)).toHaveLength(1);
  });
  it('omits connections that are not connected, including their favorites', async () => {
    const { connectedConnections, librarySessions } = await loadTs('features/sessions/model/workspace-library.ts', {
    '@/shared/contracts/connection-scope': identity,
    "@/shared/contracts/workspace": keys,
    "@/runtime/workspace/workspace-types": keys
  });
    const connection = (id: string, enabled = true) => ({ id, name: id, enabled, settings: { serverUrl: `http://${id}`, username: '' } });
    const session = (id: string) => ({ id, directory: '/same', title: id, time: { updated: 1 } });
    const snapshot = (sessions: any[], favoriteSessions: any[] = []) => ({ catalogSessions: sessions, catalogStatuses: {}, values: {
      projectsValue: { activeProjectPath: '/same' }, currentSessionValue: { currentSessionId: undefined },
      sessionLibraryValue: { sessions, sessionStatuses: {}, favoriteSessions, sessionPreviewById: {} },
    } });
    const favorite = (connectionScope: string) => ({ connectionScope, projectPath: '/favorite', sessionId: 'f', title: 'f', favoritedAt: 1 });
    const connections = [connection('disabled', false), connection('connected'), connection('connecting'), connection('errored'), connection('idle')];
    const snapshots = {
      '["disabled","/same"]': snapshot([], [favorite('http://disabled:')]),
      '["connected","/same"]': snapshot([session('kept')], [favorite('http://connected:')]),
      '["connecting","/same"]': snapshot([session('connecting')]),
      '["errored","/same"]': snapshot([session('errored')]),
    };
    const lifecycles = new Map(Object.entries({ disabled: 'connected', connected: 'connected', connecting: 'connecting', errored: 'error' })
      .map(([id, status]) => [id, { connection: { status } }]));
    expect(connectedConnections(connections, lifecycles).map((entry: any) => entry.id)).toEqual(['connected']);
    expect(librarySessions(connections, snapshots, lifecycles).map((row: any) => [row.connectionId, row.sessionId]).sort())
      .toEqual([['connected', 'f'], ['connected', 'kept']]);
  });
  it('keeps unrelated workspace domains stable when only chat data changes', async () => {
    const driver = hookRuntime();
    let current: Record<string, unknown>;
    const settings = { serverUrl: 'http://a', username: '', password: '', directory: '' };
    const store = createAppStore({ settings, chatPreferences: {} as never, controlPlaneUrl: '' });
    store.getState().setRegistry({ ready: true });
    store.getState().setShellValue('onboardingVersion', CURRENT_ONBOARDING_VERSION);
    const commands = {
      connection: { retry: vi.fn(), openSession: vi.fn(), openSessionInProject: vi.fn() },
      workspace: { activate: vi.fn() },
    };
    const connectionControls = { connectionProfiles: [], connectSetup: {}, services: {} };
    const lifecycle = { connection: { status: 'connected' }, contract: 'v2' };
    const { useConnection, useProjects, useCurrentSession, useSessionLibrary, useOnboarding, useChat } = await loadTs([
      'features/connections/context.ts', 'features/projects/context.ts', 'features/sessions/context.ts',
      'features/onboarding/context.ts', 'features/chat/context.ts',
    ], {
      react: driver.react,
      zod: { z },
      '@/runtime/core': {
        useWorkspaceDomainValue: (select: (values: Record<string, unknown>) => unknown) => select(current),
        useAppStore: (select: (state: AppState) => unknown) => select(store.getState()),
        useAppCore: () => ({ commands, store }),
        useActiveWorkspaceTarget: () => ({ connectionId: 'http://a:', projectPath: '/repo' }),
        useConnectionLifecycle: () => lifecycle,
        useWorkspaceConnectionSettings: () => settings,
      },
      '@/runtime/workspace': { useWorkspaces: () => ({ connectionControls }) },
      '@/shared/protocol/opencode/capabilities': { getServerCapabilities: () => ({ contract: 'v2' }) },
      '@/shared/contracts/connection-scope': identity,
      './state/use-server-pending-interactions': {},
      './state/use-permission-rules-state': {},
      '@/shared/server-data/diagnostics': {},
      './state/use-workspace-diagnostics': {},
    });
    const base = {
      projectsValue: { activeProjectPath: '/repo', projects: [], selectProject: () => {} },
      currentSessionValue: { currentSessionId: 's', openDeepLinkSession: async () => ({ ok: true }) },
      sessionLibraryValue: { openSessionInProject: async () => {} },
      chatValue: { currentMessages: [] },
    };
    driver.mount(({ values }: { values: Record<string, unknown> }) => {
      current = values;
      return {
        connectionValue: useConnection(), projectsValue: useProjects(), currentSessionValue: useCurrentSession(),
        sessionLibraryValue: useSessionLibrary(), onboardingValue: useOnboarding(), chatValue: useChat(),
      };
    }, { values: base });
    const first = driver.value;

    driver.update({ values: { ...base, chatValue: { currentMessages: ['new'] } } });
    const next = driver.value;
    expect(next.chatValue).not.toBe(first.chatValue);
    expect(next.onboardingValue).toBe(first.onboardingValue);
    expect(next.connectionValue).toBe(first.connectionValue);
    expect(next.projectsValue).toBe(first.projectsValue);
    expect(next.currentSessionValue).toBe(first.currentSessionValue);
    expect(next.sessionLibraryValue).toBe(first.sessionLibraryValue);

    first.onboardingValue.startOnboardingReview();
    driver.update({ values: base });
    expect(driver.value.onboardingValue).not.toBe(first.onboardingValue);
    expect(driver.value.onboardingValue.onboardingActive).toBe(true);
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
    "@/shared/preferences/opencode-preferences": { normalizeTranscriptFontSize: (value: number) => value, OPENING_SCREENS: ['chat', 'mission'] }
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
    expect(parsing.parseChatPreferences('{"openingScreen":"mission"}').openingScreen).toBe('mission');
    expect(parsing.parseChatPreferences('{"openingScreen":"unsupported"}').openingScreen).toBeUndefined();

    // Routing preferences must survive a workspace registry round-trip; a stale
    // or dropped value here is what makes an enabled setting look reset on launch.
    const autoModel = { enabled: true, classifier: 'server', classifierModelId: 'openai/nano', tiers: { simple: 'openai/nano', standard: 'auto', complex: 'openai/deep' }, tierVariants: { simple: null, standard: null, complex: 'high' }, protectLongChats: false };
    const withRouting = { ...entry, preferences: { autoModel } };
    const routingRoundTrip = parseWorkspaces(serializeWorkspaces([withRouting], { connectionId: entry.id, projectPath: '/same' }));
    expect(routingRoundTrip.connections[0].preferences.autoModel).toEqual(autoModel);
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
  const client = { __opencode: { contract: 'v2', directory: '/repo' } } as ScopedOpencodeClient;
  const pendingInteractionsKey = (identity: QueryIdentity, client: ScopedOpencodeClient) =>
    projectQueryKey(identity, client, 'pending-interactions');
  const approvals = await loadTs('features/sessions/services/approvals.ts', { './queries': { pendingInteractionsKey } });
  const { createAutoApproval } = await loadTs('runtime/core/commands/auto-approval.ts', {
    '@/features/sessions/runtime': approvals, '@/shared/contracts/workspace': { workspaceKey },
  }, { queueMicrotask });
  const a = vi.fn(async () => {}), b = vi.fn(async () => {});
  const settings = { serverUrl: 'https://example.test', username: '', password: '', directory: '' };
  const store = createAppStore({ settings, chatPreferences: defaultChatPreferences, controlPlaneUrl: '' });
  const connections = [
    { id: 'a', name: 'A', enabled: true, preferences: { autoApprove: true }, settings, projects: ['/repo'] },
    { id: 'b', name: 'B', enabled: true, preferences: { autoApprove: false }, settings, projects: ['/repo'] },
  ];
  const identityFor = (id: string, authRevision = 0) => ({ connectionId: id, connectionScope: id, authRevision });
  const queryClient = new QueryClient();
  const write = (id: string, requestId: string, authRevision = 0) => queryClient.setQueryData(
    pendingInteractionsKey(identityFor(id, authRevision), client),
    { permissions: { session: [{ id: requestId }] }, questions: {} },
  );
  const stop = createAutoApproval({
    store, queryClient, connections: {
      get: (id: string) => ({
        getProjectAccess: () => ({ identity: identityFor(id), client, isCurrent: () => true }),
      }),
      subscribeState: () => () => {},
    },
  }, ({ connectionId }: { connectionId: string }) => ({ replyToPermission: connectionId === 'a' ? a : b })).start();
  try {
    store.getState().setRegistry({ connections });
    write('a', 'same-request');
    write('b', 'same-request');
    write('a', 'wrong-generation', 1);
    await Promise.resolve();
    expect(a).toHaveBeenCalledWith('same-request', 'once'); expect(b).not.toHaveBeenCalled();
    store.getState().setRegistry({ connections: connections.map((entry) => ({ ...entry, preferences: { autoApprove: true } })) });
    await Promise.resolve();
    expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledWith('same-request', 'once');
    write('b', 'same-request');
    await Promise.resolve();
    expect(b).toHaveBeenCalledOnce();
  } finally {
    stop();
    queryClient.clear();
  }
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

it('keeps lifecycle decisions current without resetting retained runtimes', async () => {
  const driver = hookRuntime();
  const findSessionForNavigation = vi.fn();
  const mutateConnectionProfiles = vi.fn();
  const certificate = { fingerprint: 'saved-ca' };
  const oidc = { issuer: 'https://issuer.test', clientId: 'mobile' };
  const readProfileConnection = vi.fn(async (profile) => ({ ...profile, directory: '', certificate, oidc, password: 'saved-password' }));
  const entries = ['a', 'b'].map((id) => ({ id, name: id, settings: { serverUrl: `http://${id}`, username: '', password: '', directory: '' }, projects: ['/repo', '/other'], preferences: {}, enabled: true }));
  const paths = { 'http://a:': ['/repo', '/other'], 'http://b:': ['/repo'] };
  const shell: any = { settings: entries[0].settings, onboardingVersion: 1, chatPreferences: {}, projectPathsByConnection: paths,
    projectPathsByConnectionRef: { current: paths }, setProjectPathsByConnection: vi.fn(), setSettings: vi.fn() };
  const writer = Object.assign(async () => {}, { preserveUnread: vi.fn() });
  const workspaceFocus = await loadTs('runtime/workspace/workspace-focus.ts');
  const { useWorkspaceConnections, createWorkspaceCommands, createConnectionCommands } = await loadTs(['runtime/workspace/use-workspace-connections.ts', 'runtime/core/commands/workspace.ts', 'runtime/core/commands/connection.ts'], {
    react: driver.react,
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => 'stored', setItem: async () => {} } },
    '@/runtime/workspace/workspace-focus': workspaceFocus,
    "@/shared/contracts/connection-scope": { ...identity, getConnectionUiScope: (value: any) => value.serverUrl.slice(7) },
    "@/shared/storage/connection-profiles": { createProfileId: () => 'new', getProfilePassword: async () => '', loadConnectionProfiles: async () => [], mutateConnectionProfiles, readProfileConnection, saveProfilePassword: vi.fn(), deleteProfilePassword: vi.fn() },
    "@/shared/contracts/connection-profiles": { findMatchingProfile: () => undefined, pickModelPreferences: () => ({}) },
    "@/shared/storage/connection-headers": { getProfileHeaders: async () => ({}), saveProfileHeaders: vi.fn(), deleteProfileHeaders: vi.fn() },
    "@/shared/protocol/opencode/client/types": { defaultConnectionSettings: { serverUrl: 'http://default', username: '' } },
    "@/shared/contracts/server-url": { getServerHostname: (value: string) => value },
    "@/shared/storage/persistence-hydration": { createPersistenceWriter: () => writer },
    "@/shared/network/shared-event-stream": { createSharedEventStream: () => () => {} },
    "@/shared/protocol/services/session-service": { findSessionForNavigation },
    "@/shared/storage/workspace-storage": { WORKSPACES_STORAGE_KEY: 'workspaces', parseWorkspaces: () => ({ connections: entries, focus: { connectionId: 'a', projectPath: '/repo' } }), serializeWorkspaces: () => 'stored' },
    "@/shared/contracts/workspace": { workspaceKey: ({ connectionId, projectPath }: any) => JSON.stringify([connectionId, projectPath]) }
  }, driver.globals);
  const connected = { status: 'connected', message: 'Connected' };
  const manager = { getState: () => ({ connection: connected }), connect: async () => connected } as unknown as NonNullable<ReturnType<TestConnections['get']>>;
  mountWorkspaceConnections(driver, useWorkspaceConnections, createWorkspaceCommands, createConnectionCommands, shell,
    { get: () => manager, subscribeState: () => () => {} });
  const isEnabled = driver.value.isEnabled;
  await driver.settle();
  expect(isEnabled('a')).toBe(true);
  const snapshot = (id: string, path: string) => ({ enabled: true, native: { settings: driver.value.connections.find((entry: any) => entry.id === id).settings },
    loadProjectCatalog: vi.fn(async () => ({ currentProjectPath: '/repo', serverProjects: [] })),
    catalogSessions: [], suspend: vi.fn(), values: { sessionLibraryValue: { sessions: [], refreshSessions: vi.fn(async () => []) }, currentSessionValue: { openSession: vi.fn(async () => {}), openDeepLinkSession: vi.fn(async () => ({ ok: true })) }, projectsValue: { activeProjectPath: path }, conversationValue: { conversation: { active: true }, toggleConversationMode: vi.fn(async () => {}) } } });
  const original = snapshot('a', '/repo'), other = snapshot('a', '/other'), b = snapshot('b', '/repo');
  driver.value.publish('["a","/repo"]', original); driver.value.publish('["a","/other"]', other); driver.value.publish('["b","/repo"]', b); driver.flush();
  original.catalogSessions = [{ id: 'collision', directory: '/repo' }] as never[];
  await expect(driver.value.navigate({ connectionId: 'b', projectPath: '/repo', sessionId: 'collision' })).rejects.toThrow('was not found');
  expect(b.values.currentSessionValue.openSession).not.toHaveBeenCalled();
  findSessionForNavigation.mockResolvedValueOnce({ id: 'outside-catalog', directory: '/repo', time: {} });
  await driver.value.navigate({ connectionId: 'b', projectPath: '/repo', sessionId: 'outside-catalog' });
  expect(b.values.currentSessionValue.openSession).toHaveBeenCalledWith('outside-catalog');
  b.catalogSessions = [{ id: 'collision', directory: '/repo' }] as never[];
  await driver.value.navigate({ connectionId: 'b', projectPath: '/repo', sessionId: 'collision' }); driver.flush();
  expect(b.values.currentSessionValue.openSession).toHaveBeenCalledWith('collision');
  driver.value.select({ connectionId: 'a', projectPath: '/repo' }); driver.flush();
  await driver.value.openExternalSession({ connectionId: 'b', projectPath: '/repo', sessionId: 'collision' });
  expect(b.values.currentSessionValue.openDeepLinkSession).toHaveBeenCalledWith({ sessionId: 'collision', projectPath: '/repo' }, expect.any(AbortSignal));
  expect(original.values.currentSessionValue.openDeepLinkSession).not.toHaveBeenCalled();
  const unscoped = snapshot('b', '');
  driver.value.forget('["b","/repo"]');
  driver.value.publish('["b",""]', unscoped); driver.flush();
  const opening = driver.value.openExternalSession({ connectionId: 'b', projectPath: '', sessionId: 'default-project' });
  await driver.settle();
  expect(unscoped.loadProjectCatalog).toHaveBeenCalledWith(true);
  expect(unscoped.values.currentSessionValue.openDeepLinkSession).not.toHaveBeenCalled();
  expect(driver.value.connections.find((entry: any) => entry.id === 'b').projects).toEqual(['']);
  driver.value.publish('["b",""]', b); driver.flush();
  await opening;
  expect(b.values.currentSessionValue.openDeepLinkSession).toHaveBeenCalledWith({ sessionId: 'default-project', projectPath: undefined }, expect.any(AbortSignal));
  await driver.value.disconnect('a'); driver.flush();
  expect(isEnabled('a')).toBe(false); expect(isEnabled('b')).toBe(true);
  expect(original.suspend).toHaveBeenCalledOnce(); expect(other.suspend).toHaveBeenCalledOnce(); expect(b.suspend).not.toHaveBeenCalled();
  const profile = { id: 'saved', name: 'Saved', serverUrl: 'http://c', username: 'carol' };
  const activating = driver.value.connectSavedProfile(profile);
  await driver.settle();
  const c = snapshot('c', '');
  driver.value.publish('["c",""]', c);
  await activating;
  expect(c.native.settings).toMatchObject({ certificate, oidc, password: 'saved-password' });
  expect(mutateConnectionProfiles).not.toHaveBeenCalled();
  driver.unmount();
});

it('persists the focused auto-model choice and ignores background workspace copies', async () => {
  const driver = hookRuntime();
  const entries = ['a', 'b'].map((id) => ({ id, name: id, settings: { serverUrl: `http://${id}`, username: '', password: '', directory: '' }, projects: ['/repo'], enabled: true, preferences: {} }));
  const paths = { 'http://a:': ['/repo'], 'http://b:': ['/repo'] };
  const chatPreferences: any = { autoModel: { enabled: false, classifier: 'server', tiers: { simple: 'auto', standard: 'auto', complex: 'auto' }, protectLongChats: true } };
  const shell: any = {
    settings: entries[0].settings,
    onboardingVersion: 1,
    chatPreferences,
    projectPathsByConnection: paths,
    projectPathsByConnectionRef: { current: paths },
    setProjectPathsByConnection: vi.fn(),
    setSettings: vi.fn(),
  };
  const writer = Object.assign(async () => {}, { preserveUnread: vi.fn() });
  const workspaceFocus = await loadTs('runtime/workspace/workspace-focus.ts');
  const { useWorkspaceConnections, createWorkspaceCommands, createConnectionCommands } = await loadTs(['runtime/workspace/use-workspace-connections.ts', 'runtime/core/commands/workspace.ts', 'runtime/core/commands/connection.ts'], {
    react: driver.react,
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => 'stored', setItem: async () => {} } },
    '@/runtime/workspace/workspace-focus': workspaceFocus,
    "@/shared/contracts/connection-scope": { ...identity, getConnectionUiScope: (value: any) => value.serverUrl.slice(7) },
    "@/shared/storage/connection-profiles": { createProfileId: () => 'new', getProfilePassword: async () => '', loadConnectionProfiles: async () => [], mutateConnectionProfiles: vi.fn(async () => {}), saveProfilePassword: vi.fn(), deleteProfilePassword: vi.fn() },
    "@/shared/contracts/connection-profiles": { findMatchingProfile: () => undefined, pickModelPreferences: () => ({}) },
    "@/shared/storage/connection-headers": { getProfileHeaders: async () => ({}), saveProfileHeaders: vi.fn(), deleteProfileHeaders: vi.fn() },
    "@/shared/protocol/opencode/client/types": { defaultConnectionSettings: { serverUrl: 'http://default', username: '' } },
    "@/shared/contracts/server-url": { getServerHostname: (value: string) => value },
    "@/shared/storage/persistence-hydration": { createPersistenceWriter: () => writer },
    "@/shared/network/shared-event-stream": { createSharedEventStream: () => () => {} },
    "@/shared/protocol/services/session-service": { findSessionForNavigation: vi.fn() },
    "@/shared/storage/workspace-storage": { WORKSPACES_STORAGE_KEY: 'workspaces', parseWorkspaces: () => ({ connections: entries, focus: { connectionId: 'a', projectPath: '/repo' } }), serializeWorkspaces: () => 'stored' },
    "@/shared/contracts/workspace": { workspaceKey: ({ connectionId, projectPath }: any) => JSON.stringify([connectionId, projectPath]) }
  }, driver.globals);
  const store = mountWorkspaceConnections(driver, useWorkspaceConnections, createWorkspaceCommands, createConnectionCommands, shell);
  await driver.settle();

  const enabled = { ...chatPreferences, autoModel: { ...chatPreferences.autoModel, enabled: true } };
  driver.value.updatePreferences('a', enabled);
  driver.flush();
  expect(driver.value.connections.find((entry: any) => entry.id === 'a').preferences.autoModel.enabled).toBe(true);
  expect(store.getState().shell.chatPreferences.autoModel.enabled).toBe(true);

  // A background workspace applying its own stale preferences must not turn the
  // focused connection's routing off in the shell or the global persistence key.
  const background = { ...enabled, autoModel: { ...enabled.autoModel, enabled: false, classifier: 'local' } };
  driver.value.updatePreferences('b', background);
  driver.flush();
  expect(driver.value.connections.find((entry: any) => entry.id === 'b').preferences.autoModel.enabled).toBe(false);
  expect(store.getState().shell.chatPreferences.autoModel.enabled).toBe(true);
  expect(store.getState().shell.chatPreferences.autoModel.classifier).toBe('server');
  driver.unmount();
});

it('selects a connected fallback for failover and prefers the last healthy server', async () => {
  const { connectedWorkspaceTarget } = await loadTs('runtime/workspace/workspace-focus.ts');
  const connection = (id: string, enabled = true) => ({ id, enabled, projects: ['/repo'] });
  const readConnection = (id: string) => ({ status: id === 'b' ? 'connecting' : 'connected' });
  const selection = { '["c","/repo"]': { activeProjectPath: '/c' } };
  expect(connectedWorkspaceTarget([connection('a', false), connection('b'), connection('c'), connection('d')], selection, readConnection))
    .toEqual({ connectionId: 'c', projectPath: '/c' });
  expect(connectedWorkspaceTarget([connection('a'), connection('b'), connection('c'), connection('d')], selection, readConnection, { preferredConnectionId: 'd' }))
    .toEqual({ connectionId: 'd', projectPath: '/repo' });
  expect(connectedWorkspaceTarget([connection('a', false), connection('b'), connection('c'), connection('d')], selection, readConnection, { excludedConnectionId: 'c' }))
    .toEqual({ connectionId: 'd', projectPath: '/repo' });
  expect(connectedWorkspaceTarget([connection('b')], selection, readConnection)).toBeUndefined();
});

it('moves chat focus to a connected server when the focused server fails', async () => {
  const driver = hookRuntime();
  const entries = ['a', 'b'].map((id) => ({ id, name: id, settings: { serverUrl: `http://${id}`, username: '', password: '', directory: '' }, projects: ['/repo'], preferences: {}, enabled: true }));
  const paths = { 'http://a:': ['/repo'], 'http://b:': ['/repo'] };
  const shell: any = { settings: entries[1].settings, onboardingVersion: 1, chatPreferences: {}, projectPathsByConnection: paths,
    projectPathsByConnectionRef: { current: paths }, setProjectPathsByConnection: vi.fn(), setSettings: vi.fn() };
  const writer = Object.assign(async () => {}, { preserveUnread: vi.fn() });
  const workspaceFocus = await loadTs('runtime/workspace/workspace-focus.ts');
  const { useWorkspaceConnections, createWorkspaceCommands, createConnectionCommands } = await loadTs(['runtime/workspace/use-workspace-connections.ts', 'runtime/core/commands/workspace.ts', 'runtime/core/commands/connection.ts'], {
    react: driver.react,
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => 'stored', setItem: async () => {} } },
    '@/runtime/workspace/workspace-focus': workspaceFocus,
    "@/shared/contracts/connection-scope": { ...identity, getConnectionUiScope: (value: any) => value.serverUrl.slice(7) },
    "@/shared/storage/connection-profiles": { createProfileId: () => 'new', getProfilePassword: async () => '', loadConnectionProfiles: async () => [], mutateConnectionProfiles: vi.fn(async () => {}), saveProfilePassword: vi.fn(), deleteProfilePassword: vi.fn() },
    "@/shared/contracts/connection-profiles": { findMatchingProfile: () => undefined, pickModelPreferences: () => ({}) },
    "@/shared/storage/connection-headers": { getProfileHeaders: async () => ({}), saveProfileHeaders: vi.fn(), deleteProfileHeaders: vi.fn() },
    "@/shared/protocol/opencode/client/types": { defaultConnectionSettings: { serverUrl: 'http://default', username: '' } },
    "@/shared/contracts/server-url": { getServerHostname: (value: string) => value },
    "@/shared/storage/persistence-hydration": { createPersistenceWriter: () => writer },
    "@/shared/network/shared-event-stream": { createSharedEventStream: () => () => {} },
    "@/shared/storage/workspace-storage": { WORKSPACES_STORAGE_KEY: 'workspaces', parseWorkspaces: () => ({ connections: entries, focus: { connectionId: 'b', projectPath: '/repo' } }), serializeWorkspaces: () => 'stored' },
    "@/shared/contracts/workspace": { workspaceKey: ({ connectionId, projectPath }: any) => JSON.stringify([connectionId, projectPath]) }
  }, driver.globals);
  const statuses = new Map<string, ConnectionState['status']>([['a', 'connected'], ['b', 'connected']]);
  const listeners = new Set<() => void>();
  const connections: TestConnections = {
    get: (id) => ({ getState: () => ({ connection: { status: statuses.get(id) } }) }) as unknown as NonNullable<ReturnType<TestConnections['get']>>,
    subscribeState(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  function setStatus(id: string, status: ConnectionState['status']) {
    statuses.set(id, status);
    for (const listener of listeners) listener();
  }
  const store = mountWorkspaceConnections(driver, useWorkspaceConnections, createWorkspaceCommands, createConnectionCommands, shell, connections);
  await driver.settle();
  store.getState().setSelection('["a",""]', { activeProjectPath: '/repo' });
  const snapshot = (id: string) => ({ enabled: true, native: { settings: entries.find((entry) => entry.id === id)!.settings }, suspend: vi.fn(),
    values: { projectsValue: { activeProjectPath: '/repo' }, conversationValue: { conversation: { active: false }, toggleConversationMode: vi.fn(async () => {}) } } });
  driver.value.publish('["a","/repo"]', snapshot('a'));
  driver.value.publish('["b",""]', snapshot('b'));
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: 'b', projectPath: '' });
  setStatus('b', 'error');
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: 'a', projectPath: '/repo' });
  setStatus('b', 'connected');
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
  const { workspaceTerminals } = await loadTs('features/terminal/model/workspace-terminals.ts');
  const connections = ['a', 'b'].map((id) => ({ id, name: id, enabled: true, settings: { serverUrl: `http://${id}` } }));
  const pty = { id: 'same', cwd: '/repo', title: 'Terminal' };
  const scope = (connectionId: string, projectPath: string) => ({
    key: workspaceKey({ connectionId, projectPath }), connectionId, projectPath, terminals: [pty],
    actions: { openTerminal: vi.fn(), closeTerminal: vi.fn() },
  });
  const owner = scope('a', '/repo'), unrelated = scope('a', '/other'), otherServer = scope('b', '/repo');
  const rows = workspaceTerminals(connections, [owner, unrelated, otherServer]);
  expect(rows).toHaveLength(2);
  expect(rows.map((row: any) => row.serverName)).toEqual(['a', 'b']);
  expect(rows[0].actions).toBe(owner.actions);
  expect(rows[1].actions).toBe(otherServer.actions);
});

it('reads the shared active-session catalog only for the owning runtime', async () => {
  const driver = hookRuntime();
  const listSessions = vi.fn(async () => ({ sessions: [], statuses: {} }));
  const { useActiveSessions } = await loadTs('features/sessions/state/use-active-sessions.ts', {
    react: driver.react,
    "@/features/sessions/model/active-sessions": { getActiveSessions: () => [] },
    "@/features/sessions/model/session-utils": { areSessionListsEqual: () => true, areSessionStatusMapsEqual: () => true },
    "@/shared/protocol/opencode/client": { withReadSignal: (client: object) => client },
    "@/shared/protocol/services/session-service": { listSessions }
  });
  driver.mount((props: any) => useActiveSessions(props), {
    identity: { connectionId: 'test', connectionScope: 'scope', authRevision: 0 },
    catalogClient: { __opencode: { contract: 'v2', directory: '' } },
    connected: false, currentSessionId: undefined, hideSubagentChats: false, visible: false,
  });
  await driver.value.refreshActiveSessions();
  expect(listSessions).not.toHaveBeenCalled();
  driver.update({ connected: true });
  await driver.value.refreshActiveSessions();
  driver.flush();
  expect(listSessions).toHaveBeenCalled();
  driver.unmount();
});
