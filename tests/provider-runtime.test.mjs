import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadTs, hookRuntime, deferred } from './helpers/runtime.mjs';

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
const workspaceActionsSource = await readSource('../providers/use-workspace-file-actions.ts');
const promptLifecycleSource = await readSource('../providers/use-prompt-lifecycle.ts');
const sessionActionsSource = await readSource('../providers/use-session-bootstrap-actions.ts');
const connectionActionsSource = await readSource('../providers/use-connection-link-actions.ts');
const providerEffectsSource = await readSource('../providers/use-opencode-provider-effects.ts');
const names = [ 'openWorkspaceFile', 'saveWorkspaceFile', 'abortSession'];
const declarations = [
  extractDeclarations(workspaceActionsSource, ['openWorkspaceFile', 'saveWorkspaceFile']),
  extractDeclarations(promptLifecycleSource, ['abortSession']),
].join('\n');
let aborted = false;
const client = { __opencode: { directory: '/repo' }, session: { abort: async () => { aborted = true; } } };
let active = client, selected, patches = 0;
const reads = new Map(), fileReads = new Map();
const fileGate = deferred(), saveGate = deferred();
const context = {
  client, useCallback: (fn) => fn, workspaceSearchRequestRef: { current: 0 }, workspaceFileRequestRef: { current: 0 },
  activeProjectPathRef: { current: '/repo' }, isCurrentClient: (candidate) => candidate === active,
  currentSessionIdRef: {}, diffScopeBySessionRef: { current: {} },
  findFiles: (_, query) => { const gate = deferred(); reads.set(query, gate); return gate.promise; },
  readFile: (_, path) => {
    if (path.startsWith('selection-')) { const gate = deferred(); fileReads.set(path, gate); return gate.promise; }
    return path === 'save' ? saveGate.promise : fileGate.promise;
  },
  setSelectedWorkspaceFile: (value) => { selected = value; },
  createFullFilePatch: () => 'patch', applyVcsPatch: async () => { patches++; }, refreshServerFeatures: async () => {}, refreshVcsDiff: async () => {},
  connectionScope: 'scope', pendingNotificationKey: () => 'key', pendingNotificationsRef: { current: new Map() },
  busyNotificationsRef: { current: new Set() }, promptSubmissionRef: { current: {} }, setSendingState: () => {},
  clearPendingTaskFinishedNotification: async () => { throw new Error('storage unavailable'); },
  refreshSessions: async () => {}, refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
  exports: {},
};
runInNewContext(ts.transpileModule(`${declarations}\nexports.actions = { ${names.join(', ')} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const actions = context.exports.actions;
const workspaceProtocol = await loadTs('lib/opencode/workspace.ts', { '@/lib/compare-labels': { compareLabels: (a, b) => a.localeCompare(b) } });
context.workspacePath = workspaceProtocol.workspacePath;
const browserRuntime = hookRuntime();
const directoryReads = new Map();
const browserHook = await loadTs('providers/use-workspace-browser.ts', {
  react: browserRuntime.react,
  '@/lib/opencode/workspace': workspaceProtocol,
  '@/providers/services/workspace-service': {
    findFiles: context.findFiles,
    listFiles: (_, path) => { const gate = deferred(); directoryReads.set(path, gate); return gate.promise; },
  },
});
browserRuntime.mount(browserHook.useWorkspaceBrowser, { client, isCurrentClient: (candidate) => candidate === active });
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
await assert.rejects(browserRuntime.value.openDirectory('../outside'), /Invalid workspace path/);
await searchFiles(''); browserRuntime.flush();
assert.equal(browserRuntime.value.path, 'docs', 'clearing search retains the browsed directory');

// Catalog omissions must not discard the persisted, app-selected directory.
let workspaceCatalog = {
  currentProjectPath: '/workspace/main-clone',
  serverRootPath: '/workspace',
  serverProjects: [{ id: 'project-1', worktree: '/workspace/main-clone', time: { created: 1 } }],
};
const workspaceCatalogHook = await loadTs('providers/use-workspace-catalog-actions.ts', {
  react: { useCallback: (fn) => fn, useEffect: () => {}, useRef: (current) => ({ current }) },
  '@/lib/opencode/client': { buildClient: () => ({}) },
  '@/providers/session-cache': { hydrateSessionCache: () => {} },
  '@/providers/services/session-service': {
    loadWorkspaceCatalog: async () => workspaceCatalog,
    resolveWorkspace: async () => ({ worktree: '/workspace/added' }),
  },
});
function makeWorkspaceCatalogActions(activePath, isCurrentCatalogClient = () => true) {
  const state = { activePath, cleared: 0, projects: [], currentPath: undefined };
  const activeProjectPathRef = { current: activePath };
  const scopeGenerationRef = { current: 0 };
  state.actions = workspaceCatalogHook.useWorkspaceCatalogActions({
    catalogClient: {}, isCurrentCatalogClient, activeProjectPathRef,
    setActiveProjectPath: (path) => { state.activePath = path; activeProjectPathRef.current = path; },
    clearProjectState: () => { state.cleared++; },
    serverProjectsRef: { current: [] }, setServerProjects: (projects) => { state.projects = projects; },
    setCurrentProjectPath: (path) => { state.currentPath = path; }, setServerRootPath: () => {},
    connectionScope: 'scope', connectionScopeRef: { current: 'scope' }, isHydrated: false,
    setSessions: () => {}, setSessionStatuses: () => {}, setIsRefreshingWorkspaceCatalog: () => {},
    scopeGenerationRef, serverContract: 'v2', settingsRef: { current: {} },
  });
  state.scopeGenerationRef = scopeGenerationRef;
  return state;
}
const retainedWorkspace = makeWorkspaceCatalogActions('/workspace/other-clone');
await retainedWorkspace.actions.refreshWorkspaceCatalog();
assert.equal(retainedWorkspace.activePath, '/workspace/other-clone');
assert.equal(retainedWorkspace.cleared, 0, 'catalog omission does not clear selected workspace state');
assert.equal(retainedWorkspace.scopeGenerationRef.current, 0, 'catalog omission does not advance the project generation');
const serverCurrentWorkspace = makeWorkspaceCatalogActions(undefined);
await serverCurrentWorkspace.actions.refreshWorkspaceCatalog();
assert.equal(serverCurrentWorkspace.activePath, '/workspace/main-clone', 'a fresh selection prefers the server current project');
workspaceCatalog = { ...workspaceCatalog, currentProjectPath: undefined };
const firstListedWorkspace = makeWorkspaceCatalogActions(undefined);
await firstListedWorkspace.actions.refreshWorkspaceCatalog();
assert.equal(firstListedWorkspace.activePath, '/workspace/main-clone', 'a fresh selection falls back to the first listed project');
workspaceCatalog = { ...workspaceCatalog, currentProjectPath: '/workspace/main-clone' };
const staleWorkspaceResponse = makeWorkspaceCatalogActions('/workspace/other-clone', () => false);
await staleWorkspaceResponse.actions.refreshWorkspaceCatalog();
assert.equal(staleWorkspaceResponse.activePath, '/workspace/other-clone');
assert.equal(staleWorkspaceResponse.projects.length, 0, 'stale catalog responses remain ignored');
const addedWorktree = makeWorkspaceCatalogActions('/workspace/main-clone');
assert.equal(await addedWorktree.actions.addWorkspace('/worktrees/task'), '/worktrees/task');
assert.equal(addedWorktree.activePath, '/worktrees/task', 'adding a directory preserves the requested worktree rather than selecting its owning project root');

const olderFile = actions.openWorkspaceFile('selection-first'), newerFile = actions.openWorkspaceFile('selection-last');
fileReads.get('selection-last').resolve({ type: 'text', content: 'latest selection' }); await newerFile;
fileReads.get('selection-first').resolve({ type: 'text', content: 'obsolete selection' });
await assert.rejects(olderFile, /superseded/);
assert.equal(selected.path, 'selection-last');
const staleSearch = searchFiles('old-server');
const staleDirectory = browserRuntime.value.openDirectory('old-server');
const staleFile = actions.openWorkspaceFile('old-server');
const staleSave = actions.saveWorkspaceFile('save', 'original', 'edited');
active = { __opencode: { directory: '/repo' } };
browserRuntime.update({ client: active });
directoryReads.get('old-server').resolve([{ path: 'old-server/wrong.ts', name: 'wrong.ts', type: 'file' }]);
await staleDirectory; browserRuntime.flush();
assert.equal(browserRuntime.value.initialized, false, 'a stale folder response cannot initialize the new server browser');
reads.get('old-server').resolve(['wrong-server.ts']); fileGate.resolve({ type: 'text', content: 'wrong server' }); saveGate.resolve({ type: 'text', content: 'original' });
await staleSearch;
await assert.rejects(staleFile, /superseded/); await assert.rejects(staleSave, /workspace changed/);
browserRuntime.update({ client: active });
assert.equal(browserRuntime.value.initialized, false, 'a different server with the same path resets the browser');
assert.deepEqual(Array.from(browserRuntime.value.results), []); assert.equal(selected.path, 'selection-last'); assert.equal(patches, 0);

await actions.abortSession('s');
assert.equal(aborted, true, 'notification storage failure must not prevent aborting server work');

// Real realtime hook: connected busy polling, reconnect reconciliation,
// backpressure, stable subscriptions, and cancellation of reconnect timers.
const runtime = hookRuntime();
let events = [], wake, subscriptions = 0, sessionsRefreshed = 0, pendingRefreshed = 0;
let heldRefresh;
const catalogClient = { global: { async event({ signal }) {
  subscriptions++;
  return { stream: (async function* () {
    while (!signal.aborted) {
      const incoming = await new Promise((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
      if (!incoming) return;
      yield incoming;
    }
  })() };
} } };
const realtime = await loadTs('providers/use-opencode-realtime.ts', { react: runtime.react }, runtime.globals);
assert.equal(realtime.shouldPoll(true, false), false);
assert.equal(realtime.shouldPoll(true, true), true);
assert.equal(realtime.shouldPoll(false, false), true);
const inputs = {
  catalogClient, activeProjectPath: '/repo', connected: true, busy: false, currentSessionId: 's',
  onEvent: (event) => events.push(event.type),
  refreshSessions: async () => { sessionsRefreshed++; await heldRefresh?.promise; },
  refreshPendingInteractions: async () => { pendingRefreshed++; },
  refreshMessages: async () => {}, refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {},
};
runtime.mount(realtime.useOpencodeRealtime, inputs); await runtime.settle();
wake({ directory: '/repo', payload: { type: 'server.connected', properties: {} } }); await runtime.settle();
assert.equal(runtime.value.eventStreamStatus, 'connected'); assert.equal(sessionsRefreshed, 1); assert.equal(pendingRefreshed, 1);
assert.equal(runtime.countTimers(5000), 0, 'idle connected SSE needs no safety poll');
runtime.update({ busy: true }); runtime.fire(10000); await runtime.settle(); assert.equal(sessionsRefreshed, 2);
heldRefresh = deferred(); runtime.fire(10000); await runtime.settle(); runtime.fire(10000); await runtime.settle();
assert.equal(sessionsRefreshed, 3, 'slow reconciliation cannot overlap with another tick');
heldRefresh.resolve(); heldRefresh = undefined; await runtime.settle();
runtime.update({ refreshMessages: async () => {} }); await runtime.settle(); assert.equal(subscriptions, 1, 'changing action identities must not reopen SSE');
wake(null); await runtime.settle(); assert.equal(runtime.value.eventStreamStatus, 'error');
runtime.fire(1000); await runtime.settle(); assert.equal(subscriptions, 2);
wake({ directory: '/another-project', payload: { type: 'server.connected', properties: {} } }); await runtime.settle();
assert.equal(sessionsRefreshed, 4); assert.equal(pendingRefreshed, 4, 'reconnection always recovers pending interactions');
assert.deepEqual(events, ['server.connected'], 'other-project events are filtered');
wake(null); await runtime.settle(); runtime.unmount(); assert.equal(runtime.countTimers(1000), 0);

// Conversation state machine runs against stubbed speech/platform boundaries.
const voiceRuntime = hookRuntime();
let recognitionOptions, speechCallbacks, sends = 0, aborts = 0;
let listening = false;
const sendGate = deferred();
const startSpeech = async () => { listening = true; return true; };
const abortSpeech = () => { listening = false; aborts++; };
const selectors = await loadTs('providers/opencode-provider-selectors.ts', {
  '@/lib/opencode/format': { toTranscriptEntry: (record) => record, getHistoryPreview: () => '' },
  '@/lib/opencode/transcript': { isTranscriptDisplayMessage: (entry) => Boolean(entry.text), getTranscriptActivityLabel: () => undefined },
});
const conversationImports = {
  react: voiceRuntime.react,
  'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
  '@/lib/opencode/format': { toTranscriptEntry: (record) => record },
  '@/lib/opencode/transcript': { isTranscriptDisplayMessage: (entry) => Boolean(entry.text) },
  '@/lib/voice/speech-output': { stopSpeaking: async () => {}, speakText: async (options) => { speechCallbacks = options; options.onStart(); return true; } },
  '@/lib/voice/use-speech-input': { useSpeechInput: (options) => { recognitionOptions = options; return { abort: abortSpeech, start: startSpeech, isListening: listening, isStarting: false, level: 0 }; } },
  '@/lib/voice/working-sound': { stopWorkingSoundAsync: async () => {} },
  '@/providers/opencode-provider-selectors': selectors,
  '@/providers/opencode-provider-types': { CONVERSATION_FINAL_RESULT_SETTLE_MS: 2200, CONVERSATION_KEEP_AWAKE_TAG: 'test', CONVERSATION_LISTENING_RESTART_MS: 350 },
  '@/providers/use-conversation-keep-awake': { useConversationKeepAwake: () => {} },
  '@/providers/use-conversation-screen-dim': { useConversationScreenDim: () => {} },
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
  sendingState: { active: false }, ensureActiveSession: async () => 's', sendPrompt: async () => { sends++; await sendGate.promise; return true; },
});
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle();
assert.equal(voiceRuntime.value.conversation.phase, 'listening');
recognitionOptions.onResult('voice prompt', true); voiceRuntime.fire(2200); await voiceRuntime.settle();
assert.equal(sends, 1);
voiceRuntime.update({ messagesBySession: { s: [] }, sendPrompt: async () => { sends++; return true; } }); await voiceRuntime.settle();
assert.equal(sends, 1, 'a provider refresh cannot replay a submitted voice turn');
sendGate.resolve(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'waiting');
voiceRuntime.update({ sessionStatuses: { s: { type: 'idle' } }, messagesBySession: { s: [{ id: 'reply', role: 'assistant', text: 'done', details: [] }] } });
await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'speaking');
speechCallbacks.onDone(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'listening');
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'off');
voiceRuntime.update({ pendingQuestionsBySession: { s: [{ id: 'question' }] } });
await voiceRuntime.value.toggleConversationMode(); await voiceRuntime.settle(); assert.equal(voiceRuntime.value.conversation.phase, 'off');
assert.match(voiceRuntime.value.conversation.feedback, /Answer the current request/);
voiceRuntime.unmount(); assert.equal(voiceRuntime.countTimers(2200), 0); assert.ok(aborts > 0);
console.log('workspace scope, realtime recovery, and conversation lifecycle regression tests passed');

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
    saveConnectionProfiles: async (next) => { if (failMetadata) throw new Error('metadata failed'); storedProfiles = next; },
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
console.log('provider-owned profile ordering, rollback, and callback stability checks passed');

// Actual session callbacks: restore in the row's workspace, preserve scope,
// and refresh an explicit target missing from an otherwise populated cache.
const sessionNames = ['restoreSession', 'ensureActiveSession', 'openDeepLinkSession'];
const sessionDeclarations = [
  extractDeclarations(sessionActionsSource, ['ensureActiveSession']),
  extractDeclarations(connectionActionsSource, ['waitForConnectionScope', 'switchToScope', 'restoreSession', 'openDeepLinkSession']),
].join('\n');
let restoreGate, restoreFailure, restoredDirectory, reopened, createdSessions = 0, fetchedSessions = 0;
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
  currentSessionId: undefined, sessions: [{ id: 'cached' }], messagesBySession: {},
  pendingDeepLinkTargetRef: { current: { sessionId: 'target', projectPath: '/repo' } },
  bootstrapPromiseRef: { current: null }, bootstrapTokenRef: {},
  fetchSessions: async () => { fetchedSessions++; return [target]; },
  lastSessionByConnection: {}, connectionScope: 'scope', createSession: async () => { createdSessions++; },
  setIsBootstrappingChat: () => {}, refreshMessages: async () => {}, refreshSessionDiff: async () => {},
  refreshSessionTodos: async () => {}, refreshPendingInteractions: async () => {}, refreshChatCapabilities: async () => {},
  refreshServerFeatures: async () => {}, refreshDiagnostics: async () => {}, isCurrentClient: () => true,
  setCurrentSessionId: (id) => { sessionContext.currentSessionIdRef.current = id; }, setLastSessionByConnection: () => {},
  deepLinkOperationRef: {}, currentSessionIdRef: {}, serverProjectsRef: { current: [{ worktree: '/repo' }] },
  connect: async () => {}, selectProject: () => {}, ensureActiveSessionRef: {}, setTimeout, Date,
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

// A retained active workspace may be absent from the server catalog.
sessionContext.serverProjectsRef.current = [{ worktree: '/elsewhere' }];
sessionContext.bootstrapPromiseRef.current = null;
sessionContext.ensureActiveSessionRef.current = sessionActions.ensureActiveSession;
assert.equal((await sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/repo' })).ok, true,
  'explicit session opening accepts the retained active workspace');
assert.match((await sessionActions.openDeepLinkSession({ sessionId: 'missing', projectPath: '/repo' })).error,
  /was not found/, 'the retained workspace still requires an existing session');
assert.equal(createdSessions, 0, 'opening an existing session does not create a replacement');
assert.match((await sessionActions.openDeepLinkSession({ sessionId: 'target', projectPath: '/unlisted' })).error,
  /not available from the configured server/, 'other unlisted workspaces remain rejected');
assert.equal(sessionContext.pendingDeepLinkTargetRef.current, undefined);
sessionContext.serverProjectsRef.current = [{ worktree: '/repo' }];

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
const librarySource = await readFile(new URL('../components/chat/chat-library.tsx', import.meta.url), 'utf8');
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
console.log('session restore, explicit-target opening, cancellation, and library race regressions passed');

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
  setMessagesBySession: (update) => { cachedMessages = update(cachedMessages); },
  setDiffsBySession: (update) => { cachedDiffs = update(cachedDiffs); },
  setTodosBySession: (update) => { cachedTodos = update(cachedTodos); },
  pruneTranscript: () => {},
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
      const record = { state: { id, generation: 0, status: 'connected' }, disposed: false, sent: [],
        foreground() {}, reconnect() {}, register: () => () => {}, resize() {},
        send(input) { record.sent.push(input); },
        exit() { record.state.status = 'exited'; publish(); }, dispose() { record.disposed = true; },
      };
      records.set(id, record); return record;
    } },
  });
  runtime.mount(useTerminalState, { client, isCurrentClient: () => true, serverUrl: 'http://example.test', directory: '/repo', serverContract: 'v1' });
  await runtime.value.openTerminal('first'); runtime.flush();
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
  console.log('terminal scope, refresh race, failed removal, retained selection, and disposal checks passed');
}
