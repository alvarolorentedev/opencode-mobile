import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadTs, hookRuntime, deferred } from '../helpers/runtime.mjs';
import { describe, it } from 'vitest';
import { pruneProviderTranscripts } from '@/providers/transcript-pruning';
import { recordSessionUsageAndTodos } from '@/providers/session-ledger';
import * as realtimeBackoff from '@/providers/realtime/backoff';
import * as realtimeLiveness from '@/providers/realtime/liveness';
import * as realtimePolling from '@/providers/realtime/polling';
import * as realtimeReconcile from '@/providers/realtime/reconcile';

const realtimeDeps = {
  '@/providers/realtime/backoff': realtimeBackoff,
  '@/providers/realtime/liveness': realtimeLiveness,
  '@/providers/realtime/polling': realtimePolling,
  '@/providers/realtime/reconcile': realtimeReconcile,
};

describe('provider runtime actions', () => {
  it('provider runtime actions', async () => {

// Exercise the real provider actions, including a server switch where the next
// server exposes the same directory as the previous server. The declarations
// now live in the extracted provider action hooks, so collect them by name from
// their new modules instead of the OpencodeProvider body.
async function readSource(relative: string) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}
// The ledger and transcript-pruning paths now use exported behavior directly.
// These remaining declarations still exercise race-sensitive action closures
// that have no pure seam yet; migrate them as their owning hooks gain one.
function extractDeclarations(source: string, names: string[]) {
  const ast = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: any[] = [];
  function visit(node: any) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      found.push(node.parent.parent.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found.join('\n');
}
const projectActionsSource = await readSource('../../providers/use-project-file-actions.ts');
const promptLifecycleSource = await readSource('../../providers/use-prompt-lifecycle.ts');
const sessionActionsSource = await readSource('../../providers/use-session-bootstrap-actions.ts');
const connectionActionsSource = await readSource('../../providers/use-connection-link-actions.ts');
const names = [ 'openProjectFile', 'saveProjectFile', 'abortSession'];
const declarations = [
  extractDeclarations(projectActionsSource, ['openProjectFile', 'saveProjectFile']),
  extractDeclarations(promptLifecycleSource, ['abortSession']),
].join('\n');
let aborted = false;
const client = { __opencode: { directory: '/repo' }, session: { abort: async () => { aborted = true; } } };
let active: any = client, selected: any, patches = 0;
const reads = new Map(), fileReads = new Map();
const fileGate = deferred(), saveGate = deferred();
const context: any = {
  client, useCallback: (fn: any) => fn, projectSearchRequestRef: { current: 0 }, projectFileRequestRef: { current: 0 },
  activeProjectPathRef: { current: '/repo' }, isCurrentClient: (candidate: any) => candidate === active,
  currentSessionIdRef: {}, diffScopeBySessionRef: { current: {} },
  findFiles: (_: any, query: any) => { const gate = deferred(); reads.set(query, gate); return gate.promise; },
  readFile: (_: any, path: any) => {
    if (path.startsWith('selection-')) { const gate = deferred(); fileReads.set(path, gate); return gate.promise; }
    return path === 'save' ? saveGate.promise : fileGate.promise;
  },
  readProjectFile: async (_: any, path: any) => {
    let content: any;
    if (path.startsWith('selection-')) {
      const gate = deferred(); fileReads.set(path, gate); content = await gate.promise;
    } else {
      content = await (path === 'save' ? saveGate.promise : fileGate.promise);
    }
    return { path, kind: 'text', mime: 'text/plain', size: content.content.length, content, canDownload: true };
  },
  setSelectedProjectFile: (value: any) => { selected = value; },
  projectFileFromText: (path: any, content: any) => ({ path, kind: 'text', mime: 'text/plain', size: content.content.length, content, canDownload: true }),
  projectFileMime: () => 'text/plain',
  createFullFilePatch: () => 'patch', saveFile: async () => { patches++; },
  interruptSession: async () => { aborted = true; }, refreshServerFeatures: async () => {}, refreshVcsDiff: async () => {},
  connectionScope: 'scope', pendingNotificationKey: () => 'key',
  settingsRef: { current: { serverUrl: 'http://server', username: '' } }, getConnectionUiScope: () => 'scope',
  busyNotificationsRef: { current: new Set() }, promptSubmissionRef: { current: {} }, latestSubmissionRef: { current: {} }, setSendingState: () => {},
  clearPendingTaskFinishedNotification: async () => { throw new Error('storage unavailable'); },
  refreshSessions: async () => {}, refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
  exports: {},
};
runInNewContext(ts.transpileModule(`${declarations}\nexports.actions = { ${names.join(', ')} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const actions = context.exports.actions;
const projectProtocol = await loadTs('lib/opencode/project.ts', { '@/lib/compare-labels': { compareLabels: (a: any, b: any) => a.localeCompare(b) } });
context.projectPath = projectProtocol.projectPath;
const browserRuntime = hookRuntime();
const directoryReads = new Map();
const browserHook = await loadTs('providers/use-project-browser.ts', {
  react: browserRuntime.react,
  '@/lib/opencode/project': projectProtocol,
  '@/providers/services/project-service': {
    findFiles: context.findFiles,
    listFiles: (_: any, path: any) => { const gate = deferred(); directoryReads.set(path, gate); return gate.promise; },
  },
});
browserRuntime.mount(browserHook.useProjectBrowser, { client, isCurrentClient: (candidate: any) => candidate === active });
const searchFiles = (query: any) => browserRuntime.value.search(query);

const first = searchFiles('first'), last = searchFiles('last');
reads.get('last').resolve(['last.ts']); await last;
reads.get('first').resolve(['first.ts']); await first;
browserRuntime.flush();
assert.deepEqual(Array.from(browserRuntime.value.results), ['last.ts'], 'older searches cannot replace newer results');
const firstDirectory = browserRuntime.value.openDirectory('src');
const lastDirectory = browserRuntime.value.openDirectory('docs');
directoryReads.get('docs').resolve([{ path: 'docs/guide.md', name: 'guide.md', type: 'file' }]); await lastDirectory;
directoryReads.get('src').resolve([{ path: 'src/old.ts', name: 'old.ts', type: 'file' }]); await firstDirectory;
browserRuntime.flush();
assert.equal(browserRuntime.value.path, 'docs');
assert.equal(browserRuntime.value.entries[0].path, 'docs/guide.md');
await assert.rejects(browserRuntime.value.openDirectory('../outside'), /Invalid project path/);
await searchFiles(''); browserRuntime.flush();
assert.equal(browserRuntime.value.path, 'docs', 'clearing search retains the browsed directory');

// The picker renders the projects opened on this connection; the server
// catalog seeds and validates them. A path the server still resolves (a
// worktree or a deep link) is kept and opened, an unlisted one is dropped.
let projectCatalog: any = {
  currentProjectPath: '/workspace/main-clone',
  serverRootPath: '/workspace',
  serverProjects: [{ id: 'project-1', worktree: '/workspace/main-clone', time: { created: 1 } }],
};
let knownProjectLocation = false;
const projectCatalogHook = await loadTs('providers/use-project-catalog-actions.ts', {
  react: { useCallback: (fn: any) => fn, useEffect: () => {}, useRef: (current: any) => ({ current }) },
  '@/lib/opencode/client': { buildClient: () => ({}) },
  '@/providers/session-cache': { hydrateSessionCache: () => {} },
  '@/providers/projects-storage': { PROJECTS_MAX: 50 },
  '@/providers/services/session-service': {
    loadProjectCatalog: async () => projectCatalog,
    resolveProjectLocation: async () => ({ worktree: '/workspace/added' }),
    isKnownProjectLocation: async () => knownProjectLocation,
  },
});
function makeProjectCatalogActions(activePath: any, isCurrent = () => true, openedPaths?: any) {
  const state: any = { activePath, cleared: 0, projects: [], currentPath: undefined, opened: openedPaths ? { scope: [...openedPaths] } : {} };
  const activeProjectPathRef = { current: activePath };
  const serverProjectsRef = { current: [] };
  const projectPathsByConnectionRef = { current: state.opened };
  const scopeGenerationRef = { current: 0 };
  state.actions = projectCatalogHook.useProjectCatalogActions({
    client: { __opencode: { contract: 'v2' } },
    catalogClient: { __opencode: { contract: 'v2' } },
    isCurrentClient: isCurrent,
    isCurrentCatalogClient: isCurrent,
    activeProjectPathRef,
    setActiveProjectPath: (path: any) => { state.activePath = path; activeProjectPathRef.current = path; },
    clearProjectState: () => { state.cleared++; },
    projectPathsByConnectionRef, setProjectPathsByConnection: (value: any) => { state.opened = value; projectPathsByConnectionRef.current = value; },
    serverProjectsRef, setServerProjects: (projects: any) => { state.projects = projects; serverProjectsRef.current = projects; },
    setCurrentProjectPath: (path: any) => { state.currentPath = path; }, setServerRootPath: () => {},
    connectionScope: 'scope', connectionScopeRef: { current: 'scope' }, isHydrated: false,
    setSessions: () => {}, setSessionStatuses: () => {}, setIsRefreshingProjectCatalog: () => {},
    scopeGenerationRef, serverContract: 'v2', settingsRef: { current: {} },
  });
  state.scopeGenerationRef = scopeGenerationRef;
  return state;
}
const seededProject = makeProjectCatalogActions(undefined);
await seededProject.actions.refreshProjectCatalog();
assert.equal(seededProject.activePath, '/workspace/main-clone', 'a fresh connection seeds the server current project');
assert.deepEqual([...seededProject.opened.scope], ['/workspace/main-clone'], 'seeding opens the selected project');
const droppedProject = makeProjectCatalogActions('/workspace/other-clone', () => true, ['/workspace/main-clone']);
await droppedProject.actions.refreshProjectCatalog();
assert.equal(droppedProject.activePath, '/workspace/main-clone', 'an unlisted project falls back to the most recent opened project');
assert.equal(droppedProject.cleared, 1, 'dropping an unlisted project clears project state');
assert.equal(droppedProject.scopeGenerationRef.current, 1, 'dropping an unlisted project advances the project generation');
knownProjectLocation = true;
const retainedWorktree = makeProjectCatalogActions('/worktrees/task', () => true, ['/workspace/main-clone']);
await retainedWorktree.actions.refreshProjectCatalog();
assert.equal(retainedWorktree.activePath, '/worktrees/task', 'a server-resolved worktree remains selected');
assert.deepEqual([...retainedWorktree.opened.scope], ['/worktrees/task', '/workspace/main-clone'], 'keeping a worktree opens it for this connection');
assert.equal(retainedWorktree.cleared, 0, 'a server-resolved worktree does not clear project state');
assert.equal(retainedWorktree.scopeGenerationRef.current, 0, 'a server-resolved worktree does not advance the project generation');
knownProjectLocation = false;
const openedProject = makeProjectCatalogActions(undefined, () => true, ['/workspace/other-clone']);
await openedProject.actions.refreshProjectCatalog();
assert.equal(openedProject.activePath, '/workspace/other-clone', 'a fresh selection prefers the most recent opened project');
assert.equal(openedProject.opened.scope[0], '/workspace/other-clone');
const closedAll = makeProjectCatalogActions(undefined, () => true, []);
await closedAll.actions.refreshProjectCatalog();
assert.equal(closedAll.activePath, undefined, 'a connection with every project closed stays empty');
assert.deepEqual([...closedAll.opened.scope], [], 'an explicitly empty list does not re-seed from the server');
projectCatalog = { ...projectCatalog, currentProjectPath: undefined };
const firstListedProject = makeProjectCatalogActions(undefined);
await firstListedProject.actions.refreshProjectCatalog();
assert.equal(firstListedProject.activePath, '/workspace/main-clone', 'the first server project seeds an empty connection');
projectCatalog = { ...projectCatalog, currentProjectPath: '/workspace/main-clone' };
const staleProjectResponse = makeProjectCatalogActions('/workspace/other-clone', () => false, ['/workspace/other-clone']);
await staleProjectResponse.actions.refreshProjectCatalog();
assert.equal(staleProjectResponse.activePath, '/workspace/other-clone');
assert.equal(staleProjectResponse.projects.length, 0, 'stale catalog responses remain ignored');
const addedWorktree = makeProjectCatalogActions('/workspace/main-clone', () => true, ['/workspace/main-clone']);
assert.equal(await addedWorktree.actions.addProject('/worktrees/task'), '/worktrees/task');
assert.equal(addedWorktree.activePath, '/worktrees/task', 'adding a directory selects the requested worktree rather than its owning project root');
assert.deepEqual([...addedWorktree.opened.scope], ['/worktrees/task', '/workspace/main-clone'], 'adding a directory opens it for this connection');
const olderFile = actions.openProjectFile('selection-first'), newerFile = actions.openProjectFile('selection-last');
fileReads.get('selection-last').resolve({ type: 'text', content: 'latest selection' }); await newerFile;
fileReads.get('selection-first').resolve({ type: 'text', content: 'obsolete selection' });
await assert.rejects(olderFile, /superseded/);
assert.equal(selected.path, 'selection-last');
const staleSearch = searchFiles('old-server');
const staleDirectory = browserRuntime.value.openDirectory('old-server');
const staleFile = actions.openProjectFile('old-server');
const staleSave = actions.saveProjectFile('save', 'original', 'edited');
active = { __opencode: { directory: '/repo' } };
browserRuntime.update({ client: active });
directoryReads.get('old-server').resolve([{ path: 'old-server/wrong.ts', name: 'wrong.ts', type: 'file' }]);
await staleDirectory; browserRuntime.flush();
assert.equal(browserRuntime.value.initialized, false, 'a stale folder response cannot initialize the new server browser');
reads.get('old-server').resolve(['wrong-server.ts']); fileGate.resolve({ type: 'text', content: 'wrong server' }); saveGate.resolve({ type: 'text', content: 'original' });
await staleSearch;
await assert.rejects(staleFile, /superseded/); await assert.rejects(staleSave, /project changed/);
browserRuntime.update({ client: active });
assert.equal(browserRuntime.value.initialized, false, 'a different server with the same path resets the browser');
assert.deepEqual(Array.from(browserRuntime.value.results), []); assert.equal(selected.path, 'selection-last'); assert.equal(patches, 0);

// Guarded saves reject conflicts and verify the exact post-write content.
active = client;
let bytes = 'original';
context.readFile = async () => ({ type: 'text', content: bytes });
context.saveFile = async (_: any, path: any, content: any) => { patches++; bytes = content; };
await assert.rejects(actions.saveProjectFile('save', 'obsolete', 'draft'), /changed on the server/);
assert.equal(patches, 0, 'a known conflict must never write');
await actions.saveProjectFile('save', 'original', 'edited');
assert.equal(bytes, 'edited'); assert.equal(selected.content.content, 'edited');
context.saveFile = async () => { throw new Error('write offline'); };
await assert.rejects(actions.saveProjectFile('save', 'edited', 'draft'), /write offline/);
assert.equal(selected.content.content, 'edited', 'a failed write must not replace the saved baseline');
context.saveFile = async () => { bytes = 'external edit'; };
await assert.rejects(actions.saveProjectFile('save', 'edited', 'draft'), /did not match/);
assert.equal(selected.content.content, 'edited', 'failed verification must not replace the saved baseline');

await actions.abortSession('s');
assert.equal(aborted, true, 'notification storage failure must not prevent aborting server work');

// The bounded transcript keeps an independent, replay-safe usage/plan ledger.
const ledgerHelpers: any = {
  ...await loadTs('lib/opencode/usage.ts'),
  ...await loadTs('lib/opencode/format/todos.ts'),
  ...await loadTs('lib/opencode/format/window.ts'),
};
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
assert.equal(ledgerHelpers.deriveTodosFromMessages(todoLedger.s)[0].status, 'completed', 'loading older pages cannot revert the current plan');
assert.equal(usageLedger.s.length, 2, 'updated/replayed calls must not duplicate usage');
assert.ok(Math.abs(ledgerHelpers.aggregateUsageSteps(usageLedger.s).cost - 0.3) < 1e-10);

// Real realtime hook: connected busy polling, reconnect reconciliation,
// backpressure, stable subscriptions, and cancellation of reconnect timers.
const runtime = hookRuntime();
let events: any[] = [], wake: any, subscriptions = 0, sessionsRefreshed = 0, pendingRefreshed = 0;
let heldRefresh: any;
const catalogClient = { api: { event: { async subscribe({ signal }: any) {
  subscriptions++;
  return (async function* () {
    while (!signal.aborted) {
      const incoming = await new Promise((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
      if (!incoming) return;
      yield incoming;
    }
  })();
} } } };
const realtime = await loadTs('providers/use-opencode-realtime.ts', {
  ...realtimeDeps,
  '@/providers/realtime-timing': { SSE_STALENESS_MS: 90000, SSE_FOREGROUND_CYCLE_MS: 15000, WATCHDOG_TICK_MS: 7000 },
  react: runtime.react,
  'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
  '@/lib/opencode/client/errors': { classifyConnectionFailure: () => 'unknown', isAuthConnectionFailure: () => false },
  '@/lib/opencode/events': { subscribeEvents: async function* (client: any, signal: any) { yield* await client.api.event.subscribe({ signal }); } },
}, runtime.globals);
assert.equal(realtime.shouldPoll(true, false), false);
assert.equal(realtime.shouldPoll(true, true), true);
assert.equal(realtime.shouldPoll(false, false), true);
let nativeSurfacesRefreshed = 0;
const inputs = {
  refreshNativeSurfaces: async () => { nativeSurfacesRefreshed++; },
  catalogClient, activeProjectPath: '/repo', connected: true, busy: false, currentSessionId: 's',
  onEvent: (event: any) => events.push(event.type),
  refreshSessions: async () => { sessionsRefreshed++; await heldRefresh?.promise; },
  refreshPendingInteractions: async () => { pendingRefreshed++; },
  refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
};
runtime.mount(realtime.useOpencodeRealtime, inputs); await runtime.settle();
wake({ location: { directory: '/repo' }, type: 'server.connected' }); await runtime.settle();
assert.equal(runtime.value.eventStreamStatus, 'connected'); assert.equal(sessionsRefreshed, 1); assert.equal(pendingRefreshed, 1);
assert.equal(runtime.countTimers(5000), 0, 'idle connected SSE needs no safety poll');
runtime.update({ busy: true }); runtime.fire(10000); await runtime.settle(); assert.equal(sessionsRefreshed, 2);
heldRefresh = deferred(); runtime.fire(10000); await runtime.settle(); runtime.fire(10000); await runtime.settle();
assert.equal(sessionsRefreshed, 3, 'slow reconciliation cannot overlap with another tick');
heldRefresh.resolve(); heldRefresh = undefined; await runtime.settle();
runtime.update({ refreshMessages: async () => {} }); await runtime.settle(); assert.equal(subscriptions, 1, 'changing action identities must not reopen SSE');
wake(null); await runtime.settle(); assert.equal(runtime.value.eventStreamStatus, 'error');
runtime.fire(1000); await runtime.settle(); assert.equal(subscriptions, 2);
wake({ location: { directory: '/another-project' }, type: 'server.connected' }); await runtime.settle();
assert.equal(sessionsRefreshed, 4); assert.equal(pendingRefreshed, 4, 'reconnection always recovers pending interactions');
assert.equal(nativeSurfacesRefreshed, 4, 'widget reconciliation follows first connect, safety polls and reconnects');
assert.deepEqual(events, ['server.connected'], 'other-project events are filtered');
wake(null); await runtime.settle(); runtime.unmount(); assert.equal(runtime.countTimers(1000), 0);

// SSE liveness: a stream that goes silent without an error is re-established
// once per staleness window, a long background return re-verifies the stream,
// and a reconnect reconcile is queued behind an in-flight safety poll.
{
  const liveness = hookRuntime();
  let now = 1_000_000, subscriptions = 0, wake: any, sessions = 0, pending = 0, heldSessions: any;
  const messageModes: any[] = [];
  const listeners = new Set<any>();
  const client = { api: { event: { async subscribe({ signal }: any) {
    subscriptions++;
    return (async function* () {
      while (!signal.aborted) {
        const incoming = await new Promise((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
        if (incoming === null) return;
        yield incoming;
      }
    })();
  } } } };
  const appState = { currentState: 'active', addEventListener: (_event: any, listener: any) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } };
  const hook = await loadTs('providers/use-opencode-realtime.ts', {
    ...realtimeDeps,
    '@/providers/realtime-timing': { SSE_STALENESS_MS: 90000, SSE_FOREGROUND_CYCLE_MS: 15000, WATCHDOG_TICK_MS: 7000 },
    react: liveness.react,
    'react-native': { AppState: appState },
    '@/lib/opencode/client/errors': { classifyConnectionFailure: () => 'unknown', isAuthConnectionFailure: () => false },
    '@/lib/opencode/events': { subscribeEvents: async function* (instance: any, signal: any) { yield* await instance.api.event.subscribe({ signal }); } },
  }, { ...liveness.globals, Date: class extends Date { static now() { return now; } } });
  const inputs = {
    catalogClient: client, activeProjectPath: '/repo', connected: true, busy: false, currentSessionId: 's',
    onEvent: () => {}, refreshSessions: async () => { sessions++; await heldSessions?.promise; },
    refreshPendingInteractions: async () => { pending++; },
    refreshMessages: async (_id: any, _silent: any, options: any) => { messageModes.push(options?.mode); },
    refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
  };
  liveness.mount(hook.useOpencodeRealtime, inputs); await liveness.settle();
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await liveness.settle();
  assert.equal(liveness.value.eventStreamStatus, 'connected');
  assert.equal(subscriptions, 1); assert.equal(sessions, 1); assert.equal(pending, 1);
  now += 89_000; liveness.fire(7000); await liveness.settle();
  assert.equal(subscriptions, 1, 'a stream inside the staleness window is left alone');
  now += 2_000; liveness.fire(7000); await liveness.settle();
  assert.equal(subscriptions, 2, 'a silent stream is re-established after the window');
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await liveness.settle();
  assert.equal(liveness.value.eventStreamStatus, 'connected');
  [...listeners].forEach((listener: any) => listener('background'));
  now += 16_000;
  [...listeners].forEach((listener: any) => listener('active'));
  await liveness.settle();
  assert.equal(subscriptions, 3, 'a long background return re-verifies the stream');
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await liveness.settle();
  messageModes.length = 0;
  heldSessions = deferred<void>();
  liveness.update({ busy: true }); liveness.fire(10000); await liveness.settle();
  assert.deepEqual(messageModes, [undefined], 'the busy safety poll tails the transcript');
  wake(null); await liveness.settle(); liveness.fire(1000); await liveness.settle();
  assert.equal(subscriptions, 4);
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await liveness.settle();
  assert.deepEqual(messageModes, [undefined], 'the reconnect reconcile waits for the in-flight poll');
  heldSessions.resolve(undefined); heldSessions = undefined; await liveness.settle();
  assert.deepEqual(messageModes, [undefined, undefined], 'the reconnect reconcile cannot be swallowed by the poll');
  // A short background return must still re-assert domain data even though the
  // stream stayed up and no restart/rebuild is requested.
  const sessionsBeforeForeground = sessions;
  [...listeners].forEach((listener: any) => listener('background'));
  now += 1_000;
  [...listeners].forEach((listener: any) => listener('active'));
  await liveness.settle();
  assert.equal(subscriptions, 4, 'a short background return keeps the live stream');
  assert.ok(sessions > sessionsBeforeForeground, 'a foreground return re-asserts sessions without a restart');
  liveness.unmount();
}

// Revocation: an authentication failure stops the stream, notifies the
// provider once, and never enters the reconnect loop.
{
  const revoked = hookRuntime();
  let fatal = 0, subscriptions = 0;
  const client = { api: { event: { async subscribe() { subscriptions++; throw new Error('401 credentials rejected'); } } } };
  const hook = await loadTs('providers/use-opencode-realtime.ts', {
    ...realtimeDeps,
    '@/providers/realtime-timing': { SSE_STALENESS_MS: 90000, SSE_FOREGROUND_CYCLE_MS: 15000, WATCHDOG_TICK_MS: 7000 },
    react: revoked.react,
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@/lib/opencode/client/errors': {
      classifyConnectionFailure: (error: any) => /401|credential/i.test(String(error?.message)) ? 'auth' : 'unknown',
      isAuthConnectionFailure: (kind: any) => kind === 'auth' || kind === 'entitlement',
    },
    '@/lib/opencode/events': { subscribeEvents: async function* (instance: any, signal: any) { yield* await instance.api.event.subscribe({ signal }); } },
  }, revoked.globals);
  revoked.mount(hook.useOpencodeRealtime, {
    catalogClient: client, activeProjectPath: '/repo', connected: true, busy: true, currentSessionId: 's',
    onFatalError: (kind: any) => { fatal++; assert.equal(kind, 'auth'); },
    onEvent: () => {}, refreshSessions: async () => {}, refreshPendingInteractions: async () => {},
    refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
  });
  await revoked.settle();
  assert.equal(revoked.value.eventStreamStatus, 'error');
  assert.equal(fatal, 1); assert.equal(subscriptions, 1);
  revoked.fire(1000); await revoked.settle(); revoked.fire(15000); await revoked.settle();
  assert.equal(subscriptions, 1, 'revoked credentials must not retry the stream');
  assert.equal(fatal, 1, 'the provider is notified once');
  revoked.unmount();
}

// Conversation state machine runs against stubbed speech/platform boundaries.
const voiceRuntime = hookRuntime();
let recognitionOptions: any, speechCallbacks: any, onConversationAppStateChange: any, sends = 0, aborts = 0;
let lastPrompt;
let listening = false;
let localWakeOptions: any;
let localCommandOptions: any;
let localWakeStarts = 0;
let localCommandStarts = 0;
let localWakeStartResult = true;
const sendGate = deferred<void>();
let permissionRequests: any;
const startSpeech = async () => {
  if (permissionRequests) {
    const permission = deferred();
    permissionRequests.push(permission);
    await permission.promise;
  }
  listening = true; return true;
};
const abortSpeech = () => { listening = false; aborts++; };
const selectors = await loadTs('providers/opencode-provider-selectors.ts', {
  '@/lib/opencode/format': { toTranscriptEntry: (record: any) => record, getHistoryPreview: () => '' },
  '@/lib/opencode/transcript': { hasMessageBubble: (entry: any) => Boolean(entry.text), getTranscriptActivityLabel: () => undefined },
});
const speechConfig = await loadTs('lib/voice/speech-config.ts', {}, voiceRuntime.globals);
const conversationImports = {
  react: voiceRuntime.react,
  'react-native': { AppState: { addEventListener: (_event: any, callback: any) => { onConversationAppStateChange = callback; return { remove() {} }; } } },
  '@/lib/opencode/format': { toTranscriptEntry: (record: any) => record },
  '@/lib/opencode/transcript': { isTranscriptDisplayMessage: (entry: any) => Boolean(entry.text) },
  '@/lib/voice/speech-output': { stopSpeaking: async () => {}, speakText: async (options: any) => { speechCallbacks = options; options.onStart(); return true; } },
  '@/lib/voice/speech-config': speechConfig,
  '@/lib/voice/confirmation': await loadTs('lib/voice/confirmation.ts', {}, voiceRuntime.globals),
  '@/lib/voice/use-speech-input': { useSpeechInput: (options: any) => { recognitionOptions = options; return { abort: abortSpeech, start: startSpeech, isListening: listening, isStarting: false, level: 0 }; } },
  '@/lib/voice/local-wake-word/types': await loadTs('lib/voice/local-wake-word/types.ts', {}, voiceRuntime.globals),
  '@/lib/voice/use-local-wake-word': {
    useLocalWakeWord: (options: any) => {
      localWakeOptions = options;
      return {
        available: true,
        level: 0,
        refreshAvailability: () => true,
        start: async () => { localWakeStarts += 1; return localWakeStartResult; },
        status: 'idle',
        stop: async () => {},
      };
    },
  },
  '@/lib/voice/use-local-command-capture': {
    useLocalCommandCapture: (options: any) => {
      if (!options.finishOnFirstTurn) localCommandOptions = options;
      return {
        start: async () => { localCommandStarts += 1; return true; },
        stop: async () => {},
      };
    },
  },
  '@/lib/voice/wake-feedback': { playWakePhraseCue: () => {} },
  '@/lib/voice/wake-phrase': await loadTs('lib/voice/wake-phrase.ts', {}, voiceRuntime.globals),
  '@/lib/voice/working-sound': { stopWorkingSoundAsync: async () => {} },
  '@/providers/conversation/use-conversation-snapshot': {
    useConversationSnapshot: (input: any) => {
      const phaseInput = !input.wakePhraseRequired && input.conversationInputPhase === 'listening' && input.conversationReadbackPhase !== 'idle'
        ? 'armed'
        : input.conversationInputPhase;
      const phase = phaseInput === 'listening' || phaseInput === 'submitting' || phaseInput === 'confirming'
        ? phaseInput
        : input.conversationReadbackPhase === 'speaking'
          ? 'speaking'
          : input.conversationReadbackPhase === 'waiting'
            ? 'waiting'
            : phaseInput;
      return {
        active: input.conversationInputPhase !== 'off',
        confirmation: input.conversationConfirmation,
        feedback: input.conversationFeedback,
        feedbackAction: input.conversationFeedbackAction,
        inputPhase: input.conversationInputPhase,
        isListening: input.conversationInputPhase === 'listening',
        level: input.conversationListeningLevel,
        latestHeardText: input.conversationLatestHeardText,
        phase,
        readbackPhase: input.conversationReadbackPhase,
        sessionId: input.conversationSessionId,
        statusLabel: phase === 'armed' ? 'Waiting for phrase' : undefined,
        wakePhrase: input.wakePhrase,
        wakePhraseRequired: input.wakePhraseRequired,
      };
    },
  },
  '@/providers/opencode-provider-selectors': selectors,
  '@/providers/opencode-provider-types': { CONVERSATION_COMMAND_TIMEOUT_MS: 6000, CONVERSATION_FINAL_RESULT_SETTLE_MS: 2200, CONVERSATION_KEEP_AWAKE_TAG: 'test', CONVERSATION_LISTENING_RESTART_MS: 350 },
  '@/providers/use-conversation-keep-awake': { useConversationKeepAwake: () => {} },
};
const conversationFeedback = await loadTs('providers/conversation/feedback.ts', {}, voiceRuntime.globals);
const conversationTimers = await loadTs('providers/conversation/use-conversation-timers.ts', {
  react: voiceRuntime.react,
  '@/lib/voice/wake-phrase': conversationImports['@/lib/voice/wake-phrase'],
  '@/providers/conversation/feedback': conversationFeedback,
  '@/providers/opencode-provider-types': { CONVERSATION_COMMAND_TIMEOUT_MS: 6000, CONVERSATION_FINAL_RESULT_SETTLE_MS: 2200 },
}, voiceRuntime.globals);
const conversationArming = await loadTs('providers/conversation/use-conversation-arming.ts', {
  react: voiceRuntime.react,
  '@/lib/voice/wake-phrase': conversationImports['@/lib/voice/wake-phrase'],
  '@/lib/voice/working-sound': conversationImports['@/lib/voice/working-sound'],
  '@/providers/conversation/feedback': conversationFeedback,
}, voiceRuntime.globals);
const localWakeController = await loadTs('providers/conversation/use-local-wake-controller.ts', {
  react: voiceRuntime.react,
  '@/lib/voice/local-wake-word/types': conversationImports['@/lib/voice/local-wake-word/types'],
  '@/lib/voice/use-local-command-capture': conversationImports['@/lib/voice/use-local-command-capture'],
  '@/lib/voice/use-local-wake-word': conversationImports['@/lib/voice/use-local-wake-word'],
  '@/lib/voice/wake-feedback': conversationImports['@/lib/voice/wake-feedback'],
  '@/lib/voice/wake-phrase': conversationImports['@/lib/voice/wake-phrase'],
  '@/providers/conversation/feedback': conversationFeedback,
}, voiceRuntime.globals);
const conversationListening = await loadTs('providers/conversation/use-conversation-listening.ts', { ...conversationImports, '@/providers/conversation/feedback': conversationFeedback }, voiceRuntime.globals);
const conversationPlayback = await loadTs('providers/conversation/use-conversation-playback.ts', { ...conversationImports, '@/providers/conversation/feedback': conversationFeedback }, voiceRuntime.globals);
const conversationReadbackInput = await loadTs('providers/conversation/use-conversation-readback-input.ts', { react: voiceRuntime.react }, voiceRuntime.globals);
const conversationSubmit = await loadTs('providers/conversation/use-conversation-submit.ts', { react: voiceRuntime.react, '@/providers/conversation/feedback': conversationFeedback }, voiceRuntime.globals);
const conversationConnection = await loadTs('providers/conversation/use-conversation-connection.ts', { ...conversationImports, '@/providers/conversation/feedback': conversationFeedback }, voiceRuntime.globals);
const assistantEntries = await loadTs('providers/conversation/assistant-entries.ts', {
  '@/lib/opencode/format': conversationImports['@/lib/opencode/format'],
  '@/lib/opencode/transcript': conversationImports['@/lib/opencode/transcript'],
}, voiceRuntime.globals);
const useAssistantEntries = await loadTs('providers/conversation/use-conversation-assistant-entries.ts', {
  react: voiceRuntime.react,
  '@/providers/conversation/assistant-entries': assistantEntries,
}, voiceRuntime.globals);
const confirmationTypes = await loadTs('providers/conversation/confirmation-types.ts', {}, voiceRuntime.globals);
const useLatest = await loadTs('providers/conversation/use-latest.ts', { react: voiceRuntime.react }, voiceRuntime.globals);
const confirmationActions = await loadTs('providers/conversation/use-conversation-confirmation-actions.ts', {
  react: voiceRuntime.react,
  '@/providers/conversation/feedback': conversationFeedback,
}, voiceRuntime.globals);
const confirmation = await loadTs('providers/conversation/use-conversation-confirmation.ts', {
  react: voiceRuntime.react,
  '@/lib/i18n': { i18n: {
    getFixedT: () => (key: string, args?: { command?: string }) => args?.command ? `${key}:${args.command}` : key,
    t: (key: string, args?: { command?: string }) => args?.command ? `${key}:${args.command}` : key,
  } },
  '@/lib/voice/confirmation': conversationImports['@/lib/voice/confirmation'],
  '@/lib/voice/speech-config': speechConfig,
  '@/lib/voice/speech-output': conversationImports['@/lib/voice/speech-output'],
  '@/providers/conversation/confirmation-types': confirmationTypes,
  '@/providers/conversation/feedback': conversationFeedback,
  '@/providers/conversation/use-latest': useLatest,
}, voiceRuntime.globals);
const sessionControl = await loadTs('providers/conversation/use-conversation-session-control.ts', {
  react: voiceRuntime.react,
  '@/lib/voice/working-sound': conversationImports['@/lib/voice/working-sound'],
  '@/providers/conversation/feedback': conversationFeedback,
}, voiceRuntime.globals);
const conversation = await loadTs('providers/use-conversation-state.ts', {
  ...conversationImports,
  '@/providers/conversation/feedback': conversationFeedback,
  '@/providers/conversation/use-conversation-arming': conversationArming,
  '@/providers/conversation/use-conversation-assistant-entries': useAssistantEntries,
  '@/providers/conversation/use-conversation-confirmation': confirmation,
  '@/providers/conversation/use-conversation-confirmation-actions': confirmationActions,
  '@/providers/conversation/use-conversation-session-control': sessionControl,
  '@/providers/conversation/use-conversation-listening': conversationListening,
  '@/providers/conversation/use-conversation-playback': conversationPlayback,
  '@/providers/conversation/use-conversation-readback-input': conversationReadbackInput,
  '@/providers/conversation/use-conversation-submit': conversationSubmit,
  '@/providers/conversation/use-conversation-connection': conversationConnection,
  '@/providers/conversation/use-conversation-timers': conversationTimers,
  '@/providers/conversation/use-local-wake-controller': localWakeController,
}, voiceRuntime.globals);
const appearance = await loadTs('constants/appearance.ts');
const autoModelPreferences = await loadTs('lib/auto-model/preferences.ts');
const chatPreferences = {
  ...(await loadTs('providers/opencode-preferences.ts', { '@/constants/appearance': appearance, '@/lib/auto-model/preferences': autoModelPreferences, '@/lib/voice/wake-phrase': { DEFAULT_WAKE_PHRASE: 'hey code' }, '@/lib/voice/local-wake-word/types': { DEFAULT_LOCAL_WAKE_PHRASE: 'hey-code', DEFAULT_LOCAL_COMMAND_MODEL: 'moonshine-tiny-en' } })).defaultChatPreferences,
  // The legacy flow assertions cover direct submission; confirmation has its
  // own block below.
  confirmVoiceCommands: false,
};
voiceRuntime.mount(conversation.useConversationState, {
  connection: { status: 'connected', message: 'ready' }, chatPreferences, currentSessionId: 's', setCurrentSessionId: () => {},
  sessionStatuses: { s: { type: 'busy' } }, messagesBySession: {}, pendingPermissionsBySession: {}, pendingQuestionsBySession: {},
  sendingState: { active: false }, ensureActiveSession: async () => 's', sendPrompt: async (_sessionId: any, prompt: any) => { sends++; lastPrompt = prompt; await sendGate.promise; return true; },
});
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
  assert.deepEqual(JSON.parse(JSON.stringify(recognitionOptions.contextualStrings)), [expectedPhrase]);
}

// The phrase gate is the only way into a turn. Noise without the phrase is
// discarded, a split phrase still matches, and only the suffix is submitted.
await startConversation();
recognitionOptions.onResult('background chatter', true);
await voiceRuntime.settle();
assert.equal(phase(), 'armed', 'noise without the wake phrase cannot start a turn');
assert.equal(voiceRuntime.value.conversation.latestHeardText, undefined);
recognitionOptions.onResult('hey', true);
recognitionOptions.onResult('code open settings', true);
await voiceRuntime.settle();
assert.equal(phase(), 'listening');
assert.equal(voiceRuntime.value.conversation.latestHeardText, 'open settings');
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 1);
assert.equal(lastPrompt, 'open settings', 'the wake phrase is stripped from the prompt');

sendGate.resolve(); await voiceRuntime.settle();
assert.equal(phase(), 'waiting');
assert.equal(voiceRuntime.value.conversation.inputPhase, 'armed', 'input re-arms while the reply is still pending');
assert.equal(voiceRuntime.value.conversation.readbackPhase, 'waiting');
voiceRuntime.update({ sessionStatuses: { s: { type: 'idle' } }, messagesBySession: { s: [
  { id: 'interim', role: 'assistant', text: 'On it', details: [] },
  { id: 'reply', role: 'assistant', text: 'done', details: [] },
] } });
await voiceRuntime.settle(); assert.equal(phase(), 'speaking');
voiceRuntime.fire(120); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.inputPhase, 'armed');
assert.equal(voiceRuntime.value.conversation.readbackPhase, 'speaking');
assert.equal(speechCallbacks.text, 'done', 'only the final assistant bubble is read');
speechCallbacks.onDone(); await voiceRuntime.settle(); assert.equal(phase(), 'armed');
assert.equal(voiceRuntime.value.conversation.readbackPhase, 'idle');

// A phrase-only turn opens the command window and re-arms when nothing follows.
await startConversation();
recognitionOptions.onResult('hey code', true);
await voiceRuntime.settle();
assert.equal(phase(), 'listening');
assert.equal(voiceRuntime.value.conversation.latestHeardText, undefined);
voiceRuntime.fire(6000); await voiceRuntime.settle();
assert.equal(phase(), 'armed');
assert.match(voiceRuntime.value.conversation.feedback, /did not catch a command/);
assert.equal(sends, 1);
voiceRuntime.value.clearConversationFeedback();

// Interims revise the active command instead of appending duplicated words.
await startConversation();
recognitionOptions.onResult('hey code open', false);
recognitionOptions.onResult('hey code open settings', false);
await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.latestHeardText, 'open settings');
recognitionOptions.onResult('hey code open settings', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'open settings'); assert.equal(sends, 2);

// A command may continue across finalized segments after the phrase.
await startConversation();
recognitionOptions.onResult('hey code count to', true);
await voiceRuntime.settle();
assert.equal(phase(), 'listening');
recognitionOptions.onResult('three', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'count to three'); assert.equal(sends, 3);

// An end without a final checkpoints an unfinished command and submits it.
await startConversation();
recognitionOptions.onResult('hey code run tests', false);
recognitionOptions.onEnd();
await voiceRuntime.settle();
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'run tests'); assert.equal(sends, 4);

// A recognition end while armed preserves only the phrase tail, so a phrase
// split across the restart still matches.
await startConversation();
recognitionOptions.onResult('hey', true);
recognitionOptions.onEnd(); abortSpeech();
await voiceRuntime.update({}); voiceRuntime.fire(350); await voiceRuntime.settle();
assert.equal(phase(), 'armed');
assert.equal(sends, 4);
recognitionOptions.onResult('code after restart', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'after restart'); assert.equal(sends, 5);

// A canceled or backgrounded turn cannot leak late events into the next one.
await startConversation();
recognitionOptions.onResult('hey code discard this turn', false);
await stopConversation();
recognitionOptions.onEnd(); recognitionOptions.onResult('late final', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 5);
for (const appState of ['inactive', 'background']) {
  await startConversation();
  recognitionOptions.onResult('hey code unsent background instruction', true);
  onConversationAppStateChange(appState); await voiceRuntime.settle();
  if (appState === 'inactive') {
    assert.equal(phase(), 'listening', 'inactive does not cancel a turn');
  } else {
    assert.equal(phase(), 'off');
    recognitionOptions.onEnd();
    voiceRuntime.fire(350); voiceRuntime.fire(2200); await voiceRuntime.settle();
    assert.equal(sends, 5, 'a background-canceled turn cannot restart or submit after end');
    assert.equal(voiceRuntime.countTimers(2200), 0);
    assert.equal(voiceRuntime.countTimers(6000), 0);
  }
}

// The configured phrase is normalized and reaches the recognizer as vocabulary.
voiceRuntime.update({ chatPreferences: { ...chatPreferences, conversationWakePhrase: '  hey    bot ' } });
await startConversation('hey bot');
recognitionOptions.onResult('hey bot run tests', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
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
recognitionOptions.onResult('hey code one startup, one intact turn', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'one startup, one intact turn');
assert.equal(sends, 7, 'the pending startup keeps its conversation session');

// A recognition end after the phrase keeps the command window open; the user
// does not have to repeat the wake phrase for the command.
await startConversation();
recognitionOptions.onResult('hey code', true);
recognitionOptions.onEnd(); abortSpeech();
await voiceRuntime.update({}); voiceRuntime.fire(350); await voiceRuntime.settle();
assert.equal(phase(), 'listening');
recognitionOptions.onResult('open settings', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'open settings');
assert.equal(sends, 8, 'the preserved command window appends to the matched phrase');

// Local mode wakes through the on-device detector, then captures only the
// command with the OS recognizer.
await stopConversation();
voiceRuntime.update({ chatPreferences: { ...chatPreferences, voiceWakeMode: 'local' } });
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(phase(), 'armed');
assert.equal(localWakeStarts, 1, 'arming starts the local detector');
localWakeOptions.onWake();
await voiceRuntime.settle();
assert.equal(phase(), 'listening');
assert.equal(localCommandStarts, 1, 'the verified wake starts local command capture');
localCommandOptions.onPartialCommand('open settings');
await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.latestHeardText, 'open settings');
localCommandOptions.onCommand('open settings');
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
assert.match(voiceRuntime.value.conversation.feedback, /phrase gate/);
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
voiceRuntime.update({ chatPreferences });
localWakeStartResult = true;

// Opting into progress updates reads completed interim bubbles before the final
// settled reply while input stays armed.
voiceRuntime.update({
  chatPreferences: { ...chatPreferences, readInterimAssistantReplies: true },
  messagesBySession: {},
  sessionStatuses: { s: { type: 'busy' } },
});
await startConversation();
recognitionOptions.onResult('hey code fetch news', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
const interimReply = {
  id: 'on-it', role: 'assistant', text: 'On it', details: [],
  info: { id: 'on-it', sessionID: 's', role: 'assistant', time: { created: 1, completed: 2 }, finish: 'stop' },
};
voiceRuntime.update({ messagesBySession: { s: [interimReply] } });
await voiceRuntime.settle(); voiceRuntime.fire(120); await voiceRuntime.settle();
assert.equal(phase(), 'speaking');
assert.equal(speechCallbacks.text, 'On it');
const finalReply = {
  id: 'final', role: 'assistant', text: 'Here is the news', details: [],
  info: { id: 'final', sessionID: 's', role: 'assistant', time: { created: 3, completed: 4 }, finish: 'stop' },
};
voiceRuntime.update({ messagesBySession: { s: [interimReply, finalReply] }, sessionStatuses: { s: { type: 'idle' } } });
await voiceRuntime.settle();
speechCallbacks.onDone(); await voiceRuntime.settle();
voiceRuntime.fire(120); await voiceRuntime.settle();
assert.equal(speechCallbacks.text, 'Here is the news', 'the settled final reply is queued after progress readback');
speechCallbacks.onDone(); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.readbackPhase, 'idle');
await stopConversation();
voiceRuntime.update({ chatPreferences, messagesBySession: {}, sessionStatuses: { s: { type: 'idle' } } });

voiceRuntime.update({ pendingQuestionsBySession: { s: [{ id: 'question' }] } });
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle(); assert.equal(phase(), 'off');
assert.match(voiceRuntime.value.conversation.feedback, /Answer the current request/);
// A captured system command is gated by confirmation when the preference is
// enabled. TTS completion + the echo guard is the only path to the confirmation
// recognizer, and confirmation speech never reaches OpenCode.
await stopConversation();
voiceRuntime.update({ chatPreferences: { ...chatPreferences, confirmVoiceCommands: true }, pendingQuestionsBySession: {} });
await startConversation();
recognitionOptions.onResult('hey code refactor the login component', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(phase(), 'confirming');
assert.equal(voiceRuntime.value.conversation.confirmation?.phase, 'prompting');
assert.equal(sends, 10, 'an unconfirmed command is not sent');
voiceRuntime.fire(120); await voiceRuntime.settle();
assert.match(speechCallbacks.text, /refactor the login component/);
speechCallbacks.onDone(); await voiceRuntime.settle();
voiceRuntime.fire(300); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.confirmation?.phase, 'listening');
recognitionOptions.onResult('yes', true);
await voiceRuntime.settle();
assert.equal(lastPrompt, 'refactor the login component');
assert.equal(sends, 11, 'the confirmed command is sent once');
recognitionOptions.onResult('yes', true);
await voiceRuntime.settle();
assert.equal(sends, 11, 'confirmation speech cannot become a second prompt');
await stopConversation();
// No-wake mode still requires confirmation when it is enabled.
voiceRuntime.update({
  chatPreferences: { ...chatPreferences, wakePhraseRequired: false, confirmVoiceCommands: true, voiceWakeMode: 'phrase' },
});
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(phase(), 'listening');
recognitionOptions.onResult('run tests', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(phase(), 'confirming');
assert.equal(sends, 11, 'no-wake ambient command is not sent before confirmation');
voiceRuntime.value.conversation.confirmation?.actions.cancel();
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
recognitionOptions.onResult('open settings', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'open settings');
assert.equal(sends, 12);
voiceRuntime.update({
  messagesBySession: { s: [{ id: 'no-wake-reply', role: 'assistant', text: 'done', details: [] }] },
  sessionStatuses: { s: { type: 'idle' } },
});
await voiceRuntime.settle(); voiceRuntime.fire(120); await voiceRuntime.settle();
assert.equal(phase(), 'speaking', 'no-wake listening still yields to reply readback');
assert.equal(speechCallbacks.text, 'done');
speechCallbacks.onDone(); await voiceRuntime.settle();
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
localCommandOptions.onCommand('open settings');
await voiceRuntime.settle();
assert.equal(lastPrompt, 'open settings');
assert.equal(sends, 13);
await stopConversation();
voiceRuntime.update({ chatPreferences });
voiceRuntime.unmount(); assert.equal(voiceRuntime.countTimers(2200), 0); assert.equal(voiceRuntime.countTimers(6000), 0); assert.ok(aborts > 0);

// Profile orchestration stays provider-owned and serializes metadata/credentials.
const profileRuntime = hookRuntime();
let storedProfiles: any[] = [], profileId = 0, failMetadata = false, failCredential = false, updates = 0;
const passwords = new Map();
const profileHeaders = new Map();
const profileUrls = await loadTs('lib/opencode/client/url.ts', { './types': { defaultConnectionSettings: { serverUrl: 'http://127.0.0.1:4096' } } });
const profilesHook = await loadTs('providers/use-connection-profiles.ts', {
  '@/lib/opencode/client/url': profileUrls,
  '@/lib/opencode/client/probe': { probeConnection: async () => ({ status: 'detected', contract: 'v2' }) },
  '@/lib/opencode/pairing': { resolveLocalPairing: async () => ({ serverUrl: 'http://example.test', username: '', password: 'session-token' }) },
  react: profileRuntime.react,
  '@/lib/connection-profiles': {
    createProfileId: () => `profile-${++profileId}`,
    loadConnectionProfiles: async () => [...storedProfiles],
    mutateConnectionProfiles: async (operation: any) => operation([...storedProfiles], async (next: any) => { if (failMetadata) throw new Error('metadata failed'); storedProfiles = next; }),
    getProfilePassword: async (id: any) => passwords.get(id) ?? '',
    saveProfilePassword: async (id: any, password: any) => { if (failCredential) throw new Error('secure storage failed'); passwords.set(id, password); },
    deleteProfilePassword: async (id: any) => { passwords.delete(id); },
    findMatchingProfile: (entries: any, settings: any) => entries.find((p: any) => p.serverUrl === settings.serverUrl),
  },
  '@/lib/connection-headers': {
    getProfileHeaders: async (id: any) => profileHeaders.get(id) ?? {},
    saveProfileHeaders: async (id: any, headers: any) => { if (failCredential) throw new Error('secure storage failed'); if (headers && Object.keys(headers).length) profileHeaders.set(id, headers); else profileHeaders.delete(id); },
    deleteProfileHeaders: async (id: any) => { profileHeaders.delete(id); },
  },
});
profileRuntime.mount(profilesHook.useConnectionProfiles, {
  settings: { serverUrl: 'current' }, switchConnection: async () => {}, updateSettings: () => { updates++; },
});
const [savedA, savedB] = await Promise.all([
  profileRuntime.value.save({ name: 'A', serverUrl: 'a', username: 'alice', password: 'a-secret', headers: { 'CF-Access-Client-Id': 'a-client' } }),
  profileRuntime.value.save({ name: 'B', serverUrl: 'b', username: 'bob', password: 'b-secret', headers: { 'CF-Access-Client-Id': 'b-client' } }),
]);
await profileRuntime.settle();
assert.equal(storedProfiles.length, 2); assert.equal(updates, 0, 'saving a new inactive profile cannot change the active settings');
assert.deepEqual(profileHeaders.get(savedA.id), { 'CF-Access-Client-Id': 'a-client' }, 'gateway headers stay in secure storage');
assert.equal(JSON.stringify(storedProfiles).includes('a-client'), false, 'profile metadata never carries header values');
failCredential = true;
await assert.rejects(profileRuntime.value.save({ name: 'edited', serverUrl: 'a', username: 'alice', password: 'session-token', headers: {} }, savedA.id), /secure storage failed/);
assert.equal(storedProfiles.find((entry: any) => entry.id === savedA.id).name, 'A', 'credential failures leave profile metadata intact');
assert.equal(passwords.get(savedA.id), 'a-secret');
failCredential = false;
failMetadata = true;
await assert.rejects(profileRuntime.value.save({ name: 'edited', serverUrl: 'a', username: 'alice', password: 'new-secret', headers: { 'CF-Access-Client-Id': 'new-client' } }, savedA.id), /metadata failed/);
assert.equal(passwords.get(savedA.id), 'a-secret', 'failed metadata writes restore the previous credential');
assert.deepEqual(profileHeaders.get(savedA.id), { 'CF-Access-Client-Id': 'a-client' }, 'failed metadata writes restore the previous headers');
failMetadata = false;
profileRuntime.update({ settings: { serverUrl: 'a' } });
await assert.rejects(profileRuntime.value.remove(savedA.id), /active connection/);
await profileRuntime.value.remove(savedB.id); await profileRuntime.settle();
assert.equal(storedProfiles.length, 1); assert.equal(passwords.has(savedB.id), false);
assert.equal(profileHeaders.has(savedB.id), false, 'removing a profile clears its gateway headers');
const named = await profileRuntime.value.save({ name: '  ', serverUrl: 'https://EXAMPLE.test:8443/proxy', username: '', password: 'session-token' });
assert.equal(named.name, 'example.test');
assert.equal(passwords.get(named.id), 'session-token');
assert.equal('password' in storedProfiles.find((entry: any) => entry.id === named.id), false);
assert.equal(updates, 0, 'setup saves and probes leave the current connection untouched');
assert.equal((await profileRuntime.value.probe({ serverUrl: 'http://example.test', username: '', password: '' })).status, 'detected');
assert.equal((await profileRuntime.value.pair('code')).password, 'session-token');
await profileRuntime.settle();
const stableProfiles = profileRuntime.value;
profileRuntime.update({ switchConnection: async () => {} });
assert.equal(profileRuntime.value, stableProfiles, 'profile domain values remain stable when only callback bridges change');
profileRuntime.unmount();

// Actual session callbacks: refresh an explicit target missing from an
// otherwise populated cache and preserve deep-link resolution.
const sessionNames = ['ensureActiveSession', 'openDeepLinkSession'];
const sessionDeclarations = [
  extractDeclarations(sessionActionsSource, ['ensureActiveSession']),
  extractDeclarations(connectionActionsSource, ['waitForConnectionScope', 'switchToScope', 'openDeepLinkSession']),
].join('\n');
let createdSessions = 0, fetchedSessions = 0;
const resolvableDirectories = new Set();
const target = { id: 'target' };
const sessionContext: any = {
  exports: {}, useCallback: (fn: any) => fn, client: { directory: '/repo' },
  activeProjectPath: '/repo', activeProjectPathRef: { current: '/repo' }, settingsRef: { current: {} },
  connection: { status: 'connected' }, connectionRef: { current: { status: 'connected' } },
  serverContractRef: { current: 'v1' }, serverGenerationRef: { current: 1 },
  buildClient: (settings: any) => settings,
  refreshSessions: async () => { fetchedSessions++; return [target]; }, refreshActiveSessions: async () => {},
  currentSessionId: undefined, sessions: [{ id: 'cached' }], sessionsRef: { current: [{ id: 'cached' }] }, messagesBySession: {},
  pendingDeepLinkTargetRef: { current: { sessionId: 'target', projectPath: '/repo' } },
  bootstrapPromiseRef: { current: null }, bootstrapTokenRef: {},
  lastSessionByConnection: {}, connectionScope: 'scope', createSession: async () => { createdSessions++; },
  explicitSessionSelectionRef: { current: undefined },
  setIsBootstrappingChat: () => {}, refreshMessages: async () => {}, refreshSessionDiff: async () => {},
  refreshSessionTodos: async () => {}, refreshPendingInteractions: async () => {}, refreshChatCapabilities: async () => {},
  refreshServerFeatures: async () => {}, refreshDiagnostics: async () => {}, isCurrentClient: () => true,
  setCurrentSessionId: (id: any) => { sessionContext.currentSessionIdRef.current = id; }, setLastSessionByConnection: () => {},
  deepLinkOperationRef: {}, currentSessionIdRef: {}, serverProjectsRef: { current: [{ worktree: '/repo' }] },
  projectPathsByConnectionRef: { current: { scope: [] } },
  isAvailableProjectDirectory: async (candidate: any) => resolvableDirectories.has(candidate.directory),
  connect: async () => {}, selectProject: (path: any) => { sessionContext.activeProjectPathRef.current = path; }, ensureActiveSessionRef: {}, setTimeout, Date,
  connectionScopeRef: { current: 'scope' },
  loadConnectionProfiles: async () => [{ id: 'saved', serverUrl: 'https://other', username: '', scope: 'other' }],
  findProfileByConnectionScope: (profiles: any, scope: any) => profiles.find((profile: any) => profile.scope === scope),
  getProfilePassword: async () => 'secret',
  switchConnection: async () => { sessionContext.connectionScopeRef.current = 'other'; sessionContext.serverGenerationRef.current++; },
};
runInNewContext(ts.transpileModule(`${sessionDeclarations}\nexports.actions = { ${sessionNames.join(', ')} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sessionContext);
const sessionActions = sessionContext.exports.actions;
fetchedSessions = 0;
assert.equal(await sessionActions.ensureActiveSession(), 'target'); assert.equal(fetchedSessions, 1);
assert.equal(createdSessions, 0);
sessionContext.pendingDeepLinkTargetRef.current = { sessionId: 'missing', projectPath: '/repo' };
sessionContext.bootstrapPromiseRef.current = null;
assert.equal(await sessionActions.ensureActiveSession(), undefined); assert.equal(createdSessions, 0);

// A retained active project may be absent from the server catalog.
sessionContext.serverProjectsRef.current = [{ worktree: '/elsewhere' }];
sessionContext.bootstrapPromiseRef.current = null;
sessionContext.ensureActiveSessionRef.current = sessionActions.ensureActiveSession;
assert.equal((await sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' })).ok, true,
  'explicit session opening accepts the retained active project');
assert.match((await sessionActions.openDeepLinkSession({ sessionId: 'missing', projectPath: '/repo' })).error,
  /was not found/, 'the retained project still requires an existing session');
assert.equal(createdSessions, 0, 'opening an existing session does not create a replacement');
assert.match((await sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/unlisted' })).error,
  /not available from the configured server/, 'other unlisted projects remain rejected');
assert.equal(sessionContext.pendingDeepLinkTargetRef.current, undefined);
sessionContext.serverProjectsRef.current = [{ worktree: '/repo' }];

// The same repository can have checkout directories that project.list() does
// not report as canonicals. The connection's opened list and server resolution
// both make those locations available.
sessionContext.projectPathsByConnectionRef.current = { scope: ['/opened-repo'] };
sessionContext.bootstrapPromiseRef.current = null;
assert.equal((await sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/opened-repo' })).ok, true,
  'opened projects remain available even when the server catalog reports another canonical');
sessionContext.activeProjectPathRef.current = '/repo';

sessionContext.projectPathsByConnectionRef.current = { scope: [] };
resolvableDirectories.add('/resolved-repo');
assert.equal((await sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/resolved-repo' })).ok, true,
  'server-resolved sibling checkouts and worktrees are available');
resolvableDirectories.delete('/resolved-repo');
sessionContext.activeProjectPathRef.current = '/repo';

assert.equal((await sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo', connectionScope: 'other' })).ok, true,
  'notification links select their owning saved connection before opening a session');
assert.match((await sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo', connectionScope: 'removed' })).error, /no longer exists/);

// A genuine supersession is cancellation of an earlier request, not a new URL.
const firstOpenGate = deferred<void>();
let opens = 0;
sessionContext.ensureActiveSessionRef.current = async () => {
  if (++opens === 1) { await firstOpenGate.promise; return 'first'; }
  sessionContext.currentSessionIdRef.current = 'second'; return 'second';
};
const firstOpen = sessionActions.openDeepLinkSession({ sessionId: 'first', projectPath: '/repo' });
assert.equal((await sessionActions.openDeepLinkSession({ sessionId: 'second', projectPath: '/repo' })).ok, true);
firstOpenGate.resolve(); assert.match((await firstOpen).error, /superseded/);
const switchedOpenGate = deferred<void>();
sessionContext.ensureActiveSessionRef.current = async () => { await switchedOpenGate.promise; return 'target'; };
const switchedOpen = sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' });
sessionContext.serverGenerationRef.current++; switchedOpenGate.resolve();
assert.equal((await switchedOpen).ok, false, 'server switch cannot complete an old session open');
assert.equal(sessionContext.pendingDeepLinkTargetRef.current, undefined);
const canceledOpenGate = deferred<void>();
sessionContext.ensureActiveSessionRef.current = async () => { await canceledOpenGate.promise; return 'target'; };
const openController = new AbortController();
const canceledOpen = sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' }, openController.signal);
openController.abort(); canceledOpenGate.resolve();
assert.equal((await canceledOpen).ok, false);
assert.equal(sessionContext.pendingDeepLinkTargetRef.current, undefined);

// Exercise the actual library runner without loading the native rendering tree.
const librarySource = await readFile(new URL('../../components/chat/chat-library.tsx', import.meta.url), 'utf8');
const libraryAst = ts.createSourceFile('library.tsx', librarySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const libraryBody = (libraryAst.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'ChatLibrary') as ts.FunctionDeclaration)!.body;
const runner = libraryBody!.statements.find((n: any) => ts.isFunctionDeclaration(n) && n.name?.text === 'run')!.getText(libraryAst);
let libraryError, completed = 0, executions = 0;
const libraryContext: any = { exports: {}, operationRef: {}, queuedOpenRef: {}, setBusyId: () => {}, setError: (error: any) => { libraryError = error; }, t: (key: any) => key };
runInNewContext(ts.transpileModule(`${runner}\nexports.run = run;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, libraryContext);
const libraryGate = deferred<void>();
const libraryRun = libraryContext.exports.run;
const firstLibraryRun = libraryRun('first', async () => { executions++; await libraryGate.promise; throw new Error('superseded'); });
await libraryRun('first', async () => { executions++; }); assert.equal(executions, 1, 'double taps cannot start another action');
libraryContext.operationRef.current = undefined; // dismiss the old overlay
await libraryRun('second', async () => {}, () => { completed++; });
libraryGate.resolve(); await firstLibraryRun;
assert.equal(completed, 1); assert.equal(libraryError, undefined, 'an old error cannot overwrite a newer successful opening');

const queuedGate = deferred<void>();
const queuedFirst = libraryRun('old', async () => { await queuedGate.promise; throw new Error('obsolete error'); }, () => { completed += 100; });
await libraryRun('middle', async () => { completed += 100; }, () => {});
await libraryRun('latest', async () => {}, () => { completed++; });
queuedGate.resolve(); await queuedFirst; await Promise.resolve();
assert.equal(completed, 2, 'only the latest queued target completes and closes');
assert.equal(libraryError, undefined);

// The CI favorite failure opened the right session with an empty transcript.
// Pruning must wait until bootstrap selects the session whose reads just landed.
let cachedMessages: any = { old: ['old transcript'], target: ['new transcript'] };
let cachedDiffs: any = { old: ['old diff'], target: ['new diff'] };
let cachedTodos: any = { old: ['old todo'], target: ['new todo'] };
const pruneInput: any = {
  isBootstrappingChat: true,
  pendingDeepLinkTargetRef: { current: { sessionId: 'target' } },
  currentSessionId: undefined,
  conversationSessionId: undefined,
  recentSessionIds: [],
  sessionStatuses: {},
  setMessagesBySession: (update: any) => { cachedMessages = update(cachedMessages); },
  setDiffsBySession: (update: any) => { cachedDiffs = update(cachedDiffs); },
  setTodosBySession: (update: any) => { cachedTodos = update(cachedTodos); },
  pruneTranscript: () => {},
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

// Real terminal orchestration: stale lists/input and failed removal cannot destroy an opened PTY.
{
  const runtime = hookRuntime(), client = {}, records = new Map(), listGate = deferred();
  let listed = [{ id: 'first', status: 'running' }], pendingList = false, rejectRemoval = false;
  const { useTerminalState } = await loadTs('providers/use-terminal-state.ts', {
    react: runtime.react,
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@/providers/services/terminal-service': {
      listTerminals: () => pendingList ? listGate.promise : Promise.resolve(listed),
      createTerminal: async () => ({ id: 'new' }), removeTerminal: async () => { if (rejectRemoval) throw new Error('Rejected'); },
    },
    './terminal-connection': { createTerminalConnection: ({ id, publish }: any) => {
      const record: any = { state: { id, generation: 0, status: 'connected' }, disposed: false, sent: [], reconnects: 0,
        foreground() {}, reconnect() { record.reconnects += 1; }, register: () => () => {}, resize() {},
        send(input: any) { record.sent.push(input); },
        exit() { record.state.status = 'exited'; publish(); }, dispose() { record.disposed = true; },
      };
      records.set(id, record); return record;
    } },
  });
  runtime.mount(useTerminalState, { client, isCurrentClient: () => true, serverUrl: 'http://example.test', directory: '/repo', serverContract: 'v1' });
  await runtime.value.openTerminal('first'); runtime.flush();
  const rotatedClient = {};
  runtime.update({ client: rotatedClient });
  assert.ok(records.get('first').reconnects >= 1, 'a rotated credential client reconnects the retained PTY');
  runtime.update({ client });
  pendingList = true;
  const refresh = runtime.value.refreshTerminals();
  await runtime.value.openTerminal('second'); runtime.flush();
  listGate.resolve(listed); await refresh; runtime.flush(); pendingList = false;
  assert.equal(records.get('second').state.status, 'connected', 'a list started before opening cannot exit the new PTY');
  const oldScope = runtime.value.terminalRuntime.scope;
  runtime.value.resetTerminal(); runtime.flush();
  assert.equal(records.get('first').disposed, true); assert.equal(records.get('second').disposed, true);
  await runtime.value.openTerminal('first'); runtime.flush();
  assert.throws(() => runtime.value.sendTerminalInput('first', 'stale', 0, oldScope), /scope changed/);
  assert.equal(records.get('first').sent.length, 0, 'a reused PTY ID cannot receive input queued in an old scope');
  rejectRemoval = true;
  await assert.rejects(runtime.value.closeTerminal('first'), /Rejected/); runtime.flush();
  assert.equal(runtime.value.activeTerminalId, 'first'); assert.equal(records.get('first').disposed, false);
  await runtime.value.openTerminal('second'); runtime.flush();
  await runtime.value.openTerminal('first'); runtime.flush();
  rejectRemoval = false; listed = [{ id: 'second', status: 'running' }];
  await runtime.value.closeTerminal('first'); runtime.flush();
  assert.equal(runtime.value.activeTerminalId, 'second'); assert.equal(records.get('first').disposed, true);
  runtime.unmount(); assert.equal(records.get('second').disposed, true);
}

  });
});
