// @vitest-environment happy-dom

import '../../tests/helpers/native-view-hosts';
import '../../tests/helpers/native-animation';
import { cloudLinkPlatform } from '../../tests/helpers/cloud-link-platform';
import { act, createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChat, useChatBootstrap } from '@/features/chat/context';
import { useConnection } from '@/features/connections/context';
import { useOnboarding } from '@/features/onboarding/context';
import { CURRENT_ONBOARDING_VERSION } from '@/features/onboarding/runtime';
import { useProjects } from '@/features/projects/context';
import { useCurrentSession, useSessionLibrary } from '@/features/sessions/context';
import { connectedConnections, librarySessions } from '@/features/sessions/model/workspace-library';
import { pendingInteractionsKey, projectSessionsKey, sessionCatalogKey } from '@/features/sessions/services/queries';
import { useActiveSessions } from '@/features/sessions/state/use-active-sessions';
import { workspaceTerminals } from '@/features/terminal/model/workspace-terminals';
import { AppCoreProvider, useAppStore, type AppCore } from '@/runtime/core';
import { createAutoApproval } from '@/runtime/core/commands/auto-approval';
import { createConnectionCommands } from '@/runtime/core/commands/connection';
import { createWorkspaceCommands } from '@/runtime/core/commands/workspace';
import { createAppStore, type AppState } from '@/runtime/core/store';
import { clearWorkspacePresentation, hasWorkspaceDrafts } from '@/runtime/presentation/workspace-presentation';
import { createRealtime, type RealtimeScopeInput } from '@/runtime/realtime/create-realtime';
import { useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import { WorkspaceContext, type WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import { connectedWorkspaceTarget } from '@/runtime/workspace/workspace-focus';
import type { ConnectionState } from '@/features/connections/index';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { workspaceKey } from '@/shared/contracts/workspace';
import { createSharedEventStream } from '@/shared/network/shared-event-stream';
import { SSE_STALENESS_MS, WATCHDOG_TICK_MS } from '@/shared/network/realtime-timing';
import { defaultChatPreferences, type ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { saveProfileCertificate } from '@/shared/storage/connection-certificates';
import { saveProfilePassword } from '@/shared/storage/connection-profiles';
import { CONNECTION_PROFILES_STORAGE_KEY } from '@/shared/storage/keys';
import { parseChatPreferences } from '@/shared/storage/persisted-preferences';
import { parseWorkspaces, serializeWorkspaces, WORKSPACES_STORAGE_KEY } from '@/shared/storage/workspace-storage';

import { settleReact } from '../../tests/helpers/controlled-clock';
import { renderHook } from '../../tests/helpers/render-hook';

vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-clipboard', () => ({}));
beforeEach(() => { cloudLinkPlatform.preferences.clear(); cloudLinkPlatform.secrets.clear(); });
afterEach(() => { vi.useRealTimers(); });

type TestConnections = Parameters<typeof createWorkspaceCommands>[0]['connections'];
type TestSessionCommands = Parameters<typeof createWorkspaceCommands>[1];
const quietForeground = { isActive: () => false, subscribe: () => () => {} };
const quietSubscription = () => () => {};
const settingsFor = (id: string) => ({ serverUrl: `http://${id}`, username: '', password: '', directory: '' });
const aConnection = getConnectionUiScope(settingsFor('a'));
const bConnection = getConnectionUiScope(settingsFor('b'));
const cConnection = getConnectionUiScope({ ...settingsFor('c'), username: 'carol' });
const catalogIdentity = (connectionId: string) => ({ connectionId, connectionScope: connectionId, authRevision: 0 });
const catalogKey = (id: string) => sessionCatalogKey(catalogIdentity(id), 'v2');

function workspaceEntry(address: string, preferences: ConnectionRecord['preferences'] = {}): ConnectionRecord {
  const settings = settingsFor(address);
  return { id: getConnectionUiScope(settings), name: address, enabled: true, settings, projects: ['/repo'], preferences };
}

function projectSources(key: string, directory: string) {
  const loadProjectCatalog = vi.fn(async () => ({ currentProjectPath: '/repo', serverProjects: [] }));
  const suspend = vi.fn();
  return {
    workspaceKey: key, projectPath: directory || undefined, binding: { suspend },
    catalog: { isCurrent: () => true, actions: { loadProjectCatalog } },
  } as unknown as RealtimeScopeInput & {
    binding: { suspend: typeof suspend };
    catalog: { actions: { loadProjectCatalog: typeof loadProjectCatalog } };
  };
}
const unexpectedSessionCommand = () => { throw new Error('Unexpected session command'); };
function mountWorkspaceConnections(entries: ConnectionRecord[], focusId: string, chatPreferences = defaultChatPreferences,
  connections: TestConnections = { get: () => undefined, subscribeState: quietSubscription, subscribeProjects: quietSubscription },
  queryClient = new QueryClient(),
  session: TestSessionCommands = { navigation: unexpectedSessionCommand, creation: unexpectedSessionCommand },
  pauseVoice = vi.fn(async (_id?: string) => {}),
) {
  const store = createAppStore({ settings: entries[0].settings, chatPreferences, controlPlaneUrl: '' });
  store.getState().setShellValue('onboardingVersion', CURRENT_ONBOARDING_VERSION);
  cloudLinkPlatform.preferences.set(WORKSPACES_STORAGE_KEY, serializeWorkspaces(entries, { connectionId: focusId, projectPath: '/repo' }));
  const workspace = createWorkspaceCommands({ store, connections, queryClient }, session, pauseVoice);
  const commands = { workspace, connection: createConnectionCommands({ store, connections, queryClient }, workspace) };
  function Core({ children }: PropsWithChildren) {
    return createElement(AppCoreProvider, { core: { store } as AppCore }, children);
  }
  const driver = renderHook(() => {
    const registry = useAppStore((state) => state.registry);
    const hiddenProjects = useAppStore((state) => state.shell.hiddenProjects);
    return useWorkspaceConnections(true, { registry, commands, hiddenProjects });
  }, undefined, Core);
  return { store, get value() { return driver.result.current; }, settle: settleReact, unmount: driver.unmount };
}
describe('multi-server contracts', () => {
  it('keeps colliding session identities separate and interleaves by current/running/recency', async () => {
    const connection = (id: string): ConnectionRecord => ({ ...workspaceEntry(id), id });
    const session = (id: string, updated: number) => ({ id, directory: '/same', title: id, time: { created: 0, updated } }) as import('@/shared/protocol/opencode/types').Session;
    const rows = librarySessions([connection('a'), connection('b')], [
      { connectionId: 'a', projectPath: '/same', currentSessionId: 'same', sessions: [session('same', 3)] },
      { connectionId: 'b', projectPath: '/same', sessions: [session('same', 9)] },
    ], new Map(['a', 'b'].map((id) => [id, { connection: { status: 'connected' } }])), {
      a: { sessions: [session('idle', 1)], statuses: {} },
      b: { sessions: [session('busy', 2)], statuses: { busy: { type: 'busy' } } },
    }, [], { connectionId: 'a', projectPath: '/same' });
    expect(rows.map((row: any) => [row.connectionId, row.sessionId])).toEqual([['a', 'same'], ['b', 'busy'], ['b', 'same'], ['a', 'idle']]);
    expect(rows.filter((row: any) => row.current)).toHaveLength(1);
  });
  it('omits connections that are not connected, including their favorites', async () => {
    const connection = (id: string, enabled = true): ConnectionRecord => ({ ...workspaceEntry(id), id, enabled });
    const session = (id: string) => ({ id, directory: '/same', title: id, time: { created: 0, updated: 1 } }) as import('@/shared/protocol/opencode/types').Session;
    const favorite = (connectionScope: string) => ({ connectionScope, projectPath: '/favorite', sessionId: 'f', title: 'f', favoritedAt: 1 });
    const connections = [connection('disabled', false), connection('connected'), connection('connecting'), connection('errored'), connection('idle')];
    const projectSessions = [
      { connectionId: 'disabled', projectPath: '/same', sessions: [] },
      { connectionId: 'connected', projectPath: '/same', sessions: [session('kept')] },
      { connectionId: 'connecting', projectPath: '/same', sessions: [session('connecting')] },
      { connectionId: 'errored', projectPath: '/same', sessions: [session('errored')] },
    ];
    const lifecycles = new Map(Object.entries({ disabled: 'connected', connected: 'connected', connecting: 'connecting', errored: 'error' })
      .map(([id, status]) => [id, { connection: { status } }]));
    expect(connectedConnections(connections, lifecycles).map((entry: any) => entry.id)).toEqual(['connected']);
    expect(librarySessions(connections, projectSessions, lifecycles, {}, [favorite(getConnectionScope(settingsFor('disabled'))), favorite(getConnectionScope(settingsFor('connected')))])
      .map((row: any) => [row.connectionId, row.sessionId]).sort())
      .toEqual([['connected', 'f'], ['connected', 'kept']]);
  });
  it('keeps unrelated workspace domains stable when only chat data changes', async () => {
    const settings = settingsFor('a');
    const store = createAppStore({ settings, chatPreferences: defaultChatPreferences, controlPlaneUrl: '' });
    const target = { connectionId: aConnection, projectPath: '/repo' };
    const scopeKey = workspaceKey(target);
    const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const client = { __opencode: { contract: 'v2', directory: '/repo' } } as ScopedOpencodeClient;
    store.getState().setRegistry({ ready: true, focus: target, connections: [workspaceEntry('a')] });
    store.getState().setSelection(scopeKey, { currentSessionId: 's' });
    store.getState().setShellValue('onboardingVersion', CURRENT_ONBOARDING_VERSION);
    cache.setQueryData(projectSessionsKey(catalogIdentity(aConnection), client), [{ id: 's', title: 'Chat', time: { created: 1, updated: 1 } }]);
    const lifecycle = { connection: { status: 'connected' }, contract: 'v2' };
    const connectionControls = { connectionProfiles: [], connectSetup: {}, services: {} };
    const manager = { getProjectClient: () => client, getState: () => lifecycle };
    const core = {
      store, queryClient: cache, connections: { get: () => manager, getLifecycle: () => lifecycle, subscribe: quietSubscription, subscribeState: quietSubscription },
      commands: {
        connection: { retry: vi.fn(), openSession: vi.fn(), openSessionInProject: vi.fn() },
        workspace: { activate: vi.fn(), resolveKey: () => scopeKey },
        session: {
          creation: () => ({ createSession: vi.fn(), forkSession: vi.fn() }),
          editing: () => ({ revertSession: vi.fn(), unrevertSession: vi.fn() }),
          navigation: () => ({ ensureActiveSession: vi.fn(), openSession: vi.fn() }),
        },
      },
    } as unknown as AppCore;
    function Providers({ children }: PropsWithChildren) {
      return createElement(QueryClientProvider, { client: cache },
        createElement(AppCoreProvider, { core },
          createElement(WorkspaceContext.Provider, { value: { connectionControls } as unknown as WorkspaceRegistry }, children)));
    }
    const driver = renderHook(() => ({
      connectionValue: useConnection(), projectsValue: useProjects(), currentSessionValue: useCurrentSession(),
      sessionLibraryValue: useSessionLibrary(), onboardingValue: useOnboarding(), chatValue: useChat().view, bootstrapping: useChatBootstrap(),
    }), undefined, Providers);
    await settleReact();
    const first = driver.result.current;
    act(() => { store.getState().setPrompt(scopeKey, { sending: { active: true, sessionId: 's' } }); });
    const next = driver.result.current;
    expect(next.chatValue).not.toBe(first.chatValue);
    expect(next.chatValue.sendingState).toEqual({ active: true, sessionId: 's' });
    expect(next.onboardingValue).toBe(first.onboardingValue);
    expect(next.connectionValue).toBe(first.connectionValue);
    expect(next.projectsValue).toBe(first.projectsValue);
    expect(next.currentSessionValue).toBe(first.currentSessionValue);
    expect(next.sessionLibraryValue).toBe(first.sessionLibraryValue);
    expect(next.bootstrapping).toBe(false);

    act(() => {
      store.getState().setSelection(scopeKey, { isBootstrappingChat: true });
      store.getState().setPrompt(scopeKey, { sending: { active: false } });
    });
    expect(driver.result.current.bootstrapping).toBe(true);
    expect(driver.result.current.chatValue.sendingState.active).toBe(false);

    act(first.onboardingValue.startOnboardingReview);
    expect(driver.result.current.onboardingValue).not.toBe(first.onboardingValue);
    expect(driver.result.current.onboardingValue.onboardingActive).toBe(true);
    expect(driver.result.current.connectionValue).toBe(first.connectionValue);
    driver.unmount();
    cache.clear();
  });

  it('shares one SSE transport across workspaces and detaches only the last consumer', async () => {
    let opens = 0, cancelled = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const subscribe = createSharedEventStream(async function* (_client: any, signal: AbortSignal) {
      opens++;
      signal.addEventListener('abort', () => { cancelled++; release(); });
      yield { type: 'server.connected', data: {} } as unknown as import('@/shared/protocol/opencode/events').OpencodeEvent;
      await gate;
    });
    const observed = vi.fn();
    const detach = subscribe.observe(observed);
    const a = new AbortController(), b = new AbortController();
    const first = subscribe({} as ScopedOpencodeClient, a.signal), second = subscribe({} as ScopedOpencodeClient, b.signal);
    expect(((await first.next()).value as import('@/shared/protocol/opencode/events').OpencodeEvent).type).toBe('server.connected');
    expect(((await second.next()).value as import('@/shared/protocol/opencode/events').OpencodeEvent).type).toBe('server.connected');
    expect(opens).toBe(1);
    expect(observed).toHaveBeenCalledOnce(); detach();
    const pending = first.next(); a.abort(); await pending;
    expect(cancelled).toBe(0);
    const other = second.next(); b.abort(); await other;
    expect(cancelled).toBe(1);
  });
  it('validates registry identities and never persists credentials', async () => {
    const entry = { ...workspaceEntry('a'), name: 'A',
      settings: { ...settingsFor('a'), password: 'secret', headers: { 'CF-Access-Client-Secret': 'header-secret' } },
      preferences: { autoApprove: false }, projects: ['/same'], events: () => {},
    };
    const serialized = serializeWorkspaces([entry], { connectionId: entry.id, projectPath: '/same' });
    expect(serialized).not.toContain('secret'); expect(serialized).not.toContain('password'); expect(serialized).not.toContain('headers');
    expect(parseWorkspaces(serialized).connections[0].enabled).toBe(true);
    expect(() => parseWorkspaces(serialized.replace(entry.id, 'wrong-id'))).toThrow();
    expect(() => parseWorkspaces(JSON.stringify({ version: 2, connections: [] }))).toThrow();
    expect(() => parseWorkspaces(JSON.stringify({ version: 1, connections: [{ ...entry, events: undefined }] }))).toThrow();
    expect(() => parseWorkspaces(JSON.stringify({ version: 1, connections: [{ ...entry, events: undefined, settings: { serverUrl: 'http://a', username: '', directory: '', headers: { 'CF-Access-Client-Secret': 'header-secret' } } }] }))).toThrow();
    expect(parseChatPreferences('{"openingScreen":"mission"}').openingScreen).toBe('mission');
    expect(parseChatPreferences('{"openingScreen":"unsupported"}').openingScreen).toBeUndefined();

    // Routing preferences must survive a workspace registry round-trip; a stale
    // or dropped value here is what makes an enabled setting look reset on launch.
    const autoModel: ChatPreferences['autoModel'] = { enabled: true, classifier: 'server', classifierModelId: 'openai/nano', tiers: { simple: 'openai/nano', standard: 'auto', complex: 'openai/deep' }, tierVariants: { simple: null, standard: null, complex: 'high' }, protectLongChats: false };
    const withRouting = { ...entry, preferences: { autoModel } };
    const routingRoundTrip = parseWorkspaces(serializeWorkspaces([withRouting], { connectionId: entry.id, projectPath: '/same' }));
    expect(routingRoundTrip.connections[0].preferences.autoModel).toEqual(autoModel);
  });
});

it('tracks unsaved drafts across hidden servers without counting clean editors or scroll state', async () => {
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
      }) as unknown as NonNullable<ReturnType<TestConnections['get']>>,
      subscribeState: quietSubscription,
    },
  }, ({ connectionId }: { connectionId: string }) => ({ replyToPermission: connectionId === 'a' ? a : b, replyToQuestion: async () => {}, rejectQuestion: async () => {} })).start();
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
  let release!: () => void;
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(0);
  const source = createSharedEventStream(async function* (_client: unknown, signal: AbortSignal) {
    const stopped = new Promise<void>((resolve) => { release = resolve; });
    signal.addEventListener('abort', () => release());
    yield { type: 'server.connected', data: {} } as unknown as import('@/shared/protocol/opencode/events').OpencodeEvent; await stopped;
  });
  const widget = source({} as ScopedOpencodeClient, new AbortController().signal);
  expect(((await widget.next()).value as import('@/shared/protocol/opencode/events').OpencodeEvent).type).toBe('server.connected');
  await vi.advanceTimersByTimeAsync(SSE_STALENESS_MS + WATCHDOG_TICK_MS);
  expect((await widget.next()).done).toBe(true);
});

