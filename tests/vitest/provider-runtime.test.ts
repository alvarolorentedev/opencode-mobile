import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadTs, hookRuntime, deferred } from '../helpers/runtime.mjs';
import { describe, it } from 'vitest';
import { pruneByKeepIds } from '@/providers/opencode-provider-utils';

describe('provider runtime actions', () => {
  it('provider runtime actions', async () => {

// Exercise the real provider actions, including a server switch where the next
// server exposes the same directory as the previous server. The declarations
// now live in the extracted provider action hooks, so collect them by name from
// their new modules instead of the OpencodeProvider body.
async function readSource(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}
function extractDeclarations(source, names) {
  const ast = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      found.push(node.parent.parent.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found.join('\n');
}
function extractEffect(source, marker) {
  const ast = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found;
  function visit(node) {
    if (!found
      && ts.isExpressionStatement(node)
      && ts.isCallExpression(node.expression)
      && node.expression.expression.getText(ast) === 'useEffect'
      && node.getText(ast).includes(marker)) {
      found = node.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}
const projectActionsSource = await readSource('../../providers/use-project-file-actions.ts');
const promptLifecycleSource = await readSource('../../providers/use-prompt-lifecycle.ts');
const sessionActionsSource = await readSource('../../providers/use-session-bootstrap-actions.ts');
const connectionActionsSource = await readSource('../../providers/use-connection-link-actions.ts');
const providerEffectsSource = await readSource('../../providers/use-opencode-provider-effects.ts');
const names = [ 'openProjectFile', 'saveProjectFile', 'abortSession'];
const declarations = [
  extractDeclarations(projectActionsSource, ['openProjectFile', 'saveProjectFile']),
  extractDeclarations(promptLifecycleSource, ['abortSession']),
].join('\n');
let aborted = false;
const client = { __opencode: { directory: '/repo' }, session: { abort: async () => { aborted = true; } } };
let active = client, selected, patches = 0;
const reads = new Map(), fileReads = new Map();
const fileGate = deferred(), saveGate = deferred();
const context = {
  client, useCallback: (fn) => fn, projectSearchRequestRef: { current: 0 }, projectFileRequestRef: { current: 0 },
  activeProjectPathRef: { current: '/repo' }, isCurrentClient: (candidate) => candidate === active,
  currentSessionIdRef: {}, diffScopeBySessionRef: { current: {} },
  findFiles: (_, query) => { const gate = deferred(); reads.set(query, gate); return gate.promise; },
  readFile: (_, path) => {
    if (path.startsWith('selection-')) { const gate = deferred(); fileReads.set(path, gate); return gate.promise; }
    return path === 'save' ? saveGate.promise : fileGate.promise;
  },
  setSelectedProjectFile: (value) => { selected = value; },
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
const projectProtocol = await loadTs('lib/opencode/project.ts', { '@/lib/compare-labels': { compareLabels: (a, b) => a.localeCompare(b) } });
context.projectPath = projectProtocol.projectPath;
const browserRuntime = hookRuntime();
const directoryReads = new Map();
const browserHook = await loadTs('providers/use-project-browser.ts', {
  react: browserRuntime.react,
  '@/lib/opencode/project': projectProtocol,
  '@/providers/services/project-service': {
    findFiles: context.findFiles,
    listFiles: (_, path) => { const gate = deferred(); directoryReads.set(path, gate); return gate.promise; },
  },
});
browserRuntime.mount(browserHook.useProjectBrowser, { client, isCurrentClient: (candidate) => candidate === active });
const searchFiles = (query) => browserRuntime.value.search(query);

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
let projectCatalog = {
  currentProjectPath: '/workspace/main-clone',
  serverRootPath: '/workspace',
  serverProjects: [{ id: 'project-1', worktree: '/workspace/main-clone', time: { created: 1 } }],
};
let knownProjectLocation = false;
const projectCatalogHook = await loadTs('providers/use-project-catalog-actions.ts', {
  react: { useCallback: (fn) => fn, useEffect: () => {}, useRef: (current) => ({ current }) },
  '@/lib/opencode/client': { buildClient: () => ({}) },
  '@/providers/session-cache': { hydrateSessionCache: () => {} },
  '@/providers/projects-storage': { PROJECTS_MAX: 50 },
  '@/providers/services/session-service': {
    loadProjectCatalog: async () => projectCatalog,
    resolveProjectLocation: async () => ({ worktree: '/workspace/added' }),
    isKnownProjectLocation: async () => knownProjectLocation,
  },
});
function makeProjectCatalogActions(activePath, isCurrentCatalogClient = () => true, openedPaths) {
  const state = { activePath, cleared: 0, projects: [], currentPath: undefined, opened: openedPaths ? { scope: [...openedPaths] } : {} };
  const activeProjectPathRef = { current: activePath };
  const serverProjectsRef = { current: [] };
  const projectPathsByConnectionRef = { current: state.opened };
  const scopeGenerationRef = { current: 0 };
  state.actions = projectCatalogHook.useProjectCatalogActions({
    catalogClient: { __opencode: { contract: 'v2' } }, isCurrentCatalogClient, activeProjectPathRef,
    setActiveProjectPath: (path) => { state.activePath = path; activeProjectPathRef.current = path; },
    clearProjectState: () => { state.cleared++; },
    projectPathsByConnectionRef, setProjectPathsByConnection: (value) => { state.opened = value; projectPathsByConnectionRef.current = value; },
    serverProjectsRef, setServerProjects: (projects) => { state.projects = projects; serverProjectsRef.current = projects; },
    setCurrentProjectPath: (path) => { state.currentPath = path; }, setServerRootPath: () => {},
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
const removedProject = makeProjectCatalogActions('/workspace/main-clone', () => true, ['/workspace/main-clone', '/workspace/other-clone']);
removedProject.actions.removeProject('/workspace/main-clone');
assert.deepEqual([...removedProject.opened.scope], ['/workspace/other-clone'], 'closing a project drops it from the opened list');
assert.equal(removedProject.activePath, '/workspace/other-clone', 'closing the active project selects the most recent remaining one');
const removedLast = makeProjectCatalogActions('/workspace/main-clone', () => true, ['/workspace/main-clone']);
removedLast.actions.removeProject('/workspace/main-clone');
assert.deepEqual([...removedLast.opened.scope], [], 'closing the last project leaves an explicitly empty list');
assert.equal(removedLast.activePath, undefined, 'closing the last project clears the active selection');

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
context.saveFile = async (_, path, content) => { patches++; bytes = content; };
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
const transcriptSource = await readSource('../../providers/use-transcript-state.ts');
const ledgerHelpers = {
  ...await loadTs('lib/opencode/usage.ts'),
  ...await loadTs('lib/opencode/format/todos.ts'),
  ...await loadTs('lib/opencode/format/window.ts'),
};
let usageLedger = {}, todoLedger = {};
const ledgerContext = {
  ...ledgerHelpers, useCallback: (action) => action,
  setUsageStepsBySession: (update) => { usageLedger = update(usageLedger); },
  setTodoRecordsBySession: (update) => { todoLedger = update(todoLedger); }, exports: {},
};
const ledgerDeclaration = extractDeclarations(transcriptSource, ['recordUsageAndTodos']);
runInNewContext(ts.transpileModule(`${ledgerDeclaration}\nexports.record = recordUsageAndTodos;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, ledgerContext);
const ledgerMessage = (id, time, status, cost) => ({
  info: { id, role: 'assistant', time: { created: time }, providerID: 'p', modelID: 'm' },
  parts: [
    { type: 'tool', tool: 'todowrite', state: { status: 'completed', input: { todos: [{ content: 'Task', status }] } } },
    { id: 'usage', sessionID: 's', messageID: id, type: 'step-finish', cost, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
  ],
});
ledgerContext.exports.record('s', [ledgerMessage('new', 20, 'pending', 0)]);
ledgerContext.exports.record('s', [ledgerMessage('new', 20, 'completed', 0.2)]);
ledgerContext.exports.record('s', [ledgerMessage('old', 10, 'pending', 0.1)]);
ledgerContext.exports.record('s', [ledgerMessage('new', 20, 'completed', 0.2)]);
assert.equal(ledgerHelpers.deriveTodosFromMessages(todoLedger.s)[0].status, 'completed', 'loading older pages cannot revert the current plan');
assert.equal(usageLedger.s.length, 2, 'updated/replayed calls must not duplicate usage');
assert.ok(Math.abs(ledgerHelpers.aggregateUsageSteps(usageLedger.s).cost - 0.3) < 1e-10);

// Real realtime hook: connected busy polling, reconnect reconciliation,
// backpressure, stable subscriptions, and cancellation of reconnect timers.
const runtime = hookRuntime();
let events = [], wake, subscriptions = 0, sessionsRefreshed = 0, pendingRefreshed = 0;
let heldRefresh;
const catalogClient = { api: { event: { async subscribe({ signal }) {
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
  '@/providers/realtime-timing': { SSE_STALENESS_MS: 90000, SSE_FOREGROUND_CYCLE_MS: 15000, WATCHDOG_TICK_MS: 7000 },
  react: runtime.react,
  'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
  '@/lib/opencode/client/errors': { classifyConnectionFailure: () => 'unknown', isAuthConnectionFailure: () => false },
  '@/lib/opencode/events': { subscribeEvents: async function* (client, signal) { yield* await client.api.event.subscribe({ signal }); } },
}, runtime.globals);
assert.equal(realtime.shouldPoll(true, false), false);
assert.equal(realtime.shouldPoll(true, true), true);
assert.equal(realtime.shouldPoll(false, false), true);
let nativeSurfacesRefreshed = 0;
const inputs = {
  refreshNativeSurfaces: async () => { nativeSurfacesRefreshed++; },
  catalogClient, activeProjectPath: '/repo', connected: true, busy: false, currentSessionId: 's',
  onEvent: (event) => events.push(event.type),
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
  let now = 1_000_000, subscriptions = 0, wake, sessions = 0, pending = 0, heldSessions;
  const messageModes = [];
  const listeners = new Set();
  const client = { api: { event: { async subscribe({ signal }) {
    subscriptions++;
    return (async function* () {
      while (!signal.aborted) {
        const incoming = await new Promise((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
        if (incoming === null) return;
        yield incoming;
      }
    })();
  } } } };
  const appState = { currentState: 'active', addEventListener: (_event, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } };
  const hook = await loadTs('providers/use-opencode-realtime.ts', {
  '@/providers/realtime-timing': { SSE_STALENESS_MS: 90000, SSE_FOREGROUND_CYCLE_MS: 15000, WATCHDOG_TICK_MS: 7000 },
    react: liveness.react,
    'react-native': { AppState: appState },
    '@/lib/opencode/client/errors': { classifyConnectionFailure: () => 'unknown', isAuthConnectionFailure: () => false },
    '@/lib/opencode/events': { subscribeEvents: async function* (instance, signal) { yield* await instance.api.event.subscribe({ signal }); } },
  }, { ...liveness.globals, Date: class extends Date { static now() { return now; } } });
  const inputs = {
    catalogClient: client, activeProjectPath: '/repo', connected: true, busy: false, currentSessionId: 's',
    onEvent: () => {}, refreshSessions: async () => { sessions++; await heldSessions?.promise; },
    refreshPendingInteractions: async () => { pending++; },
    refreshMessages: async (_id, _silent, options) => { messageModes.push(options?.mode); },
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
  [...listeners].forEach((listener) => listener('background'));
  now += 16_000;
  [...listeners].forEach((listener) => listener('active'));
  await liveness.settle();
  assert.equal(subscriptions, 3, 'a long background return re-verifies the stream');
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await liveness.settle();
  messageModes.length = 0;
  heldSessions = deferred();
  liveness.update({ busy: true }); liveness.fire(10000); await liveness.settle();
  assert.deepEqual(messageModes, [undefined], 'the busy safety poll tails the transcript');
  wake(null); await liveness.settle(); liveness.fire(1000); await liveness.settle();
  assert.equal(subscriptions, 4);
  wake({ location: { directory: '/repo' }, type: 'server.connected' }); await liveness.settle();
  assert.deepEqual(messageModes, [undefined], 'the reconnect reconcile waits for the in-flight poll');
  heldSessions.resolve(); heldSessions = undefined; await liveness.settle();
  assert.deepEqual(messageModes, [undefined, undefined], 'the reconnect reconcile cannot be swallowed by the poll');
  // A short background return must still re-assert domain data even though the
  // stream stayed up and no restart/rebuild is requested.
  const sessionsBeforeForeground = sessions;
  [...listeners].forEach((listener) => listener('background'));
  now += 1_000;
  [...listeners].forEach((listener) => listener('active'));
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
  '@/providers/realtime-timing': { SSE_STALENESS_MS: 90000, SSE_FOREGROUND_CYCLE_MS: 15000, WATCHDOG_TICK_MS: 7000 },
    react: revoked.react,
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@/lib/opencode/client/errors': {
      classifyConnectionFailure: (error) => /401|credential/i.test(String(error?.message)) ? 'auth' : 'unknown',
      isAuthConnectionFailure: (kind) => kind === 'auth' || kind === 'entitlement',
    },
    '@/lib/opencode/events': { subscribeEvents: async function* (instance, signal) { yield* await instance.api.event.subscribe({ signal }); } },
  }, revoked.globals);
  revoked.mount(hook.useOpencodeRealtime, {
    catalogClient: client, activeProjectPath: '/repo', connected: true, busy: true, currentSessionId: 's',
    onFatalError: (kind) => { fatal++; assert.equal(kind, 'auth'); },
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
let recognitionOptions, speechCallbacks, onConversationAppStateChange, sends = 0, aborts = 0;
let lastPrompt;
let listening = false;
const sendGate = deferred();
let permissionRequests;
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
  '@/lib/opencode/format': { toTranscriptEntry: (record) => record, getHistoryPreview: () => '' },
  '@/lib/opencode/transcript': { isTranscriptDisplayMessage: (entry) => Boolean(entry.text), getTranscriptActivityLabel: () => undefined },
});
const conversationImports = {
  react: voiceRuntime.react,
  'react-native': { AppState: { addEventListener: (_event, callback) => { onConversationAppStateChange = callback; return { remove() {} }; } } },
  '@/lib/opencode/format': { toTranscriptEntry: (record) => record },
  '@/lib/opencode/transcript': { isTranscriptDisplayMessage: (entry) => Boolean(entry.text) },
  '@/lib/voice/speech-output': { stopSpeaking: async () => {}, speakText: async (options) => { speechCallbacks = options; options.onStart(); return true; } },
  '@/lib/voice/transcript-accumulate': await loadTs('lib/voice/transcript-accumulate.ts', {}, voiceRuntime.globals),
  '@/lib/voice/use-speech-input': { useSpeechInput: (options) => { recognitionOptions = options; return { abort: abortSpeech, start: startSpeech, isListening: listening, isStarting: false, level: 0 }; } },
  '@/lib/voice/working-sound': { stopWorkingSoundAsync: async () => {} },
  '@/providers/opencode-provider-selectors': selectors,
  '@/providers/opencode-provider-types': { CONVERSATION_FINAL_RESULT_SETTLE_MS: 2200, CONVERSATION_KEEP_AWAKE_TAG: 'test', CONVERSATION_LISTENING_RESTART_MS: 350 },
  '@/providers/use-conversation-keep-awake': { useConversationKeepAwake: () => {} },
};
const conversationFeedback = await loadTs('providers/conversation/feedback.ts', {}, voiceRuntime.globals);
const conversationListening = await loadTs('providers/conversation/use-conversation-listening.ts', { ...conversationImports, '@/providers/conversation/feedback': conversationFeedback }, voiceRuntime.globals);
const conversationPlayback = await loadTs('providers/conversation/use-conversation-playback.ts', { ...conversationImports, '@/providers/conversation/feedback': conversationFeedback }, voiceRuntime.globals);
const conversationConnection = await loadTs('providers/conversation/use-conversation-connection.ts', { ...conversationImports, '@/providers/conversation/feedback': conversationFeedback }, voiceRuntime.globals);
const conversation = await loadTs('providers/use-conversation-state.ts', {
  ...conversationImports,
  '@/providers/conversation/feedback': conversationFeedback,
  '@/providers/conversation/use-conversation-listening': conversationListening,
  '@/providers/conversation/use-conversation-playback': conversationPlayback,
  '@/providers/conversation/use-conversation-connection': conversationConnection,
}, voiceRuntime.globals);
const chatPreferences = (await loadTs('providers/opencode-preferences.ts')).defaultChatPreferences;
voiceRuntime.mount(conversation.useConversationState, {
  connection: { status: 'connected', message: 'ready' }, chatPreferences, currentSessionId: 's', setCurrentSessionId: () => {},
  sessionStatuses: { s: { type: 'busy' } }, messagesBySession: {}, pendingPermissionsBySession: {}, pendingQuestionsBySession: {},
  sendingState: { active: false }, ensureActiveSession: async () => 's', sendPrompt: async (_sessionId, prompt) => { sends++; lastPrompt = prompt; await sendGate.promise; return true; },
});
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.phase, 'listening');
recognitionOptions.onResult('voice prompt', true); voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 1);
voiceRuntime.update({ messagesBySession: { s: [] }, sendPrompt: async (_sessionId, prompt) => { sends++; lastPrompt = prompt; return true; } }); await voiceRuntime.settle();
assert.equal(sends, 1, 'a provider refresh cannot replay a submitted voice turn');
sendGate.resolve(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'waiting');
voiceRuntime.update({ sessionStatuses: { s: { type: 'idle' } }, messagesBySession: { s: [{ id: 'reply', role: 'assistant', text: 'done', details: [] }] } });
await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'speaking');
speechCallbacks.onDone(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'listening');
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'off');

// A recognizer session that ends after a short pause (no-speech / end event)
// schedules a listening restart. The restart must keep the pending final
// result and its settle timer alive, and the next session must continue the
// carried transcript instead of replacing it.
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.phase, 'listening');
recognitionOptions.onResult('first half', true);
recognitionOptions.onEnd();
abortSpeech();
await voiceRuntime.update({}); await voiceRuntime.settle();
voiceRuntime.fire(350); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.phase, 'listening');
recognitionOptions.onSpeechStart();
recognitionOptions.onResult('second half', false);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 1, 'unfinished speech cancels submission even after a finalized segment');
recognitionOptions.onResult('second half', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 2, 'a listening restart cannot discard the pending final result');
assert.equal(lastPrompt, 'first half second half');
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();

// Android keeps the session alive across a pause: each finalized segment is
// followed by fresh-segment results that must append to the accumulated
// transcript, never replace it, and resumed speech postpones the settle timer.
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.phase, 'listening');
recognitionOptions.onResult('what is the weather', true);
recognitionOptions.onResult('in paris', false);
await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.latestHeardText, 'what is the weather in paris', 'a fresh recognizer segment cannot reset the accumulated words');
recognitionOptions.onResult('in paris france', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 3, 'segment finals accumulate into one turn');
assert.equal(lastPrompt, 'what is the weather in paris france');
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();

// Matching words are intentional speech unless the recognizer proves replay.
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.phase, 'listening');
recognitionOptions.onResult('count to three', true);
recognitionOptions.onResult('three, four.', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'count to three three, four.', 'fresh speech must preserve repeated words');
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();

// An end without a final checkpoints the interim, including across multiple
// restarts. Same-session corrections still replace only the active segment.
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
recognitionOptions.onResult('Привет', false);
recognitionOptions.onEnd(); abortSpeech();
voiceRuntime.update({}); voiceRuntime.fire(350); await voiceRuntime.settle();
recognitionOptions.onSpeechStart();
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 4, 'speech onset cancels the previous endpoint timer before results arrive');
recognitionOptions.onResult('мир неверно', false);
recognitionOptions.onResult('мир', false);
recognitionOptions.onEnd(); abortSpeech();
voiceRuntime.update({}); voiceRuntime.fire(350); await voiceRuntime.settle();
recognitionOptions.onResult('你好', false);
recognitionOptions.onEnd(); abortSpeech();
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'Привет мир 你好', 'interims survive ends without finals and repeated restarts');
assert.equal(sends, 5);
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();

// A canceled turn and its late events cannot leak into the next turn.
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
recognitionOptions.onResult('discard this turn', false);
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
recognitionOptions.onEnd(); recognitionOptions.onResult('late final', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 5);
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
recognitionOptions.onResult('fresh turn', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'fresh turn');
assert.equal(sends, 6);
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();

// Permission alerts do not cancel listening, but actual backgrounding cancels
// both unfinished speech and an armed final timer before native end arrives.
for (const isFinal of [false, true]) {
  await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
  recognitionOptions.onResult('unsent background instruction', isFinal);
  onConversationAppStateChange('inactive'); await voiceRuntime.settle();
  assert.equal(voiceRuntime.value.conversation.phase, 'listening');
  onConversationAppStateChange('background'); await voiceRuntime.settle();
  assert.equal(voiceRuntime.value.conversation.phase, 'off');
  recognitionOptions.onEnd();
  voiceRuntime.fire(350); voiceRuntime.fire(2200); await voiceRuntime.settle();
  assert.equal(sends, 6, 'a background-canceled turn cannot restart or submit after end');
  assert.equal(voiceRuntime.countTimers(2200), 0);
}

// Repeated taps during permission startup must share one attempt, so a stale
// permission completion cannot abort a newer turn or clear its session ID.
permissionRequests = [];
const firstStart = voiceRuntime.value.toggleConversationMode();
await voiceRuntime.settle();
const duplicateStart = voiceRuntime.value.toggleConversationMode();
await voiceRuntime.settle();
assert.equal(permissionRequests.length, 1, 'only one conversation permission/start attempt may be pending');
permissionRequests[0].resolve();
await Promise.all([firstStart, duplicateStart]); await voiceRuntime.settle();
permissionRequests = undefined;
assert.equal(voiceRuntime.value.conversation.phase, 'listening');
recognitionOptions.onResult('one startup, one intact turn', true);
voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(lastPrompt, 'one startup, one intact turn');
assert.equal(sends, 7, 'the pending startup keeps its conversation session');
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();

voiceRuntime.update({ pendingQuestionsBySession: { s: [{ id: 'question' }] } });
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'off');
assert.match(voiceRuntime.value.conversation.feedback, /Answer the current request/);
voiceRuntime.unmount(); assert.equal(voiceRuntime.countTimers(2200), 0); assert.ok(aborts > 0);

// Profile orchestration stays provider-owned and serializes metadata/credentials.
const profileRuntime = hookRuntime();
let storedProfiles = [], profileId = 0, failMetadata = false, failCredential = false, updates = 0;
const passwords = new Map();
const profileUrls = await loadTs('lib/opencode/client/url.ts', { './types': { defaultConnectionSettings: { serverUrl: 'http://127.0.0.1:4096' } } });
const profilesHook = await loadTs('providers/use-connection-profiles.ts', {
  '@/lib/opencode/client/url': profileUrls,
  '@/lib/opencode/client/probe': { probeConnection: async () => ({ status: 'detected', contract: 'v2' }) },
  '@/lib/opencode/pairing': { resolveLocalPairing: async () => ({ serverUrl: 'http://example.test', username: '', password: 'session-token' }) },
  react: profileRuntime.react,
  '@/lib/connection-profiles': {
    createProfileId: () => `profile-${++profileId}`,
    loadConnectionProfiles: async () => [...storedProfiles],
    mutateConnectionProfiles: async (operation) => operation([...storedProfiles], async (next) => { if (failMetadata) throw new Error('metadata failed'); storedProfiles = next; }),
    getProfilePassword: async (id) => passwords.get(id) ?? '',
    saveProfilePassword: async (id, password) => { if (failCredential) throw new Error('secure storage failed'); passwords.set(id, password); },
    deleteProfilePassword: async (id) => { passwords.delete(id); },
    findMatchingProfile: (entries, settings) => entries.find((p) => p.serverUrl === settings.serverUrl),
  },
});
profileRuntime.mount(profilesHook.useConnectionProfiles, {
  settings: { serverUrl: 'current' }, switchConnection: async () => {}, updateSettings: () => { updates++; },
});
const [savedA, savedB] = await Promise.all([
  profileRuntime.value.save({ name: 'A', serverUrl: 'a', username: 'alice', password: 'a-secret' }),
  profileRuntime.value.save({ name: 'B', serverUrl: 'b', username: 'bob', password: 'b-secret' }),
]);
await profileRuntime.settle();
assert.equal(storedProfiles.length, 2); assert.equal(updates, 0, 'saving a new inactive profile cannot change the active settings');
failCredential = true;
await assert.rejects(profileRuntime.value.save({ name: 'edited', serverUrl: 'a', username: 'alice', password: 'session-token' }, savedA.id), /secure storage failed/);
assert.equal(storedProfiles.find((entry) => entry.id === savedA.id).name, 'A', 'credential failures leave profile metadata intact');
assert.equal(passwords.get(savedA.id), 'a-secret');
failCredential = false;
failMetadata = true;
await assert.rejects(profileRuntime.value.save({ name: 'edited', serverUrl: 'a', username: 'alice', password: 'new-secret' }, savedA.id), /metadata failed/);
assert.equal(passwords.get(savedA.id), 'a-secret', 'failed metadata writes restore the previous credential');
failMetadata = false;
profileRuntime.update({ settings: { serverUrl: 'a' } });
await assert.rejects(profileRuntime.value.remove(savedA.id), /active connection/);
await profileRuntime.value.remove(savedB.id); await profileRuntime.settle();
assert.equal(storedProfiles.length, 1); assert.equal(passwords.has(savedB.id), false);
const named = await profileRuntime.value.save({ name: '  ', serverUrl: 'https://EXAMPLE.test:8443/proxy', username: '', password: 'session-token' });
assert.equal(named.name, 'example.test');
assert.equal(passwords.get(named.id), 'session-token');
assert.equal('password' in storedProfiles.find((entry) => entry.id === named.id), false);
assert.equal(updates, 0, 'setup saves and probes leave the current connection untouched');
assert.equal((await profileRuntime.value.probe({ serverUrl: 'http://example.test', username: '', password: '' })).status, 'detected');
assert.equal((await profileRuntime.value.pair('code')).password, 'session-token');
await profileRuntime.settle();
const stableProfiles = profileRuntime.value;
profileRuntime.update({ switchConnection: async () => {} });
assert.equal(profileRuntime.value, stableProfiles, 'profile domain values remain stable when only callback bridges change');
profileRuntime.unmount();

// Actual session callbacks: restore in the row's project, preserve scope,
// and refresh an explicit target missing from an otherwise populated cache.
const sessionNames = ['restoreSession', 'ensureActiveSession', 'openDeepLinkSession'];
const sessionDeclarations = [
  extractDeclarations(sessionActionsSource, ['ensureActiveSession']),
  extractDeclarations(connectionActionsSource, ['waitForConnectionScope', 'switchToScope', 'restoreSession', 'openDeepLinkSession']),
].join('\n');
let restoreGate, restoreFailure, restoredDirectory, reopened, createdSessions = 0, fetchedSessions = 0;
const resolvableDirectories = new Set();
const target = { id: 'target' };
const sessionContext = {
  exports: {}, useCallback: (fn) => fn, client: { directory: '/repo' },
  activeProjectPath: '/repo', activeProjectPathRef: { current: '/repo' }, settingsRef: { current: {} },
  connection: { status: 'connected' }, connectionRef: { current: { status: 'connected' } },
  serverContractRef: { current: 'v1' }, serverGenerationRef: { current: 1 },
  buildClient: (settings) => settings,
  svcRestoreSession: async (candidate) => { restoredDirectory = candidate.directory; await restoreGate?.promise; if (restoreFailure) throw new Error('restore failed'); },
  refreshSessions: async () => {}, refreshArchivedSessions: async () => {}, refreshActiveSessions: async () => {},
  openSessionInProject: async (projectPath, id) => { reopened = { projectPath, id }; },
  currentSessionId: undefined, sessions: [{ id: 'cached' }], sessionsRef: { current: [{ id: 'cached' }] }, messagesBySession: {},
  pendingDeepLinkTargetRef: { current: { sessionId: 'target', projectPath: '/repo' } },
  bootstrapPromiseRef: { current: null }, bootstrapTokenRef: {},
  fetchSessions: async () => { fetchedSessions++; return [target]; },
  lastSessionByConnection: {}, connectionScope: 'scope', createSession: async () => { createdSessions++; },
  explicitSessionSelectionRef: { current: undefined },
  setIsBootstrappingChat: () => {}, refreshMessages: async () => {}, refreshSessionDiff: async () => {},
  refreshSessionTodos: async () => {}, refreshPendingInteractions: async () => {}, refreshChatCapabilities: async () => {},
  refreshServerFeatures: async () => {}, refreshDiagnostics: async () => {}, isCurrentClient: () => true,
  setCurrentSessionId: (id) => { sessionContext.currentSessionIdRef.current = id; }, setLastSessionByConnection: () => {},
  deepLinkOperationRef: {}, currentSessionIdRef: {}, serverProjectsRef: { current: [{ worktree: '/repo' }] },
  projectPathsByConnectionRef: { current: { scope: [] } },
  isAvailableProjectDirectory: async (candidate) => resolvableDirectories.has(candidate.directory),
  connect: async () => {}, selectProject: (path) => { sessionContext.activeProjectPathRef.current = path; }, ensureActiveSessionRef: {}, setTimeout, Date,
  connectionScopeRef: { current: 'scope' },
  loadConnectionProfiles: async () => [{ id: 'saved', serverUrl: 'https://other', username: '', scope: 'other' }],
  findProfileByConnectionScope: (profiles, scope) => profiles.find((profile) => profile.scope === scope),
  getProfilePassword: async () => 'secret',
  switchConnection: async () => { sessionContext.connectionScopeRef.current = 'other'; sessionContext.serverGenerationRef.current++; },
};
runInNewContext(ts.transpileModule(`${sessionDeclarations}\nexports.actions = { ${sessionNames.join(', ')} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sessionContext);
const sessionActions = sessionContext.exports.actions;
await sessionActions.restoreSession('target', { projectPath: '/elsewhere', open: true });
assert.equal(restoredDirectory, '/elsewhere'); assert.equal(reopened.id, 'target'); assert.equal(reopened.projectPath, '/elsewhere');
reopened = undefined; restoreFailure = true;
await assert.rejects(sessionActions.restoreSession('target', { projectPath: '/elsewhere', open: true }), /restore failed/);
assert.equal(reopened, undefined); restoreFailure = false;
restoreGate = deferred();
const switchingRestore = sessionActions.restoreSession('target', { open: true });
sessionContext.serverGenerationRef.current++; restoreGate.resolve();
await assert.rejects(switchingRestore, /connection changed/); assert.equal(reopened, undefined); restoreGate = undefined;
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
const firstOpenGate = deferred();
let opens = 0;
sessionContext.ensureActiveSessionRef.current = async () => {
  if (++opens === 1) { await firstOpenGate.promise; return 'first'; }
  sessionContext.currentSessionIdRef.current = 'second'; return 'second';
};
const firstOpen = sessionActions.openDeepLinkSession({ sessionId: 'first', projectPath: '/repo' });
assert.equal((await sessionActions.openDeepLinkSession({ sessionId: 'second', projectPath: '/repo' })).ok, true);
firstOpenGate.resolve(); assert.match((await firstOpen).error, /superseded/);
const switchedOpenGate = deferred();
sessionContext.ensureActiveSessionRef.current = async () => { await switchedOpenGate.promise; return 'target'; };
const switchedOpen = sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' });
sessionContext.serverGenerationRef.current++; switchedOpenGate.resolve();
assert.equal((await switchedOpen).ok, false, 'server switch cannot complete an old session open');
assert.equal(sessionContext.pendingDeepLinkTargetRef.current, undefined);
const canceledOpenGate = deferred();
sessionContext.ensureActiveSessionRef.current = async () => { await canceledOpenGate.promise; return 'target'; };
const openController = new AbortController();
const canceledOpen = sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' }, openController.signal);
openController.abort(); canceledOpenGate.resolve();
assert.equal((await canceledOpen).ok, false);
assert.equal(sessionContext.pendingDeepLinkTargetRef.current, undefined);

// Exercise the actual library runner without loading the native rendering tree.
const librarySource = await readFile(new URL('../../components/chat/chat-library.tsx', import.meta.url), 'utf8');
const libraryAst = ts.createSourceFile('library.tsx', librarySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const libraryBody = libraryAst.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'ChatLibrary').body;
const runner = libraryBody.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'run').getText(libraryAst);
let libraryError, completed = 0, executions = 0;
const libraryContext = { exports: {}, operationRef: {}, queuedOpenRef: {}, setBusyId: () => {}, setError: (error) => { libraryError = error; }, t: (key) => key };
runInNewContext(ts.transpileModule(`${runner}\nexports.run = run;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, libraryContext);
const libraryGate = deferred();
const libraryRun = libraryContext.exports.run;
const firstLibraryRun = libraryRun('first', async () => { executions++; await libraryGate.promise; throw new Error('superseded'); });
await libraryRun('first', async () => { executions++; }); assert.equal(executions, 1, 'double taps cannot start another action');
libraryContext.operationRef.current = undefined; // dismiss the old overlay
await libraryRun('second', async () => {}, () => { completed++; });
libraryGate.resolve(); await firstLibraryRun;
assert.equal(completed, 1); assert.equal(libraryError, undefined, 'an old error cannot overwrite a newer successful opening');

const queuedGate = deferred();
const queuedFirst = libraryRun('old', async () => { await queuedGate.promise; throw new Error('obsolete error'); }, () => { completed += 100; });
await libraryRun('middle', async () => { completed += 100; }, () => {});
await libraryRun('latest', async () => {}, () => { completed++; });
queuedGate.resolve(); await queuedFirst; await Promise.resolve();
assert.equal(completed, 2, 'only the latest queued target completes and closes');
assert.equal(libraryError, undefined);

// The CI favorite failure opened the right session with an empty transcript.
// Pruning must wait until bootstrap selects the session whose reads just landed.
const pruneEffect = extractEffect(providerEffectsSource, 'const keepIds = new Set<string>()');
let cachedMessages = { old: ['old transcript'], target: ['new transcript'] };
let cachedDiffs = { old: ['old diff'], target: ['new diff'] };
let cachedTodos = { old: ['old todo'], target: ['new todo'] };
let prune;
const pruneContext = {
  useEffect: (effect) => { prune = effect; }, currentSessionId: undefined, conversationSessionId: undefined,
  sessionStatuses: {}, isBootstrappingChat: true, pendingDeepLinkTargetRef: { current: { sessionId: 'target' } },
  recentSessionIdsRef: { current: [] },
  setMessagesBySession: (update) => { cachedMessages = update(cachedMessages); },
  setDiffsBySession: (update) => { cachedDiffs = update(cachedDiffs); },
  setTodosBySession: (update) => { cachedTodos = update(cachedTodos); },
  pruneTranscript: () => {},
  pruneByKeepIds,
};
runInNewContext(ts.transpileModule(pruneEffect, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, pruneContext);
prune();
assert.deepEqual(cachedMessages.target, ['new transcript'], 'bootstrap reads cannot be evicted before selecting their target');
assert.deepEqual(cachedDiffs.target, ['new diff']); assert.deepEqual(cachedTodos.target, ['new todo']);
pruneContext.isBootstrappingChat = false;
pruneContext.pendingDeepLinkTargetRef.current = undefined;
pruneContext.currentSessionId = 'target';
cachedMessages.extra = []; cachedDiffs.extra = []; cachedTodos.extra = [];
prune();
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
      listTerminals: () => pendingList ? listGate.promise : Promise.resolve(listed), listShells: async () => [],
      createTerminal: async () => ({ id: 'new' }), removeTerminal: async () => { if (rejectRemoval) throw new Error('Rejected'); },
    },
    './terminal-connection': { createTerminalConnection: ({ id, publish }) => {
      const record = { state: { id, generation: 0, status: 'connected' }, disposed: false, sent: [], reconnects: 0,
        foreground() {}, reconnect() { record.reconnects += 1; }, register: () => () => {}, resize() {},
        send(input) { record.sent.push(input); },
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
