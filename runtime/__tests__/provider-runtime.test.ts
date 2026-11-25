// @vitest-environment happy-dom

import '../../tests/helpers/native-view-hosts';
import '../../tests/helpers/native-animation';
import { cloudLinkPlatform } from '../../tests/helpers/cloud-link-platform';
import { act, createElement, useState, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, vi } from 'vitest';
import { useConversationState } from '@/features/voice/state/use-conversation-state';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { useConnectionProfiles } from '@/features/connections/state/use-connection-profiles';
import { useLibraryOperation } from '@/features/sessions/ui/use-library-operation';
import { projectSessionsKey } from '@/features/sessions/services/queries';
import { createSessionNavigationCommands } from '@/runtime/core/commands/session-navigation';
import type { CommandContext } from '@/runtime/core/commands/context';
import { createProjectTerminal } from '@/features/terminal/services/project-terminal';
import { getProfilePassword, loadConnectionProfiles } from '@/shared/storage/connection-profiles';
import { getProfileHeaders } from '@/shared/storage/connection-headers';
import { CONNECTION_PROFILES_STORAGE_KEY } from '@/shared/storage/keys';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import type { Session } from '@/shared/protocol/opencode/types';
import { i18n } from '@/shared/i18n/index';
import { useProjectBrowser } from '@/features/projects/state/use-project-browser';
import { useProjectFileActions } from '@/features/projects/state/use-project-file-actions';
import { createProjectCatalogActions } from '@/features/projects/services/project-catalog-actions';
import { buildClient, type ConnectionFailureKind, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { AppCoreProvider, type AppCore } from '@/runtime/core';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ProjectFile } from '@/shared/protocol/opencode/project-file';
import { deriveTodosFromMessages } from '@/shared/presentation/format/todos';
import { aggregateUsageSteps } from '@/shared/presentation/usage';
import { renderHook } from '../../tests/helpers/render-hook';
import { controlledClock, deferred, settleReact } from '../../tests/helpers/controlled-clock';
import { promptFixture } from './real-prompt-fixture';

import assert from 'node:assert/strict';
import { projectQueryKey } from '@/shared/server-data/keys';
import { pruneByKeepIds } from '@/shared/utilities/prune';
import { pruneProviderTranscripts } from '@/features/chat/model/transcript-pruning';
import { recordSessionUsageAndTodos } from '@/features/chat/model/session-ledger';
import { shouldPoll } from '@/runtime/realtime/polling';
import { createAppStore } from '@/runtime/core/store';
import { createRealtime, type RealtimeScopeInput } from '@/runtime/realtime/create-realtime';
import { SSE_FOREGROUND_CYCLE_MS, SSE_STALENESS_MS, WATCHDOG_TICK_MS } from '@/shared/network/realtime-timing';