it('keeps lifecycle decisions current without resetting retained runtimes', async () => {
  const findSessionForNavigation = vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
  const certificate = {
    pem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----', fingerprint: 'a'.repeat(64),
    subject: 'CN=test', issuer: 'CN=test', kind: 'ca' as const, count: 1,
    notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z',
  };
  const oidc = { issuer: 'https://issuer.test', clientId: 'mobile', scopes: 'openid', tokenHeader: 'X-Auth-Request-Access-Token' };
  const entries = [workspaceEntry('a'), workspaceEntry('b')];
  const profile = { id: 'saved', name: 'Saved', serverUrl: 'http://c', username: 'carol', oidc };
  await saveProfilePassword(profile.id, 'saved-password');
  await saveProfileCertificate(profile.id, certificate);
  const storedProfiles = JSON.stringify([profile]);
  cloudLinkPlatform.preferences.set(CONNECTION_PROFILES_STORAGE_KEY, storedProfiles);
  const connected = { status: 'connected', message: 'Connected' };
  const client = {
    __opencode: { contract: 'v2', directory: '' },
    api: { session: { get: ({ sessionID }: { sessionID: string }) => findSessionForNavigation(sessionID) } },
  };
  const queryClient = new QueryClient();
  const realtimes = new Map([aConnection, bConnection, cConnection].map((id) => [id, createRealtime(quietForeground, () => {})]));
  const managers = new Map([...realtimes].map(([id, realtime]) => [id, {
    realtime,
    getState: () => ({ connection: connected }), connect: async () => connected, getCatalogClient: () => client,
    getProjectAccess: (directory: string) => ({ identity: catalogIdentity(id), client: { __opencode: { contract: 'v2', directory } }, isCurrent: () => true }),
  } as unknown as NonNullable<ReturnType<TestConnections['get']>>]));
  const navigation = new Map<string, ReturnType<TestSessionCommands['navigation']>>();
  function bindNavigation(connectionId: string, projectPath: string) {
    const actions = { openSession: vi.fn(async () => {}), openDeepLinkSession: vi.fn(async () => ({ ok: true })),
      openSessionInProject: vi.fn(async () => {}), ensureActiveSession: vi.fn(async () => undefined) };
    navigation.set(workspaceKey({ connectionId, projectPath }), actions);
    return actions;
  }
  const originalNavigation = bindNavigation(aConnection, '/repo');
  const bNavigation = bindNavigation(bConnection, '/repo');
  const unscopedNavigation = bindNavigation(bConnection, '');
  const pauseVoice = vi.fn(async (_id?: string) => {});
  const driver = mountWorkspaceConnections(entries, aConnection, defaultChatPreferences,
    { get: (id) => managers.get(id), subscribeState: quietSubscription, subscribeProjects(listener) {
      const stops = [...realtimes.values()].map((realtime) => realtime.subscribeProjects(listener));
      return () => { for (const stop of stops) stop(); };
    } }, queryClient, {
      creation: () => ({ createSession: vi.fn(), forkSession: vi.fn() }),
      navigation: (scope) => navigation.get(workspaceKey(scope)) ?? unexpectedSessionCommand(),
    }, pauseVoice);
  const { store } = driver;
  const isEnabled = driver.value.isEnabled;
  await driver.settle();
  expect(isEnabled(aConnection)).toBe(true);
  driver.value.change((records: AppState['registry']['connections']) => records.map((entry) => ({
    ...entry, projects: entry.id === aConnection ? ['', '/repo', '/other'] : ['', '/repo'],
  })));
  const original = projectSources(workspaceKey({ connectionId: aConnection, projectPath: '/repo' }), '/repo');
  const other = projectSources(workspaceKey({ connectionId: aConnection, projectPath: '/other' }), '/other');
  const b = projectSources(workspaceKey({ connectionId: bConnection, projectPath: '/repo' }), '/repo');
  realtimes.get(aConnection)!.createScope().update(original);
  realtimes.get(aConnection)!.createScope().update(other);
  const bProject = realtimes.get(bConnection)!.createScope();
  bProject.update(b);
  await driver.settle();
  queryClient.setQueryData(catalogKey(aConnection), { sessions: [{ id: 'collision', directory: '/repo' }] });
  await expect(driver.value.navigate({ connectionId: bConnection, projectPath: '/repo', sessionId: 'collision' })).rejects.toThrow('was not found');
  expect(bNavigation.openSession).not.toHaveBeenCalled();
  findSessionForNavigation.mockResolvedValueOnce({ id: 'outside-catalog', location: { directory: '/repo' }, time: {} });
  await driver.value.navigate({ connectionId: bConnection, projectPath: '/repo', sessionId: 'outside-catalog' });
  expect(bNavigation.openSession).toHaveBeenCalledWith('outside-catalog');
  queryClient.setQueryData(catalogKey(bConnection), { sessions: [{ id: 'collision', directory: '/repo' }] });
  await driver.value.navigate({ connectionId: bConnection, projectPath: '/repo', sessionId: 'collision' }); await driver.settle();
  expect(bNavigation.openSession).toHaveBeenCalledWith('collision');
  driver.value.select({ connectionId: aConnection, projectPath: '/repo' }); await driver.settle();
  await driver.value.openExternalSession({ connectionId: bConnection, projectPath: '/repo', sessionId: 'collision' });
  expect(bNavigation.openDeepLinkSession).toHaveBeenCalledWith({ sessionId: 'collision', projectPath: '/repo' }, expect.any(AbortSignal));
  expect(originalNavigation.openDeepLinkSession).not.toHaveBeenCalled();
  const unscoped = projectSources(workspaceKey({ connectionId: bConnection, projectPath: '' }), '');
  bProject.dispose();
  driver.value.change((records: AppState['registry']['connections']) => records.map((entry) =>
    entry.id === bConnection ? { ...entry, projects: [''] } : entry));
  const bDefault = realtimes.get(bConnection)!.createScope();
  bDefault.update(unscoped);
  await driver.settle();
  const opening = driver.value.openExternalSession({ connectionId: bConnection, projectPath: '', sessionId: 'default-project' });
  await driver.settle();
  expect(unscoped.catalog.actions.loadProjectCatalog).toHaveBeenCalledWith(true);
  expect(unscopedNavigation.openDeepLinkSession).not.toHaveBeenCalled();
  expect(driver.value.connections.find((entry) => entry.id === bConnection)?.projects).toEqual(['']);
  store.getState().setSelection(workspaceKey({ connectionId: bConnection, projectPath: '' }), { activeProjectPath: '/repo' });
  bDefault.update({ ...unscoped });
  await driver.settle();
  expect(unscopedNavigation.openDeepLinkSession).not.toHaveBeenCalled();
  bDefault.update({ ...b, workspaceKey: workspaceKey({ connectionId: bConnection, projectPath: '' }) });
  await driver.settle();
  await opening;
  expect(bNavigation.openDeepLinkSession).toHaveBeenCalledWith({ sessionId: 'default-project', projectPath: undefined }, expect.any(AbortSignal));
  await driver.value.disconnect(aConnection); await driver.settle();
  expect(pauseVoice).toHaveBeenLastCalledWith(aConnection);
  expect(isEnabled(aConnection)).toBe(false); expect(isEnabled(bConnection)).toBe(true);
  expect(original.binding.suspend).toHaveBeenCalledOnce(); expect(other.binding.suspend).toHaveBeenCalledOnce(); expect(b.binding.suspend).not.toHaveBeenCalled();
  const activating = driver.value.connectSavedProfile(profile);
  await driver.settle();
  realtimes.get(cConnection)!.createScope().update(projectSources(workspaceKey({ connectionId: cConnection, projectPath: '' }), ''));
  await activating;
  expect(store.getState().registry.connections.find(({ id }) => id === cConnection)?.settings).toMatchObject({ certificate, oidc, password: 'saved-password' });
  expect(cloudLinkPlatform.preferences.get(CONNECTION_PROFILES_STORAGE_KEY)).toBe(storedProfiles);
  driver.unmount();
  queryClient.clear();
});

it('keeps auto-model and auto-approval preferences on the owning server', async () => {
  const entries = [workspaceEntry('a'), workspaceEntry('b')];
  const chatPreferences: ChatPreferences = { ...defaultChatPreferences, autoModel: { ...defaultChatPreferences.autoModel, classifier: 'server' as const } };
  const driver = mountWorkspaceConnections(entries, aConnection, chatPreferences);
  const { store } = driver;
  await driver.settle();

  const enabled = { ...chatPreferences, autoModel: { ...chatPreferences.autoModel, enabled: true } };
  driver.value.updatePreferences(aConnection, enabled);
  await driver.settle();
  expect(driver.value.connections.find((entry) => entry.id === aConnection)?.preferences.autoModel?.enabled).toBe(true);
  expect(store.getState().shell.chatPreferences.autoModel.enabled).toBe(true);

  // A background workspace applying its own stale preferences must not turn the
  // focused connection's routing off in the shell or the global persistence key.
  const background: typeof chatPreferences = { ...enabled, autoModel: { ...enabled.autoModel, enabled: false, classifier: 'local' } };
  driver.value.updatePreferences(bConnection, background);
  await driver.settle();
  expect(driver.value.connections.find((entry) => entry.id === bConnection)?.preferences.autoModel?.enabled).toBe(false);
  expect(store.getState().shell.chatPreferences.autoModel.enabled).toBe(true);
  expect(store.getState().shell.chatPreferences.autoModel.classifier).toBe('server');

  const queryClient = new QueryClient();
  let contract: 'v2' | 'v1' = 'v2';
  const connections: TestConnections = {
    get: () => ({ getState: () => ({ contract }) }) as ReturnType<TestConnections['get']>,
    subscribeState: quietSubscription, subscribeProjects: quietSubscription,
  };
  const workspace = createWorkspaceCommands({ store, queryClient, connections }, {
    navigation: unexpectedSessionCommand, creation: unexpectedSessionCommand,
  }, async () => {});
  const { setAutoApprove } = createConnectionCommands({ store, queryClient, connections }, workspace);
  await expect(setAutoApprove(bConnection, 1, true)).rejects.toThrow('no longer available');
  contract = 'v1';
  await expect(setAutoApprove(bConnection, undefined, true)).rejects.toThrow('OpenCode 2 only');
  contract = 'v2';
  await setAutoApprove(bConnection, undefined, true);
  expect(store.getState().registry.connections.find(({ id }) => id === bConnection)?.preferences).toMatchObject({
    autoApprove: true, autoModel: { enabled: false, classifier: 'local' },
  });
  expect(store.getState().registry.connections.find(({ id }) => id === aConnection)?.preferences?.autoApprove).toBeFalsy();
  expect(store.getState().shell.chatPreferences.autoApprove).toBeFalsy();

  driver.unmount();
  queryClient.clear();
});