const deviceVoice = vi.hoisted(() => ({
  recognition: undefined as any, speech: undefined as any,
  wake: undefined as any, command: undefined as any, listening: false,
  start: undefined as (() => Promise<boolean>) | undefined, abort: undefined as (() => void) | undefined,
  startWake: undefined as (() => boolean | Promise<boolean>) | undefined,
  startCommand: undefined as (() => boolean) | undefined,
}));
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} }));
vi.mock('@/shared/platform/voice/speech-output', () => ({
  stopSpeaking: async () => {},
  speakText: async (options: any) => { deviceVoice.speech = options; options.onStart?.(); return true; },
}));
vi.mock('@/shared/platform/voice/use-speech-input', () => ({
  useSpeechInput: (options: any) => {
    deviceVoice.recognition = options;
    return { abort: () => deviceVoice.abort?.(), start: () => deviceVoice.start?.(),
      isListening: deviceVoice.listening, isStarting: false, level: 0, startFailed: false };
  },
}));
vi.mock('@/shared/platform/voice/use-local-wake-word', () => ({
  useLocalWakeWord: (options: any) => {
    deviceVoice.wake = options;
    return { available: true, level: 0, status: 'idle', refreshAvailability: () => true,
      start: async () => deviceVoice.startWake?.(), stop: async () => {} };
  },
}));
vi.mock('@/shared/platform/voice/use-local-command-capture', () => ({
  useLocalCommandCapture: (options: any) => {
    if (!options.finishOnFirstTurn) deviceVoice.command = options;
    return { start: async () => deviceVoice.startCommand?.(), stop: async () => {} };
  },
}));
vi.mock('@/shared/platform/voice/permissions', () => ({ isVoicePermissionPromptActive: () => false }));
vi.mock('@/shared/platform/voice/wake-feedback', () => ({ playWakePhraseCue: () => {} }));
vi.mock('@/shared/platform/voice/working-sound', () => ({ stopWorkingSoundAsync: async () => {} }));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-clipboard', () => ({}));
vi.mock('expo-sharing', () => ({}));
afterEach(() => {
  cloudLinkPlatform.beforePreferenceRead = undefined;
  cloudLinkPlatform.beforePreferenceWrite = undefined;
  cloudLinkPlatform.failSecureWrite = false;
  cloudLinkPlatform.appState = undefined;
  cloudLinkPlatform.afterPreferenceWrite = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };

const idleAppState = { currentState: 'active', addEventListener: (_event: string, _callback: (state: string) => void) => ({ remove() {} }) };

function realtimeProbe(appState = idleAppState, onFatalError: (kind: ConnectionFailureKind) => void = () => {}) {
  const socket = createRealtime({
    isActive: () => appState.currentState === 'active',
    subscribe: (callback) => appState.addEventListener('change', (state) => callback(state === 'active')).remove,
  }, onFatalError);
  return {
    ...socket,
    shouldPoll,
    mount(client: { api: { event: { subscribe: (options: { signal: AbortSignal }) => Promise<AsyncGenerator<import('@/shared/protocol/opencode/events').OpencodeEvent>> } } }, initial: Omit<RealtimeScopeInput, 'refreshMessages'> & { refreshMessages: (...args: Parameters<RealtimeScopeInput['refreshMessages']>) => Promise<unknown> }) {
      let input = initial as RealtimeScopeInput;
      const scope = socket.createScope();
      scope.update(input);
      socket.setTransport({ client: client as unknown as ScopedOpencodeClient, subscribe: async function* (_instance, signal) {
        yield* await client.api.event.subscribe({ signal });
      } });
      return { update: (patch: Partial<RealtimeScopeInput>) => { input = { ...input, ...patch }; scope.update(input); } };
    },
  };
}

describe('provider runtime actions', () => {
  it('provider runtime actions', async () => {

// Exercise file reads and saves through the same SDK, store and Query observers as the app.
const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const settings = { serverUrl: 'http://server', username: '', password: '', directory: '/repo' };
const store = createAppStore({ settings, chatPreferences: defaultChatPreferences, controlPlaneUrl: '' });
const scopeKey = 'preview-test-workspace';
const reads = new Map<string, ReturnType<typeof deferred<string[]>>>();
const directoryReads = new Map<string, ReturnType<typeof deferred<{ path: string; type: 'file' }[]>>>();
const fileReads = new Map<string, ReturnType<typeof deferred<string>>>();
const fileGate = deferred<string>(), saveGate = deferred<string>();
let patches = 0, aborted = false, bytes = 'original';
let readSave = () => saveGate.promise;
let writeSave = async (value: string) => { patches++; bytes = value; };
const fileSdk = {
  find: async ({ query }: { query: string }) => {
    const gate = deferred<string[]>();
    reads.set(query, gate);
    return { data: (await gate.promise).map((path) => ({ path })) };
  },
  list: async ({ path }: { path: string }) => {
    const gate = deferred<{ path: string; type: 'file' }[]>();
    directoryReads.set(path, gate);
    return { data: await gate.promise };
  },
  read: async ({ path }: { path: string }) => {
    if (path === 'save') return readSave();
    if (path.startsWith('selection-')) {
      const gate = deferred<string>();
      fileReads.set(path, gate);
      return gate.promise;
    }
    return fileGate.promise;
  },
  write: async ({ payload }: { payload: Uint8Array }) => writeSave(new TextDecoder().decode(payload)),
};
const client = { __opencode: { contract: 'v2', directory: '/repo' },
  api: { file: fileSdk, session: { interrupt: async () => { aborted = true; } } } } as unknown as ScopedOpencodeClient;
let active = client;
const isCurrentClient = (candidate: object) => candidate === active;
function Providers({ children }: PropsWithChildren) {
  return createElement(QueryClientProvider, { client: cache },
    createElement(AppCoreProvider, { core: { store } as AppCore }, children));
}
const browser = renderHook(useProjectBrowser, { identity, queryActive: true, scopeKey: 'browser-test-workspace', client, isCurrentClient }, Providers);
const file = renderHook(useProjectFileActions, {
  identity, queryActive: true, scopeKey, client, isCurrentClient, connectionId: identity.connectionId,
  settings, connected: false, fileClipboard: { busy: {}, entries: {}, register: () => () => {} } as never,
  refreshServerFeatures: async () => {}, refreshVcsDiff: async () => {},
}, Providers);
function start<T>(action: () => Promise<T>) {
  let pending!: Promise<T>;
  act(() => { pending = action(); });
  return pending;
}
const first = start(() => browser.result.current.search('first'));
const last = start(() => browser.result.current.search('last'));
await act(async () => {
  reads.get('last')!.resolve(['last.ts']); await last;
  reads.get('first')!.resolve(['first.ts']); await first;
});
await settleReact();
assert.deepEqual(browser.result.current.results, ['last.ts'], 'older searches cannot replace newer results');
const firstDirectory = start(() => browser.result.current.openDirectory('src'));
const lastDirectory = start(() => browser.result.current.openDirectory('docs'));
await act(async () => {
  directoryReads.get('docs')!.resolve([{ path: 'docs/guide.md', type: 'file' }]); await lastDirectory;
  directoryReads.get('src')!.resolve([{ path: 'src/old.ts', type: 'file' }]); await firstDirectory;
});
await settleReact();
assert.equal(browser.result.current.path, 'docs');
assert.equal(browser.result.current.entries[0]?.path, 'docs/guide.md');
await assert.rejects(browser.result.current.openDirectory('../outside'), /Invalid project path/);
await act(async () => { await browser.result.current.search(''); });
assert.equal(browser.result.current.path, 'docs', 'clearing search retains the browsed directory');

const makeBrowserInput = (client: ScopedOpencodeClient) => ({ identity, queryActive: true, scopeKey: 'browser-test-workspace', client, isCurrentClient });
const select = (path: string) => start(() => file.result.current.openProjectFile(path));
const save = (expected: string, next: string) => file.result.current.saveProjectFile('save', expected, next);
const readPreview = (path: string) => cache.getQueryData<ProjectFile>(projectQueryKey(identity, client, 'preview', path));
let olderFile!: Promise<void>, newerFile!: Promise<void>;
act(() => {
  olderFile = file.result.current.openProjectFile('selection-first');
  newerFile = file.result.current.openProjectFile('selection-last');
});
await act(async () => {
  fileReads.get('selection-last')!.resolve('latest selection'); await newerFile;
  fileReads.get('selection-first')!.resolve('obsolete selection');
  await assert.rejects(olderFile, /superseded/);
});
const selected = readPreview('selection-last');
assert.equal(selected?.path, 'selection-last');
assert.equal(store.getState().workspaceUi[scopeKey]?.preview?.path, 'selection-last');

const staleSearch = start(() => browser.result.current.search('old-server'));
const staleDirectory = start(() => browser.result.current.openDirectory('old-server'));
const staleFile = select('old-server');
const staleSave = save('original', 'edited');
active = { ...client };
browser.rerender(makeBrowserInput(active));
await act(async () => {
  directoryReads.get('old-server')!.resolve([{ path: 'old-server/wrong.ts', type: 'file' }]);
  await staleDirectory;
});
assert.equal(browser.result.current.initialized, false, 'a stale folder response cannot initialize the new server browser');
await act(async () => {
  reads.get('old-server')!.resolve(['wrong-server.ts']);
  fileGate.resolve('wrong server');
  saveGate.resolve('original');
  await staleSearch;
  await assert.rejects(staleFile, /superseded/);
  await assert.rejects(staleSave, /project changed/);
});
browser.rerender(makeBrowserInput(active));
assert.equal(browser.result.current.initialized, false, 'a different server with the same path resets the browser');
assert.deepEqual(browser.result.current.results, []);
assert.equal(selected?.path, 'selection-last'); assert.equal(patches, 0);

active = client;
readSave = async () => bytes;
await assert.rejects(save('obsolete', 'draft'), /changed on the server/);
assert.equal(patches, 0, 'a known conflict must never write');
await save('original', 'edited');
assert.equal(bytes, 'edited'); assert.equal(readPreview('save')?.content?.content, 'edited');
writeSave = async () => { throw new Error('write offline'); };
await assert.rejects(save('edited', 'draft'), /write offline/);
assert.equal(readPreview('save')?.content?.content, 'edited', 'a failed write must not replace the saved baseline');
writeSave = async () => { bytes = 'external edit'; };
await assert.rejects(save('edited', 'draft'), /did not match/);
assert.equal(readPreview('save')?.content?.content, 'edited', 'failed verification must not replace the saved baseline');
browser.unmount(); file.unmount(); cache.clear();

const prompt = promptFixture({ client });
prompt.currentClient.current = client;
cloudLinkPlatform.beforePreferenceRead = async () => { throw new Error('storage unavailable'); };
await prompt.runtime.value.abortSession('s');
cloudLinkPlatform.beforePreferenceRead = undefined;
prompt.runtime.unmount();
assert.equal(aborted, true, 'notification storage failure must not prevent aborting server work');

// Resolve the catalog and alternate worktrees using server location responses.
const canonical = '/workspace/main-clone';
let knownProjectLocation = false;
let heldProjectLocation: (() => Promise<boolean>) | undefined;
const priorFetch = globalThis.fetch;
vi.stubGlobal('fetch', async (request: RequestInfo | URL) => {
  const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url);
  if (url.pathname === '/api/project') return Response.json([{ id: 'project-1', canonical, time: { created: 1, updated: 2 } }]);
  if (url.pathname === '/api/location') {
    const path = url.searchParams.get('location[directory]');
    const known = !path || path === '/worktrees/task' || (heldProjectLocation ? await heldProjectLocation() : knownProjectLocation);
    if (!known) return new Response(null, { status: 404 });
    return Response.json({ directory: path ?? canonical, project: { id: 'project-1', canonical, directory: path ?? canonical } });
  }
  throw new Error('Unexpected catalog request: ' + url.pathname);
});
function makeProjectCatalogActions(activePath: string | undefined, isCurrent = () => true, noCurrentRoot = false) {
  const state = { activePath, cleared: 0 };
  const activeProjectPathRef = { current: activePath };
  const scopeGenerationRef = { current: 0 };
  const serverSettings = { ...settings, directory: '' };
  const server = noCurrentRoot ? {
    __opencode: { contract: 'v1', directory: '' },
    compatibility: {
      path: { get: async () => ({ data: { directory: '/workspace' } }) },
      project: { current: async () => ({ data: { id: 'placeholder', time: { created: 0 } } }),
        list: async () => ({ data: [{ id: 'project-1', worktree: canonical, time: { created: 1 } }] }) },
    },
  } as unknown as ScopedOpencodeClient : buildClient(serverSettings);
  const catalogCache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const actions = createProjectCatalogActions(catalogCache, {
    identity, client: server, catalogClient: server, isCurrentClient: isCurrent, isCurrentCatalogClient: isCurrent,
    activeProjectPathRef,
    setActiveProjectPath: (next) => {
      const path = typeof next === 'function' ? next(state.activePath) : next;
      state.activePath = path; activeProjectPathRef.current = path;
    },
    clearProjectState: () => { state.cleared++; },
    scopeGenerationRef, serverContract: server.__opencode.contract, settingsRef: { current: serverSettings },
  });
  return { get activePath() { return state.activePath; }, get cleared() { return state.cleared; }, actions, scopeGenerationRef };
}
const seededProject = makeProjectCatalogActions(undefined);
await seededProject.actions.refreshProjectCatalog();
assert.equal(seededProject.activePath, canonical, 'a fresh connection selects the server current project');
const droppedProject = makeProjectCatalogActions('/workspace/other-clone');
await droppedProject.actions.refreshProjectCatalog();
assert.equal(droppedProject.activePath, canonical, 'an unlisted project falls back to the server current project');
assert.equal(droppedProject.cleared, 1, 'dropping an unlisted project clears project state');
assert.equal(droppedProject.scopeGenerationRef.current, 1, 'dropping an unlisted project advances the project generation');
knownProjectLocation = true;
const retainedWorktree = makeProjectCatalogActions('/worktrees/task');
await retainedWorktree.actions.refreshProjectCatalog();
assert.equal(retainedWorktree.activePath, '/worktrees/task', 'a server-resolved worktree remains selected');
assert.equal(retainedWorktree.cleared, 0, 'a server-resolved worktree does not clear project state');
assert.equal(retainedWorktree.scopeGenerationRef.current, 0, 'a server-resolved worktree does not advance the project generation');
knownProjectLocation = false;
const firstListedProject = makeProjectCatalogActions(undefined, undefined, true);
await firstListedProject.actions.refreshProjectCatalog();
assert.equal(firstListedProject.activePath, canonical, 'the first server project seeds an empty connection');
const staleProjectResponse = makeProjectCatalogActions('/workspace/other-clone', () => false);
await staleProjectResponse.actions.refreshProjectCatalog();
assert.equal(staleProjectResponse.activePath, '/workspace/other-clone', 'stale catalog responses leave the active project alone');
const validatingProject = makeProjectCatalogActions('/workspace/other-clone');
const validationStarted = deferred<void>(), validationResult = deferred<boolean>();
heldProjectLocation = () => { validationStarted.resolve(); return validationResult.promise; };
const delayedRefresh = validatingProject.actions.refreshProjectCatalog();
await validationStarted.promise;
validatingProject.scopeGenerationRef.current++;
validationResult.resolve(false);
await delayedRefresh;
heldProjectLocation = undefined;
assert.equal(validatingProject.activePath, '/workspace/other-clone', 'late location validation leaves the newer generation alone');
const addedWorktree = makeProjectCatalogActions(canonical);
assert.equal(await addedWorktree.actions.addProject('/worktrees/task'), '/worktrees/task');
assert.equal(addedWorktree.activePath, '/worktrees/task', 'adding a directory selects the requested worktree rather than its owning project root');
vi.stubGlobal('fetch', priorFetch);

// The bounded transcript keeps an independent, replay-safe usage/plan ledger.
let usageLedger: any = {}, todoLedger: any = {};
const ledgerMessage = (id: any, time: any, status: any, cost: any) => ({
  info: { id, role: 'assistant', time: { created: time }, providerID: 'p', modelID: 'm' },
  parts: [
    { type: 'tool', tool: 'todowrite', state: { status: 'completed', input: { todos: [{ content: 'Task', status }] } } },
    { id: 'usage', sessionID: 's', messageID: id, type: 'step-finish', cost, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
  ],
});
const recordUsage = (sessionId: string, records: any[]) => recordSessionUsageAndTodos(
  sessionId, records,
  (update: any) => { usageLedger = update(usageLedger); },
  (update: any) => { todoLedger = update(todoLedger); },
);
recordUsage('s', [ledgerMessage('new', 20, 'pending', 0)]);
recordUsage('s', [ledgerMessage('new', 20, 'completed', 0.2)]);
recordUsage('s', [ledgerMessage('old', 10, 'pending', 0.1)]);
recordUsage('s', [ledgerMessage('new', 20, 'completed', 0.2)]);
assert.equal(deriveTodosFromMessages(todoLedger.s)[0].status, 'completed', 'loading older pages cannot revert the current plan');
assert.equal(usageLedger.s.length, 2, 'updated/replayed calls must not duplicate usage');
assert.ok(Math.abs(aggregateUsageSteps(usageLedger.s).cost - 0.3) < 1e-10);

// Real connection realtime manager: connected busy polling, reconnect reconciliation,
// backpressure, stable subscriptions, and cancellation of reconnect timers.
const realtimeClock = controlledClock(1_000_000, true);
vi.spyOn(Math, 'random').mockReturnValue(0.99);
let events: any[] = [], wake: any, subscriptions = 0, sessionsRefreshed = 0, pendingRefreshed = 0;
let heldRefresh: any;
const catalogClient = { api: { event: { async subscribe({ signal }: any) {
  subscriptions++;
  return (async function* () {
    while (!signal.aborted) {
      const incoming = await new Promise<import('@/shared/protocol/opencode/events').OpencodeEvent | null>((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
      if (!incoming) return;
      yield incoming;
    }
  })();
} } } };
const realtime = realtimeProbe();
assert.equal(realtime.shouldPoll(true, false), false);
assert.equal(realtime.shouldPoll(true, true), true);
assert.equal(realtime.shouldPoll(false, false), true);
let nativeSurfacesRefreshed = 0;
const inputs = {
  refreshNativeSurfaces: async () => { nativeSurfacesRefreshed++; },
  projectPath: '/repo', busy: false, currentSessionId: 's',
  onEvent: (event: any) => events.push(event.type),
  refreshSessions: async () => { sessionsRefreshed++; await heldRefresh?.promise; },
  refreshPendingInteractions: async () => { pendingRefreshed++; },
  refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
};
const scope = realtime.mount(catalogClient, inputs); await settleReact();
wake({ location: { directory: '/repo' }, type: 'server.connected' }); await settleReact();
assert.equal(realtime.getStatus(), 'connected'); assert.equal(sessionsRefreshed, 1); assert.equal(pendingRefreshed, 1);
assert.equal(realtimeClock.countTimers(5000), 0, 'idle connected SSE needs no safety poll');
scope.update({ busy: true }); await realtimeClock.advance(10000); await settleReact(); assert.equal(sessionsRefreshed, 2);
heldRefresh = deferred(); await realtimeClock.advance(10000); await settleReact(); await realtimeClock.advance(10000); await settleReact();
assert.equal(sessionsRefreshed, 3, 'slow reconciliation cannot overlap with another tick');
heldRefresh.resolve(); heldRefresh = undefined; await settleReact();
scope.update({ refreshMessages: async () => [] }); await settleReact(); assert.equal(subscriptions, 1, 'changing action identities must not reopen SSE');
wake(null); await settleReact(); assert.equal(realtime.getStatus(), 'error');
await realtimeClock.advance(1000); await settleReact(); assert.equal(subscriptions, 2);
wake({ location: { directory: '/another-project' }, type: 'server.connected' }); await settleReact();
assert.equal(sessionsRefreshed, 4); assert.equal(pendingRefreshed, 4, 'reconnection always recovers pending interactions');
assert.equal(nativeSurfacesRefreshed, 4, 'widget reconciliation follows first connect, safety polls and reconnects');
assert.deepEqual(events, ['server.connected'], 'other-project events are filtered');
const secondaryEvents: string[] = [];
const secondary = realtime.createScope();
secondary.update({ ...inputs, projectPath: '/another-project', onEvent: (event) => secondaryEvents.push(event.type) });
wake({ location: { directory: '/another-project' }, type: 'session.updated' }); await settleReact();
assert.equal(subscriptions, 2, 'a second retained project joins the existing stream');
assert.deepEqual(secondaryEvents, ['session.updated']);
assert.deepEqual(events, ['server.connected'], 'retained projects still filter by directory');
wake(null); await settleReact(); realtime.dispose(); assert.equal(realtimeClock.countTimers(1000), 0);

// SSE liveness: a stream that goes silent without an error is re-established
// once per staleness window, a long background return re-verifies the stream,
// and a reconnect reconcile is queued behind an in-flight safety poll.
{

  let subscriptions = 0, wake: any, sessions = 0, pending = 0, dispatched = 0, heldSessions: any;
  const messageModes: any[] = [];
  const listeners = new Set<any>();
  const client = { api: { event: { async subscribe({ signal }: any) {
    subscriptions++;
    return (async function* () {
      while (!signal.aborted) {
        const incoming = await new Promise<import('@/shared/protocol/opencode/events').OpencodeEvent | null>((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
        if (incoming === null) return;
        yield incoming;
      }
    })();
  } } } };
  const appState = { currentState: 'active', addEventListener: (_event: any, listener: any) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } };
  const socket = realtimeProbe(appState);
  const inputs = {
    projectPath: '/repo', busy: false, currentSessionId: 's',
    onEvent: () => { dispatched++; }, refreshSessions: async () => { sessions++; await heldSessions?.promise; },
    refreshPendingInteractions: async () => { pending++; },
    refreshMessages: async (_id: any, _silent: any, options: any) => { messageModes.push(options?.mode); },
    refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
  };
  const scope = socket.mount(client, inputs); await settleReact();
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await settleReact();
  assert.equal(socket.getStatus(), 'connected');
  assert.equal(subscriptions, 1); assert.equal(sessions, 1); assert.equal(pending, 1);
  await realtimeClock.advance(SSE_STALENESS_MS - WATCHDOG_TICK_MS); await settleReact();
  assert.equal(subscriptions, 1, 'a stream inside the staleness window is left alone');
  await realtimeClock.advance(2 * WATCHDOG_TICK_MS); await settleReact();
  assert.equal(subscriptions, 2, 'a silent stream is re-established after the window');
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await settleReact();
  assert.equal(socket.getStatus(), 'connected');
  appState.currentState = 'background';
  [...listeners].forEach((listener: any) => listener('background'));
  await realtimeClock.advance(SSE_FOREGROUND_CYCLE_MS + 1000);
  appState.currentState = 'active';
  [...listeners].forEach((listener: any) => listener('active'));
  await settleReact();
  assert.equal(subscriptions, 3, 'a long background return re-verifies the stream');
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await settleReact();
  messageModes.length = 0;
  heldSessions = deferred<void>();
  scope.update({ busy: true }); await realtimeClock.advance(10000); await settleReact();
  assert.deepEqual(messageModes, [], 'the busy safety poll trusts the live stream');
  wake(null); await settleReact(); await realtimeClock.advance(1000); await settleReact();
  assert.equal(subscriptions, 4);
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await settleReact();
  assert.deepEqual(messageModes, [], 'a reconnect reconcile waits for the in-flight poll');
  heldSessions.resolve(undefined); heldSessions = undefined; await settleReact();
  assert.deepEqual(messageModes, [undefined], 'the reconnect reconcile reads the transcript');
  // A short background return must still re-assert domain data even though the
  // stream stayed up and no restart/rebuild is requested.
  const sessionsBeforeForeground = sessions;
  appState.currentState = 'background';
  [...listeners].forEach((listener: any) => listener('background'));
  await realtimeClock.advance(1000);
  appState.currentState = 'active';
  [...listeners].forEach((listener: any) => listener('active'));
  await settleReact();
  assert.equal(subscriptions, 4, 'a short background return keeps the live stream');
  assert.ok(sessions > sessionsBeforeForeground, 'a foreground return re-asserts sessions without a restart');
  // Off-screen there is no UI to keep current, so the safety poll must not keep
  // waking the radio; foreground return resumes it after the authoritative pass.
  assert.equal(realtimeClock.countTimers(10000), 1, 'a busy foreground workspace arms one safety poll');
  appState.currentState = 'background';
  [...listeners].forEach((listener: any) => listener('background'));
  await settleReact();
  assert.equal(realtimeClock.countTimers(10000), 0, 'backgrounding stops the safety poll');
  const sessionsPaused = sessions;
  await realtimeClock.advance(5000); await settleReact();
  assert.equal(sessions, sessionsPaused, 'a backgrounded workspace does not poll');
  appState.currentState = 'active';
  [...listeners].forEach((listener: any) => listener('active'));
  await settleReact();
  assert.equal(subscriptions, 4, 'the short return keeps the live stream');
  assert.equal(realtimeClock.countTimers(10000), 1, 'foreground return resumes the safety poll');
  // Backgrounded events must not drive project reads; raw connection observers
  // (alerts, widgets) still consume the shared stream.
  const dispatchedBefore = dispatched;
  appState.currentState = 'background';
  [...listeners].forEach((listener: any) => listener('background'));
  wake({ location: { directory: '/repo' }, type: 'session.updated' }); await settleReact();
  assert.equal(dispatched, dispatchedBefore, 'a backgrounded workspace skips project event dispatch');
  appState.currentState = 'active';
  [...listeners].forEach((listener: any) => listener('active'));
  wake({ location: { directory: '/repo' }, type: 'session.updated' }); await settleReact();
  assert.equal(dispatched, dispatchedBefore + 1, 'foreground events resume project dispatch');
  // A stream that dies off-screen waits for foreground instead of retrying.
  appState.currentState = 'background';
  [...listeners].forEach((listener: any) => listener('background'));
  await settleReact();
  wake(null); await settleReact();
  assert.equal(socket.getStatus(), 'error');
  assert.equal(realtimeClock.countTimers(1000), 0, 'a backgrounded reconnect waits for foreground');
  appState.currentState = 'active';
  [...listeners].forEach((listener: any) => listener('active'));
  await settleReact();
  assert.equal(subscriptions, 5, 'foreground return restarts the parked stream');
  socket.dispose();
}

// Revocation: an authentication failure stops the stream, notifies the
// provider once, and never enters the reconnect loop.
{
  let fatal = 0, subscriptions = 0;
  const client = { api: { event: { async subscribe() { subscriptions++; throw Object.assign(new Error('401 credentials rejected'), { status: 401 }); } } } };
  const socket = realtimeProbe(idleAppState,
    (kind) => { fatal++; assert.equal(kind, 'auth'); });
  socket.mount(client, {
    projectPath: '/repo', busy: true, currentSessionId: 's',
    onEvent: () => {}, refreshSessions: async () => {}, refreshPendingInteractions: async () => {},
    refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
  });
  await settleReact();
  assert.equal(socket.getStatus(), 'error');
  assert.equal(fatal, 1); assert.equal(subscriptions, 1);
  await realtimeClock.advance(1000); await settleReact(); await realtimeClock.advance(15000); await settleReact();
  assert.equal(subscriptions, 1, 'revoked credentials must not retry the stream');
  assert.equal(fatal, 1, 'the provider is notified once');
  socket.dispose();
}

realtimeClock.restore();

// Conversation state machine runs against stubbed speech/platform boundaries.
const voiceClock = controlledClock(2_000_000);
let sends = 0, aborts = 0, localWakeStarts = 0, localCommandStarts = 0;
let lastPrompt: string | undefined;
let permissionRequests: ReturnType<typeof deferred<void>>[] | undefined;
let localWakeStartResult: boolean | Promise<boolean> = true;
const sendGate = deferred<void>();
const appStateListeners = new Set<(state: string) => void>();
cloudLinkPlatform.appState = (listener) => {
  appStateListeners.add(listener);
  return () => { appStateListeners.delete(listener); };
};
function onConversationAppStateChange(state: string) {
  cloudLinkPlatform.state = state;
  act(() => { for (const listener of appStateListeners) listener(state); });
  cloudLinkPlatform.state = 'active';
}
deviceVoice.start = async () => {
  if (permissionRequests) {
    const permission = deferred<void>();
    permissionRequests.push(permission);
    await permission.promise;
  }
  deviceVoice.listening = true;
  return true;
};
const abortSpeech = () => { deviceVoice.listening = false; aborts++; };
deviceVoice.abort = abortSpeech;
deviceVoice.startWake = () => { localWakeStarts++; return localWakeStartResult; };
deviceVoice.startCommand = () => { localCommandStarts++; return true; };
const chatPreferences = { ...defaultChatPreferences, confirmVoiceCommands: false };
type VoiceInput = Parameters<typeof useConversationState>[0];
let voiceInput: VoiceInput = {
  scopeKey: 'voice-test-workspace',
  connection: { status: 'connected', message: 'ready' }, chatPreferences, currentSessionId: 's', setCurrentSessionId: () => {},
  sessionStatuses: { s: { type: 'busy' } }, messagesBySession: {}, pendingPermissionsBySession: {}, pendingQuestionsBySession: {},
  sendingState: { active: false }, ensureActiveSession: async () => 's',
  sendPrompt: async (_sessionId, prompt) => { sends++; lastPrompt = prompt; await sendGate.promise; return true; },
};
const voice = renderHook(useConversationState, voiceInput, Providers);
const voiceRuntime = {
  get value() { return voice.result.current; },
  update(patch: Partial<VoiceInput>) { voiceInput = { ...voiceInput, ...patch }; voice.rerender(voiceInput); },
  fire: voiceClock.advance, countTimers: voiceClock.countTimers, settle: settleReact, unmount: voice.unmount,
};
function assistantReply(id: string, text: string, created = 0): SessionMessageRecord {
  return {
    info: { id, sessionID: 's', role: 'assistant', time: { created, completed: created + 1 }, finish: 'stop' },
    parts: [{ id: id + '-text', sessionID: 's', messageID: id, type: 'text', text }],
  } as SessionMessageRecord;
}
const phase = () => voiceRuntime.value.conversation.phase;
async function stopConversation() {
  if (phase() !== 'off') {
    await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
  }
  assert.equal(phase(), 'off');
}
async function startConversation(expectedPhrase = 'hey code') {
  await stopConversation();
  await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
  assert.equal(phase(), 'armed');
  assert.deepEqual(JSON.parse(JSON.stringify(deviceVoice.recognition.contextualStrings)), [expectedPhrase]);
}

// The phrase gate is the only way into a turn. Noise without the phrase is
// discarded, a split phrase still matches, and only the suffix is submitted.
await startConversation();
act(() => { deviceVoice.recognition.onResult('background chatter', true); });
await voiceRuntime.settle();
assert.equal(phase(), 'armed', 'noise without the wake phrase cannot start a turn');
assert.equal(voiceRuntime.value.conversation.latestHeardText, undefined);
act(() => { deviceVoice.recognition.onResult('hey', true); });
act(() => { deviceVoice.recognition.onResult('code open settings', true); });
await voiceRuntime.settle();
assert.equal(phase(), 'listening');
assert.equal(voiceRuntime.value.conversation.latestHeardText, 'open settings');
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 1);
assert.equal(lastPrompt, 'open settings', 'the wake phrase is stripped from the prompt');

sendGate.resolve(); await voiceRuntime.settle();
assert.equal(phase(), 'waiting');
assert.equal(voiceRuntime.value.conversation.inputPhase, 'armed', 'input re-arms while the reply is still pending');
assert.equal(voiceRuntime.value.conversation.readbackPhase, 'waiting');
voiceRuntime.update({ sessionStatuses: { s: { type: 'idle' } }, messagesBySession: { s: [
  assistantReply('interim', 'On it', 1),
  assistantReply('reply', 'done', 3),
] } });
await voiceRuntime.settle(); assert.equal(phase(), 'speaking');
await voiceRuntime.fire(120); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.inputPhase, 'armed');
assert.equal(voiceRuntime.value.conversation.readbackPhase, 'speaking');
assert.equal(deviceVoice.speech.text, 'done', 'only the final assistant bubble is read');
act(() => { deviceVoice.speech.onDone(); }); await voiceRuntime.settle(); assert.equal(phase(), 'armed');
assert.equal(voiceRuntime.value.conversation.readbackPhase, 'idle');

// A phrase-only turn opens the command window and re-arms when nothing follows.
await startConversation();
act(() => { deviceVoice.recognition.onResult('hey code', true); });
await voiceRuntime.settle();
assert.equal(phase(), 'listening');
assert.equal(voiceRuntime.value.conversation.latestHeardText, undefined);
await voiceRuntime.fire(6000); await voiceRuntime.settle();
assert.equal(phase(), 'armed');
assert.match(voiceRuntime.value.conversation.feedback ?? '', /did not catch a command/);
assert.equal(sends, 1);
voiceRuntime.value.clearConversationFeedback();

// Interims revise the active command instead of appending duplicated words.
await startConversation();
act(() => { deviceVoice.recognition.onResult('a code open', false, ['hey code open']); });
act(() => { deviceVoice.recognition.onResult('a code open settings', false, ['hey code open settings']); });
await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.latestHeardText, 'open settings');
act(() => { deviceVoice.recognition.onResult('a code open Android settings', true, ['hey code open Android settings']); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'open Android settings');
act(() => { deviceVoice.recognition.onEnd(); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 2, 'the final lower-ranked hypothesis submits the complete command once');

// A command may continue across finalized segments after the phrase.
await startConversation();
act(() => { deviceVoice.recognition.onResult('hey code count to', true); });
await voiceRuntime.settle();
assert.equal(phase(), 'listening');
act(() => { deviceVoice.recognition.onResult('three', true); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'count to three'); assert.equal(sends, 3);

// An end without a final checkpoints an unfinished command and submits it.
await startConversation();
act(() => { deviceVoice.recognition.onResult('hey code run tests', false); });
act(() => { deviceVoice.recognition.onEnd(); });
await voiceRuntime.settle();
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'run tests'); assert.equal(sends, 4);

// A recognition end while armed preserves only the phrase tail, so a phrase
// split across the restart still matches.
await startConversation();
act(() => { deviceVoice.recognition.onResult('hey', true, ['hay']); });
act(() => { deviceVoice.recognition.onEnd(); }); abortSpeech();
await voiceRuntime.update({}); await voiceRuntime.fire(350); await voiceRuntime.settle();
assert.equal(phase(), 'armed');
assert.equal(sends, 4);
act(() => { deviceVoice.recognition.onResult('code after restart', true); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'after restart'); assert.equal(sends, 5);

// A canceled or backgrounded turn cannot leak late events into the next one.
await startConversation();
act(() => { deviceVoice.recognition.onResult('hey code discard this turn', false); });
await stopConversation();
act(() => { deviceVoice.recognition.onEnd(); }); deviceVoice.recognition.onResult('late final', true);
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 5);
for (const appState of ['inactive', 'background']) {
  await startConversation();
  act(() => { deviceVoice.recognition.onResult('hey code unsent background instruction', true); });
  onConversationAppStateChange(appState); await voiceRuntime.settle();
  if (appState === 'inactive') {
    assert.equal(phase(), 'listening', 'inactive does not cancel a turn');
  } else {
    assert.equal(phase(), 'off');
    act(() => { deviceVoice.recognition.onEnd(); });
    await voiceRuntime.fire(350); await voiceRuntime.fire(2200); await voiceRuntime.settle();
    assert.equal(sends, 5, 'a background-canceled turn cannot restart or submit after end');
    assert.equal(voiceRuntime.countTimers(2200), 0);
    assert.equal(voiceRuntime.countTimers(6000), 0);
  }
}

// The configured phrase is normalized and reaches the recognizer as vocabulary.
voiceRuntime.update({ chatPreferences: { ...chatPreferences, conversationWakePhrase: '  hey    bot ' } });
await startConversation('hey bot');
act(() => { deviceVoice.recognition.onResult('hey bot run tests', true); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'run tests'); assert.equal(sends, 6);
voiceRuntime.update({ chatPreferences });

// Repeated taps during permission startup share one attempt.
await stopConversation();
permissionRequests = [];
const firstStart = voiceRuntime.value.toggleConversationMode();
await voiceRuntime.settle();
const duplicateStart = voiceRuntime.value.toggleConversationMode();
await voiceRuntime.settle();
assert.equal(permissionRequests.length, 1, 'only one conversation permission/start attempt may be pending');
permissionRequests[0].resolve();
await Promise.all([firstStart, duplicateStart]); await voiceRuntime.settle();
permissionRequests = undefined;
assert.equal(phase(), 'armed');
act(() => { deviceVoice.recognition.onResult('hey code one startup, one intact turn', true); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'one startup, one intact turn');
assert.equal(sends, 7, 'the pending startup keeps its conversation session');

// A recognition end after the phrase keeps the command window open; the user
// does not have to repeat the wake phrase for the command.
await startConversation();
act(() => { deviceVoice.recognition.onResult('hey code', true); });
act(() => { deviceVoice.recognition.onEnd(); }); abortSpeech();
await voiceRuntime.update({}); await voiceRuntime.fire(350); await voiceRuntime.settle();
assert.equal(phase(), 'listening');
act(() => { deviceVoice.recognition.onResult('open settings', true); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'open settings');
assert.equal(sends, 8, 'the preserved command window appends to the matched phrase');

// Local mode wakes through the on-device detector, then captures only the
// command with the OS recognizer.
await stopConversation();
voiceRuntime.update({ chatPreferences: { ...chatPreferences, voiceWakeMode: 'local' } });
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(phase(), 'armed');
assert.equal(localWakeStarts, 1, 'arming starts the local detector');
act(() => { deviceVoice.wake.onWake(); });
await voiceRuntime.settle();
assert.equal(phase(), 'listening');
assert.equal(localCommandStarts, 1, 'the verified wake starts local command capture');
act(() => { deviceVoice.command.onPartialCommand('open settings'); });
await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.latestHeardText, 'open settings');
act(() => { deviceVoice.command.onCommand('open settings'); });
await voiceRuntime.settle();
assert.equal(lastPrompt, 'open settings', 'the local command is submitted without an OS transcript');
assert.equal(sends, 9);
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
voiceRuntime.update({ chatPreferences });
localWakeStartResult = false;
// A local-mode start failure falls back to the OS phrase gate.
voiceRuntime.update({ chatPreferences: { ...chatPreferences, voiceWakeMode: 'local' } });
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(phase(), 'armed');
assert.match(voiceRuntime.value.conversation.feedback ?? '', /phrase gate/);
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
voiceRuntime.update({ chatPreferences });
localWakeStartResult = true;

// While the local detector is warming up, stop and background both cancel
// startup without activating the System recognizer as a fallback.
voiceRuntime.update({ chatPreferences: { ...chatPreferences, voiceWakeMode: 'local' } });
for (const cancel of ['stop', 'background']) {
  const localStart = deferred<boolean>();
  localWakeStartResult = localStart.promise;
  const starting = voiceRuntime.value.toggleConversationMode();
  await voiceRuntime.settle();
  assert.equal(phase(), 'armed');
  if (cancel === 'stop') await stopConversation();
  else onConversationAppStateChange('background');
  await voiceRuntime.settle();

  localStart.resolve(false);
  await starting;
  await voiceRuntime.settle();
  assert.equal(phase(), 'off');
  assert.equal(deviceVoice.listening, false, 'a canceled local start cannot open the System recognizer');
}
localWakeStartResult = true;
voiceRuntime.update({ chatPreferences });

// Opting into progress updates reads completed interim bubbles before the final
// settled reply while input stays armed.
voiceRuntime.update({
  chatPreferences: { ...chatPreferences, readInterimAssistantReplies: true },
  messagesBySession: {},
  sessionStatuses: { s: { type: 'busy' } },
});
await startConversation();
act(() => { deviceVoice.recognition.onResult('hey code fetch news', true); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
const interimReply = assistantReply('on-it', 'On it', 1);
voiceRuntime.update({ messagesBySession: { s: [interimReply] } });
await voiceRuntime.settle(); await voiceRuntime.fire(120); await voiceRuntime.settle();
assert.equal(phase(), 'speaking');
assert.equal(deviceVoice.speech.text, 'On it');
const finalReply = assistantReply('final', 'Here is the news', 3);
voiceRuntime.update({ messagesBySession: { s: [interimReply, finalReply] }, sessionStatuses: { s: { type: 'idle' } } });
await voiceRuntime.settle();
act(() => { deviceVoice.speech.onDone(); }); await voiceRuntime.settle();
await voiceRuntime.fire(120); await voiceRuntime.settle();
assert.equal(deviceVoice.speech.text, 'Here is the news', 'the settled final reply is queued after progress readback');
act(() => { deviceVoice.speech.onDone(); }); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.readbackPhase, 'idle');
await stopConversation();
voiceRuntime.update({ chatPreferences, messagesBySession: {}, sessionStatuses: { s: { type: 'idle' } } });

voiceRuntime.update({ pendingQuestionsBySession: { s: [{ id: 'question', sessionID: 's', questions: [] }] } });
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle(); assert.equal(phase(), 'off');
assert.match(voiceRuntime.value.conversation.feedback ?? '', /Answer the current request/);
// A captured system command is gated by confirmation when the preference is
// enabled. TTS completion + the echo guard is the only path to the confirmation
// recognizer, and confirmation speech never reaches OpenCode.
await stopConversation();
voiceRuntime.update({ chatPreferences: { ...chatPreferences, confirmVoiceCommands: true }, pendingQuestionsBySession: {} });
await startConversation();
act(() => { deviceVoice.recognition.onResult('hey code refactor the login component', true); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(phase(), 'confirming');
assert.equal(voiceRuntime.value.conversation.confirmation?.phase, 'prompting');
assert.equal(sends, 10, 'an unconfirmed command is not sent');
await voiceRuntime.fire(120); await voiceRuntime.settle();
assert.match(deviceVoice.speech.text, /refactor the login component/);
act(() => { deviceVoice.speech.onDone(); }); await voiceRuntime.settle();
await voiceRuntime.fire(300); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.confirmation?.phase, 'listening');
act(() => { deviceVoice.recognition.onResult('yes', true); });
await voiceRuntime.settle();
assert.equal(lastPrompt, 'refactor the login component');
assert.equal(sends, 11, 'the confirmed command is sent once');
act(() => { deviceVoice.recognition.onResult('yes', true); });
await voiceRuntime.settle();
assert.equal(sends, 11, 'confirmation speech cannot become a second prompt');
await stopConversation();
// No-wake mode still requires confirmation when it is enabled.
voiceRuntime.update({
  chatPreferences: { ...chatPreferences, wakePhraseRequired: false, confirmVoiceCommands: true, voiceWakeMode: 'phrase' },
});
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(phase(), 'listening');
act(() => { deviceVoice.recognition.onResult('run tests', true); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(phase(), 'confirming');
assert.equal(sends, 11, 'no-wake ambient command is not sent before confirmation');
act(() => { voiceRuntime.value.conversation.confirmation?.actions.cancel(); });
await voiceRuntime.settle();
assert.equal(phase(), 'listening');
assert.equal(sends, 11);
await stopConversation();
// No-wake system mode treats every final transcript as a command.
voiceRuntime.update({
  chatPreferences: { ...chatPreferences, wakePhraseRequired: false, confirmVoiceCommands: false, voiceWakeMode: 'phrase' },
});
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(phase(), 'listening', 'no-wake system starts listening immediately');
act(() => { deviceVoice.recognition.onResult('open settings', true); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'open settings');
assert.equal(sends, 12);
voiceRuntime.update({
  messagesBySession: { s: [assistantReply('no-wake-reply', 'done')] },
  sessionStatuses: { s: { type: 'idle' } },
});
await voiceRuntime.settle(); await voiceRuntime.fire(120); await voiceRuntime.settle();
assert.equal(phase(), 'speaking', 'no-wake listening still yields to reply readback');
assert.equal(deviceVoice.speech.text, 'done');
act(() => { deviceVoice.speech.onDone(); }); await voiceRuntime.settle();
await stopConversation();
// No-wake local mode skips KWS and starts command capture directly.
const commandStartsBefore = localCommandStarts;
const wakeStartsBefore = localWakeStarts;
voiceRuntime.update({
  chatPreferences: { ...chatPreferences, wakePhraseRequired: false, confirmVoiceCommands: false, voiceWakeMode: 'local' },
});
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(phase(), 'listening');
assert.equal(localCommandStarts, commandStartsBefore + 1);
assert.equal(localWakeStarts, wakeStartsBefore, 'no-wake local does not start the KWS detector');
act(() => { deviceVoice.command.onCommand('open settings'); });
await voiceRuntime.settle();
assert.equal(lastPrompt, 'open settings');
assert.equal(sends, 13);
await stopConversation();
voiceRuntime.update({ chatPreferences });
// A lower recognition hypothesis can carry the phrase when the top mishears it.
const alternativeSends = sends;
await startConversation();
act(() => { deviceVoice.recognition.onResult('a code check alternatives', true, ['hey code check alternatives']); });
await voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'check alternatives');
assert.equal(sends, alternativeSends + 1);
await stopConversation();
voiceRuntime.unmount(); assert.equal(voiceRuntime.countTimers(2200), 0); assert.equal(voiceRuntime.countTimers(6000), 0); assert.ok(aborts > 0);

voiceClock.restore();
cloudLinkPlatform.appState = undefined;

// Profile orchestration stays provider-owned and serializes metadata/credentials.
let updates = 0;
cloudLinkPlatform.preferences.clear();
cloudLinkPlatform.secrets.clear();
const clearCapabilitiesSnapshots = async () => {};
type ProfileInput = Pick<Parameters<typeof useConnectionProfiles>[0], 'settings' | 'switchConnection' | 'updateSettings'>;
let profileInput: ProfileInput = {
  settings: { ...settings, serverUrl: 'http://current.test' },
  switchConnection: async () => ({ status: 'connected', message: 'ready' }),
  updateSettings: () => { updates++; },
};
const profileDriver = renderHook((input: ProfileInput) => {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  return useConnectionProfiles({ clearCapabilitiesSnapshots, ...input, profiles, setProfiles });
}, profileInput);
const profileRuntime = {
  get value() { return profileDriver.result.current; },
  update(patch: Partial<ProfileInput>) { profileInput = { ...profileInput, ...patch }; profileDriver.rerender(profileInput); },
  settle: settleReact,
};
let savedA!: ConnectionProfile, savedB!: ConnectionProfile;
await act(async () => {
  [savedA, savedB] = await Promise.all([
    profileRuntime.value.save({ name: 'A', serverUrl: 'http://a.test', username: 'alice', password: 'a-secret', headers: { 'CF-Access-Client-Id': 'a-client' } }),
    profileRuntime.value.save({ name: 'B', serverUrl: 'http://b.test', username: 'bob', password: 'b-secret', headers: { 'CF-Access-Client-Id': 'b-client' } }),
  ]);
});
const savedHeaders = { 'CF-Access-Client-Id': 'a-client' };
assert.equal((await loadConnectionProfiles()).length, 2);
assert.equal(updates, 0, 'saving a new inactive profile cannot change the active settings');
assert.deepEqual(await getProfileHeaders(savedA.id), savedHeaders, 'gateway headers stay in secure storage');
assert.equal(JSON.stringify(await loadConnectionProfiles()).includes('a-client'), false, 'profile metadata never carries header values');
cloudLinkPlatform.failSecureWrite = true;
const edit = (password: string, headers: typeof savedHeaders | Record<string, never>) =>
  profileRuntime.value.save({ name: 'edited', serverUrl: 'http://a.test', username: 'alice', password, headers }, savedA.id);
await assert.rejects(edit('session-token', {}), /secure write failed/);
assert.equal((await loadConnectionProfiles()).find((entry) => entry.id === savedA.id)?.name, 'A', 'credential failures leave profile metadata intact');
assert.equal(await getProfilePassword(savedA.id), 'a-secret');
cloudLinkPlatform.failSecureWrite = false;
cloudLinkPlatform.beforePreferenceWrite = async (key) => {
  if (key === CONNECTION_PROFILES_STORAGE_KEY) throw new Error('metadata failed');
};
await assert.rejects(edit('new-secret', { 'CF-Access-Client-Id': 'new-client' }), /metadata failed/);
assert.equal(await getProfilePassword(savedA.id), 'a-secret', 'failed metadata writes restore the previous credential');
assert.deepEqual(await getProfileHeaders(savedA.id), savedHeaders, 'failed metadata writes restore the previous headers');
cloudLinkPlatform.beforePreferenceWrite = undefined;
profileRuntime.update({ settings: { ...settings, serverUrl: 'http://a.test', username: 'alice' } });
await assert.rejects(profileRuntime.value.remove(savedA.id), /active connection/);
await act(async () => { await profileRuntime.value.remove(savedB.id); });
assert.equal((await loadConnectionProfiles()).length, 1);
assert.equal(await getProfilePassword(savedB.id), '');
assert.deepEqual(await getProfileHeaders(savedB.id), {}, 'removing a profile clears its gateway headers');
let named!: ConnectionProfile;
await act(async () => {
  named = await profileRuntime.value.save({ name: '  ', serverUrl: 'https://EXAMPLE.test:8443/proxy', username: '', password: 'session-token', headers: {} });
});
assert.equal(named.name, 'example.test');
assert.equal(await getProfilePassword(named.id), 'session-token');
assert.equal('password' in (await loadConnectionProfiles()).find(({ id }) => id === named.id)!, false);
assert.equal(updates, 0, 'setup saves and probes leave the current connection untouched');
vi.stubGlobal('fetch', async (request: RequestInfo | URL) => {
  const path = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url).pathname;
  if (path === '/api/info') return Response.json({ version: '2.0.0', pid: 1, urls: [] });
  if (path === '/auth/connect/code') return Response.json({ token: 'session-token' });
  return new Response(null, { status: 404 });
});
assert.equal((await profileRuntime.value.probe({ serverUrl: 'http://example.test', username: '', password: '', headers: {} })).status, 'detected');
assert.equal((await profileRuntime.value.pair('http://example.test/auth/connect/code')).password, 'session-token');
vi.stubGlobal('fetch', priorFetch);
const stableProfiles = profileRuntime.value;
profileRuntime.update({ switchConnection: async () => ({ status: 'connected', message: 'ready' }) });
assert.equal(profileRuntime.value, stableProfiles, 'profile domain values remain stable when only callback bridges change');
profileDriver.unmount();

// Link validation and automatic bootstrap share the scoped session command.
let createdSessions = 0, fetchedSessions = 0;
let currentClient = true;

const target = { id: 'target', time: {} };
const refreshLinkSessions = async () => { fetchedSessions++; return [target]; };
let findLinkedSession = async (_client: unknown, id: string): Promise<{ id: string; time: object; directory?: string } | undefined> =>
  (await refreshLinkSessions()).find((session) => session.id === id);
const linkClient = {
  __opencode: { contract: 'v2', directory: '/repo' },
  api: { session: { get: async ({ sessionID }: { sessionID: string }) => {
    const record = await findLinkedSession(linkClient, sessionID);
    if (!record) throw Object.assign(new Error('not found'), { status: 404 });
    return { ...record, location: { directory: record.directory ?? '/repo' } };
  } } },
} as unknown as ScopedOpencodeClient;
const bootstrapKey = 'bootstrap-scope';
const sessionCacheKey = projectSessionsKey(identity, linkClient);
const bootstrapCache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
bootstrapCache.setQueryData(sessionCacheKey, [{ id: 'cached' }]);
const bootstrapStore = createAppStore({ settings: { serverUrl: 'https://server.test', directory: '', username: '', password: '' }, chatPreferences: {} as never, controlPlaneUrl: '' });
const bootstrap = createSessionNavigationCommands({
  store: bootstrapStore, queryClient: bootstrapCache, clock: Date.now,
  connections: { get: () => ({
    getState: () => ({ connection: { status: 'connected' } }),
    getProjectAccess: () => ({ client: linkClient, identity, revision: 0, isCurrent: () => currentClient }),
    realtime: { getProjectSources: () => ({
      refreshSessions: async () => bootstrapCache.setQueryData(sessionCacheKey, await refreshLinkSessions()),
      refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {}, refreshPendingInteractions: async () => {},
    }) },
  }) } as unknown as CommandContext['connections'],
}, async () => { createdSessions++; return { id: 'created' } as Session; }).navigation({ connectionId: 'a', projectPath: '/repo' }, bootstrapKey, 0);
bootstrapStore.getState().setSelection(bootstrapKey, { pendingDeepLink: { sessionId: 'target', projectPath: '/repo' } });
fetchedSessions = 0;
assert.equal(await bootstrap.ensureActiveSession(), 'target'); assert.equal(fetchedSessions, 1);
assert.equal(createdSessions, 0);
bootstrapStore.getState().setSelection(bootstrapKey, { pendingDeepLink: { sessionId: 'missing', projectPath: '/repo' } });
assert.equal(await bootstrap.ensureActiveSession(), undefined); assert.equal(createdSessions, 0);

// Local deep-link validation remains authoritative and never creates a chat.
// Cross-connection/project preparation is covered through the workspace manager
// in workspaces.test.ts, rather than by the removed runtime switching loop.
bootstrapStore.getState().setSelection(bootstrapKey, { pendingDeepLink: undefined });
const selectedLinkSession = () => bootstrapStore.getState().selection[bootstrapKey]?.currentSessionId;
assert.equal((await bootstrap.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' })).ok, true);
assert.equal(selectedLinkSession(), 'target');
assert.match((await bootstrap.openDeepLinkSession({ sessionId: 'missing', projectPath: '/repo' })).error ?? '', /was not found/);
assert.equal(createdSessions, 0);
const firstOpenGate = deferred<void>();
let opens = 0;
findLinkedSession = async (_client: unknown, id: string) => {
  if (++opens === 1) await firstOpenGate.promise;
  return { id, time: {} };
};
const firstOpen = bootstrap.openDeepLinkSession({ sessionId: 'first', projectPath: '/repo' });
assert.equal((await bootstrap.openDeepLinkSession({ sessionId: 'second', projectPath: '/repo' })).ok, true);
firstOpenGate.resolve(); assert.match((await firstOpen).error ?? '', /superseded/);
assert.equal(selectedLinkSession(), 'second');
const switchedOpenGate = deferred<void>();
findLinkedSession = async () => { await switchedOpenGate.promise; return target; };
const switchedOpen = bootstrap.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' });
currentClient = false; switchedOpenGate.resolve();
assert.equal((await switchedOpen).ok, false, 'a server switch cannot complete an old session open');
currentClient = true;
const canceledOpenGate = deferred<void>();
findLinkedSession = async () => { await canceledOpenGate.promise; return target; };
const openController = new AbortController();
const canceledOpen = bootstrap.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' }, openController.signal);
openController.abort(); canceledOpenGate.resolve();
assert.equal((await canceledOpen).ok, false);
assert.equal(selectedLinkSession(), 'second', 'cancelled links preserve the selected session');

findLinkedSession = async () => ({ id: 'target', time: {}, directory: '/other' });
assert.match((await bootstrap.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' })).error ?? '', /was not found/);
findLinkedSession = async () => ({ id: 'target', time: {}, directory: '/repo' });
assert.equal((await bootstrap.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' })).ok, true);

// Exercise the library's operation hook with React commit and dismissal.
const library = renderHook(() => useLibraryOperation(true, i18n.t('chat:library.couldNotUpdate')), undefined);
let completed = 0, executions = 0;
const libraryGate = deferred<void>();
const libraryRun = (id: string, action: () => Promise<unknown>, onSuccess?: () => void) =>
  start(() => library.result.current.run(id, action, onSuccess));
const firstLibraryRun = libraryRun('first', async () => { executions++; await libraryGate.promise; throw new Error('superseded'); });
await libraryRun('first', async () => { executions++; }); assert.equal(executions, 1, 'double taps cannot start another action');
act(() => { library.result.current.reset(); });
await act(async () => {
  await library.result.current.run('second', async () => {}, () => { completed++; });
  libraryGate.resolve(); await firstLibraryRun;
});
assert.equal(completed, 1); assert.equal(library.result.current.error, undefined, 'an old error cannot overwrite a newer successful opening');

const queuedGate = deferred<void>();
const queuedFirst = libraryRun('old', async () => { await queuedGate.promise; throw new Error('obsolete error'); }, () => { completed += 100; });
await libraryRun('middle', async () => { completed += 100; }, () => {});
await libraryRun('latest', async () => {}, () => { completed++; });
await act(async () => { queuedGate.resolve(); await queuedFirst; });
assert.equal(completed, 2, 'only the latest queued target completes and closes');
assert.equal(library.result.current.error, undefined);
library.unmount();

// The CI favorite failure opened the right session with an empty transcript.
// Pruning must wait until bootstrap selects the session whose reads just landed.
let cachedMessages: any = { old: ['old transcript'], target: ['new transcript'] };
let cachedDiffs: any = { old: ['old diff'], target: ['new diff'] };
let cachedTodos: any = { old: ['old todo'], target: ['new todo'] };
const pruneInput: any = {
  visible: true,
  isBootstrappingChat: true,
  pendingDeepLinkTargetRef: { current: { sessionId: 'target' } },
  currentSessionId: undefined,
  conversationSessionId: undefined,
  recentSessionIds: [],
  sessionStatuses: {},
  setDiffsBySession: (update: any) => { cachedDiffs = update(cachedDiffs); },
  setTodosBySession: (update: any) => { cachedTodos = update(cachedTodos); },
  pruneTranscript: (keep: Set<string>, limit: number) => { cachedMessages = pruneByKeepIds(cachedMessages, keep, limit); },
};
pruneProviderTranscripts(pruneInput);
assert.deepEqual(cachedMessages.target, ['new transcript'], 'bootstrap reads cannot be evicted before selecting their target');
assert.deepEqual(cachedDiffs.target, ['new diff']); assert.deepEqual(cachedTodos.target, ['new todo']);
pruneInput.isBootstrappingChat = false;
pruneInput.pendingDeepLinkTargetRef.current = undefined;
pruneInput.currentSessionId = 'target';
cachedMessages.extra = []; cachedDiffs.extra = []; cachedTodos.extra = [];
pruneProviderTranscripts(pruneInput);
assert.deepEqual(Object.keys(cachedMessages), ['target'], 'pruning resumes after selection and removes inactive histories');
assert.deepEqual(Object.keys(cachedDiffs), ['target']); assert.deepEqual(Object.keys(cachedTodos), ['target']);

// A hidden workspace sees only its own selection; it must not evict the
// visible workspace's transcript.
cachedMessages = { target: ['new transcript'], background: ['old'], stale: ['old'] };
cachedDiffs = { target: ['new diff'], background: ['old diff'], stale: ['old diff'] };
cachedTodos = { target: ['new todo'], background: ['old todo'], stale: ['old todo'] };
pruneInput.visible = false;
pruneInput.currentSessionId = 'background';
pruneProviderTranscripts(pruneInput);
assert.deepEqual(Object.keys(cachedMessages).sort(), ['background', 'stale', 'target'], 'hidden workspaces cannot evict another workspace transcript');
assert.deepEqual(Object.keys(cachedDiffs).sort(), ['background', 'stale', 'target']);
assert.deepEqual(Object.keys(cachedTodos).sort(), ['background', 'stale', 'target']);

// Real terminal orchestration: stale lists/input and failed removal cannot destroy an opened PTY.
{
  const sockets = new Map<string, TerminalSocket[]>();
  class TerminalSocket {
    readyState = 0;
    closed = false;
    onopen?: () => void;
    send = vi.fn();
    constructor(url: string) {
      const id = new URL(url).pathname.split('/').at(-2)!;
      sockets.set(id, [...(sockets.get(id) ?? []), this]);
      queueMicrotask(() => { if (!this.closed) { this.readyState = 1; this.onopen?.(); } });
    }
    close() { this.closed = true; this.readyState = 3; }
  }
  vi.stubGlobal('WebSocket', TerminalSocket);
  const listGate = deferred<{ data: { id: string; status: 'running' }[] }>();
  let listed = [{ id: 'first', status: 'running' as const }], pendingList = false, rejectRemoval = false;
  const client = {
    __opencode: { contract: 'v2', directory: '/repo' },
    api: { pty: {
      list: () => pendingList ? listGate.promise : Promise.resolve({ data: listed }),
      connect: { token: async () => ({ data: { ticket: 'fixture-ticket' } }) },
      remove: async () => { if (rejectRemoval) throw new Error('Rejected'); },
    } },
  } as unknown as ScopedOpencodeClient;
  const scopeKey = 'terminal-test-workspace';
  const terminalCache = new QueryClient();
  const terminal = createProjectTerminal({ scopeKey, cache: terminalCache, getState: store.getState, foreground: true });
  const input = { identity, client, isCurrentClient: () => true, serverUrl: 'http://example.test', directory: '/repo', serverContract: 'v2' as const };
  const device = () => {
    const state = store.getState().terminal[scopeKey];
    assert.ok(state);
    return state;
  };
  const state = (id: string) => device().instances.find((record) => record.id === id);
  const socket = (id: string) => sockets.get(id)?.at(-1);
  async function open(id: string) {
    const previous = store.getState().terminal[scopeKey]?.instances.find((record) => record.id === id);
    await terminal.openTerminal(id);
    if (!previous) terminal.registerRenderer(id, { write: async () => {} });
    await settleReact();
  }
  terminal.configure(input);
  await open('first');
  const firstSocket = socket('first');
  terminal.pause();
  assert.equal(device().activeTerminalId, 'first');
  assert.equal(state('first')?.status, 'idle');
  assert.ok(state('first'), 'disconnect pauses an opened PTY while retaining its renderer');
  assert.equal(firstSocket?.closed, true);
  terminal.configure(input);
  await settleReact();
  assert.equal(state('first')?.status, 'connected');
  const beforeRotation = sockets.get('first')!.length;
  terminal.configure({ ...input, client: { ...client } });
  await settleReact();
  assert.ok(sockets.get('first')!.length > beforeRotation, 'a rotated credential client reconnects the retained PTY');
  terminal.configure(input);
  await settleReact();
  pendingList = true;
  const refresh = terminal.refreshTerminals();
  await open('second');
  listGate.resolve({ data: listed }); await refresh; pendingList = false;
  assert.equal(state('second')?.status, 'connected', 'a list started before opening cannot exit the new PTY');
  const oldScope = device().scope;
  const previousSockets = [socket('first'), socket('second')];
  terminal.resetTerminal();
  assert.ok(previousSockets.every((entry) => entry?.closed));
  assert.deepEqual(device().instances, []);
  await open('first');
  assert.throws(() => terminal.sendTerminalInput('first', 'stale', 0, oldScope), /scope changed/);
  assert.equal(socket('first')?.send.mock.calls.length, 0, 'a reused PTY ID cannot receive input queued in an old scope');
  rejectRemoval = true;
  await assert.rejects(terminal.closeTerminal('first'), /Rejected/);
  assert.equal(device().activeTerminalId, 'first'); assert.equal(socket('first')?.closed, false);
  await open('second');
  await open('first');
  rejectRemoval = false; listed = [{ id: 'second', status: 'running' }];
  await terminal.closeTerminal('first');
  assert.equal(device().activeTerminalId, 'second'); assert.equal(socket('first')?.closed, true);
  terminal.dispose(); assert.equal(socket('second')?.closed, true);
  terminalCache.clear();
}

  });
});