it('selects a connected fallback for failover and prefers the last healthy server', async () => {
  const connection = (id: string, enabled = true): ConnectionRecord => ({ ...workspaceEntry(id), id, enabled });
  const readConnection = (id: string): ConnectionState => ({ status: id === 'b' ? 'connecting' : 'connected', message: '' });
  const selection = { '["c","/repo"]': { activeProjectPath: '/c', isBootstrappingChat: false, activeSessionsVisible: false } };
  expect(connectedWorkspaceTarget([connection('a', false), connection('b'), connection('c'), connection('d')], selection, readConnection))
    .toEqual({ connectionId: 'c', projectPath: '/c' });
  expect(connectedWorkspaceTarget([connection('a'), connection('b'), connection('c'), connection('d')], selection, readConnection, { preferredConnectionId: 'd' }))
    .toEqual({ connectionId: 'd', projectPath: '/repo' });
  expect(connectedWorkspaceTarget([connection('a', false), connection('b'), connection('c'), connection('d')], selection, readConnection, { excludedConnectionId: 'c' }))
    .toEqual({ connectionId: 'd', projectPath: '/repo' });
  expect(connectedWorkspaceTarget([connection('b')], selection, readConnection)).toBeUndefined();
});

it('moves chat focus to a connected server when the focused server fails', async () => {
  const entries = [workspaceEntry('a'), workspaceEntry('b')];
  const statuses = new Map<string, ConnectionState['status']>([[aConnection, 'connected'], [bConnection, 'connected']]);
  const realtimes = new Map([aConnection, bConnection].map((id) => [id, createRealtime(quietForeground, () => {})]));
  const listeners = new Set<() => void>();
  const connections: TestConnections = {
    get: (id) => ({ realtime: realtimes.get(id), getState: () => ({ connection: { status: statuses.get(id) } }) }) as unknown as NonNullable<ReturnType<TestConnections['get']>>,
    subscribeState(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeProjects(listener) {
      const stops = [...realtimes.values()].map((realtime) => realtime.subscribeProjects(listener));
      return () => { for (const stop of stops) stop(); };
    },
  };
  function setStatus(id: string, status: ConnectionState['status']) {
    statuses.set(id, status);
    for (const listener of listeners) listener();
  }
  const driver = mountWorkspaceConnections(entries, bConnection, defaultChatPreferences, connections);
  const { store } = driver;
  await driver.settle();
  store.getState().setSelection(workspaceKey({ connectionId: aConnection, projectPath: '' }), { activeProjectPath: '/repo' });
  store.getState().setSelection(workspaceKey({ connectionId: bConnection, projectPath: '' }), { activeProjectPath: '/repo' });
  realtimes.get(aConnection)!.createScope().update(projectSources(workspaceKey({ connectionId: aConnection, projectPath: '' }), '/repo'));
  realtimes.get(bConnection)!.createScope().update(projectSources(workspaceKey({ connectionId: bConnection, projectPath: '' }), '/repo'));
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: bConnection, projectPath: '' });
  setStatus(bConnection, 'error');
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: aConnection, projectPath: '/repo' });
  setStatus(bConnection, 'connected');
  driver.value.select({ connectionId: bConnection, projectPath: '/repo' });
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: bConnection, projectPath: '/repo' });
  await driver.value.disconnect(bConnection);
  await driver.settle();
  expect(driver.value.focus).toEqual({ connectionId: aConnection, projectPath: '/repo' });
  expect(driver.value.isEnabled(bConnection)).toBe(false);
  driver.unmount();
});

it('flattens terminal catalogs once per server PTY and keeps the owning workspace actions', async () => {
  const connections = ['a', 'b'].map((id) => ({ ...workspaceEntry(id), id }));
  const pty = { id: 'same', cwd: '/repo', title: 'Terminal', command: 'sh', args: [], status: 'running' as const, pid: 1 };
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
  const listSessions = vi.fn(async () => ({ data: [] }));
  const catalogClient = {
    __opencode: { contract: 'v2', directory: '' },
    api: { session: { list: listSessions, active: async () => ({}) } },
  } as unknown as ScopedOpencodeClient;
  const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  function Provider({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client: cache }, children);
  }
  const input = { identity: catalogIdentity('test'), catalogClient, connected: false, hideSubagentChats: false, visible: false };
  const driver = renderHook(useActiveSessions, input, Provider);
  await driver.result.current.refreshActiveSessions();
  expect(listSessions).not.toHaveBeenCalled();
  driver.rerender({ ...input, connected: true });
  await act(async () => { await driver.result.current.refreshActiveSessions(); });
  expect(listSessions).toHaveBeenCalled();
  driver.unmount();
  cache.clear();
});
