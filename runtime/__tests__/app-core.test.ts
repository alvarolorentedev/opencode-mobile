import { describe, expect, it, vi } from 'vitest';

import { createAppCore } from '@/runtime/core/create-app-core';
import type { WorkspaceSnapshot } from '@/runtime/workspace/workspace-types';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { workspaceKey, type WorkspaceTarget } from '@/shared/contracts/workspace';
import { connectionQueryKey, projectQueryKey } from '@/shared/server-data/keys';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';

const protocol = vi.hoisted(() => ({
  replyToPendingPermission: vi.fn(),
  replyToPendingQuestion: vi.fn(),
  rejectPendingQuestion: vi.fn(),
  listPendingInteractions: vi.fn(),
  createSession: vi.fn(),
  forkSession: vi.fn(),
  switchSessionModel: vi.fn(),
  deleteSession: vi.fn(),
  updateSessionTitle: vi.fn(),
}));

vi.mock('@/shared/protocol/opencode/client', () => ({
  ...protocol,
  withReadSignal: (client: ScopedOpencodeClient) => client,
  listSavedPermissionRules: vi.fn(async () => []),
}));
vi.mock('@/features/sessions/runtime', async () => ({
  approvalsAccess: (await import('@/features/sessions/services/approvals')).approvalsAccess,
  createInteractionCommands: (await import('@/features/sessions/services/interaction-commands')).createInteractionCommands,
  ...(await import('@/features/sessions/services/session-creation')),
  ...(await import('@/features/sessions/services/session-editing')),
  ...(await import('@/features/sessions/services/queries')),
}));
vi.mock('@/shared/protocol/services/session-service', () => ({
  createSession: protocol.createSession,
  forkSession: protocol.forkSession,
  switchSessionModel: protocol.switchSessionModel,
  deleteSession: protocol.deleteSession,
  updateSessionTitle: protocol.updateSessionTitle,
}));
vi.mock('@/features/chat/runtime', async () => ({
  forgetSessionContent: (await import('@/features/chat/services/queries')).forgetSessionContent,
}));
vi.mock('@/features/ai/runtime', () => ({
  agentsOptions: () => ({ queryKey: ['agents'] }),
  capabilitiesOptions: () => ({ queryKey: ['capabilities'] }),
}));
vi.mock('@/shared/server-data/catalogs', () => ({ configurationOptions: () => ({ queryKey: ['configuration'] }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const settings = { serverUrl: 'http://127.0.0.1:4096', username: '', password: '', directory: '' };
const newCore = () => createAppCore({ settings, chatPreferences: {} as ChatPreferences, controlPlaneUrl: '' });

function connectedProject(core: ReturnType<typeof newCore>, connectionId: string, projectPath: string) {
  const target: WorkspaceTarget = { connectionId, projectPath };
  const openSession = vi.fn(async (_id: string) => {});
  const created = { id: 'new-session' };
  const createSession = vi.fn(async () => created);
  const openDeepLinkSession = vi.fn(async (_link: unknown, _signal: AbortSignal) => ({ ok: true }));
  const createWorktree = vi.fn(async (_name?: string) => ({ directory: '/checkout' }));
  const snapshot = {
    enabled: true, catalogSessions: [{ id: 'rendered', directory: projectPath }], suspend: vi.fn(),
    values: {
      connectionValue: { connection: { status: 'connected' } },
      projectsValue: { activeProjectPath: projectPath },
      conversationValue: { conversation: { active: false } },
      currentSessionValue: { openSession, openDeepLinkSession, createSession },
      projectFilesValue: { createWorktree },
      sessionLibraryValue: { sessions: [] },
    },
  } as unknown as WorkspaceSnapshot;
  const commands = core.commands.workspace;
  commands.change((current) => {
    const found = current.some(({ id }) => id === connectionId);
    if (found) return current.map((entry) => entry.id === connectionId ? { ...entry, projects: [...entry.projects, projectPath] } : entry);
    return [...current, { id: connectionId, settings, name: connectionId, enabled: true, preferences: {}, projects: [projectPath] }];
  });
  commands.publish(workspaceKey(target), snapshot);
  return { target, openSession, openDeepLinkSession, createSession, createWorktree, created };
}

describe('app core', () => {
  it('constructs one store and one query cache with injected defaults', async () => {
    const core = newCore();

    core.store.getState().setRegistry({ ready: true });
    core.store.getState().setSelection('["c","/p"]', { currentSessionId: 's' });
    expect(core.store.getState().registry.ready).toBe(true);
    expect(core.store.getState().selection['["c","/p"]'].currentSessionId).toBe('s');

    await core.queryClient.fetchQuery({ queryKey: ['probe'], queryFn: async () => 42 });
    expect(core.queryClient.getQueryData(['probe'])).toBe(42);
    core.commands.workspace.dispose();
    core.queryClient.clear();
  });

  it('revises credentials for the selected server while preserving the other connection', async () => {
    const core = newCore();
    const connectionId = getConnectionUiScope(settings);
    const target = { connectionId, projectPath: '/repo' };
    connectedProject(core, connectionId, target.projectPath);
    connectedProject(core, 'other', '/other');
    core.commands.workspace.select(target);

    core.commands.connection.updateSettings(connectionId, { ...settings, password: 'replacement' });

    expect(core.store.getState().registry.connections).toMatchObject([
      { id: connectionId, settings: { password: 'replacement' }, enabled: false, revision: 1, authRevision: 1 },
      { id: 'other', settings: { password: '' }, enabled: true },
    ]);
    expect(core.store.getState().shell.settings.password).toBe('replacement');
    await expect(core.commands.connection.connect(connectionId)).resolves.toMatchObject({ status: 'idle' });
    core.commands.workspace.dispose();
  });

  it('uses the current workspace selection for events and drops a superseded transport', () => {
    const core = newCore();
    const workspaceKey = '["server","/repo"]';
    const otherKey = '["other","/repo"]';
    const { setSelection, setPrompt } = core.store.getState();
    const scheduleSessionRefresh = vi.fn();
    const scheduleSessionsRefresh = vi.fn();
    const setSessionStatuses = vi.fn();
    let current = true;
    const binding = { workspaceKey, isCurrent: () => current, pendingSessionIds: [], actions: {
      scheduleSessionRefresh, scheduleSessionsRefresh, setSessionStatuses,
      refreshSessions: async () => {}, refreshPendingInteractions: async () => {}, refreshTerminals: async () => {},
      setDiffsBySession: vi.fn(), setTodosBySession: vi.fn(), setPendingPermissionsBySession: vi.fn(), setPendingQuestionsBySession: vi.fn(),
    } };
    const start = { type: 'session.execution.started', data: { sessionID: 'chat' } } as OpencodeEvent;
    setSelection(workspaceKey, { currentSessionId: 'chat', explicitSessionId: 'chat' });
    setSelection(otherKey, { currentSessionId: 'chat', explicitSessionId: 'chat' });
    setPrompt(workspaceKey, { sending: { active: true, sessionId: 'chat' } });
    core.events.dispatch(start, binding);
    expect(scheduleSessionRefresh).toHaveBeenCalledWith('chat', { sessions: true, todos: true, delayMs: undefined });

    setPrompt(workspaceKey, { sending: { active: false } });
    core.events.dispatch(start, binding);
    expect(scheduleSessionRefresh).toHaveBeenLastCalledWith('chat', { sessions: true, messages: true, todos: true, delayMs: undefined });

    const deleted = { type: 'session.deleted', data: { sessionID: 'chat' } } as OpencodeEvent;
    current = false;
    core.events.dispatch(deleted, binding);
    expect(scheduleSessionsRefresh).not.toHaveBeenCalled();
    expect(core.store.getState().selection[workspaceKey].explicitSessionId).toBe('chat');
    current = true;
    core.events.dispatch(deleted, binding);
    expect(scheduleSessionsRefresh).toHaveBeenCalledOnce();
    expect(core.store.getState().selection[workspaceKey].explicitSessionId).toBeUndefined();
    expect(core.store.getState().selection[otherKey].explicitSessionId).toBe('chat');
    core.commands.workspace.dispose();
  });

  it('resolves a scoped link and a rendered library row through plain commands', async () => {
    const core = newCore();
    const connection = core.commands.connection;
    const project = connectedProject(core, 'saved', '/repo');
    const connectionScope = getConnectionScope(settings);
    await expect(connection.openSession({ connectionScope, projectPath: '/repo', sessionId: 'linked' })).resolves.toEqual({ ok: true });
    expect(project.openDeepLinkSession).toHaveBeenCalledExactlyOnceWith({ projectPath: '/repo', sessionId: 'linked' }, expect.any(AbortSignal));

    await connection.openSessionInProject('/repo', 'rendered', connectionScope);
    expect(project.openSession).toHaveBeenCalledExactlyOnceWith('rendered');
    expect(core.store.getState().registry.focus).toEqual(project.target);
    core.commands.workspace.dispose();
  });

  it('keeps terminal and inspection independent and cancels a late external session before committing focus', async () => {
    const core = newCore();
    const commands = core.commands.workspace;
    const a = connectedProject(core, 'a', '/a');
    const b = connectedProject(core, 'b', '/b');
    let finish: (result: { ok: boolean }) => void = () => {};
    const pending = new Promise<{ ok: boolean }>((resolve) => { finish = resolve; });
    let started: () => void = () => {};
    const resolving = new Promise<void>((resolve) => { started = resolve; });
    b.openDeepLinkSession.mockImplementationOnce(() => { started(); return pending; });

    await commands.activate(a.target);
    await commands.inspect(b.target);
    await commands.selectTerminalTarget(b.target);
    expect(core.store.getState().registry).toMatchObject({ focus: a.target, inspectionTarget: b.target, terminalTarget: b.target });
    const staleLink = commands.openExternalSession({ ...b.target, sessionId: 'link' });
    await resolving;
    await commands.navigate({ ...a.target, sessionId: 'rendered' });
    finish({ ok: true });
    await expect(staleLink).rejects.toThrow('This session link was cancelled.');
    expect(a.openSession).toHaveBeenCalledExactlyOnceWith('rendered');
    expect(core.store.getState().registry.focus).toEqual(a.target);
    commands.dispose();
  });

  it('creates and opens worktree chats in the checkout and returns the checkout on session failure', async () => {
    const core = newCore();
    const commands = core.commands.workspace;
    const root = connectedProject(core, 'a', '/root');
    const checkout = connectedProject(core, 'a', '/checkout');
    const target = { connectionId: 'a', projectRoot: '/root', name: 'fix' };
    await expect(commands.createChatInWorktree(target)).resolves.toEqual({ session: checkout.created, checkout: { directory: '/checkout' } });
    expect(root.createWorktree).toHaveBeenCalledExactlyOnceWith('fix');
    expect(root.createSession).not.toHaveBeenCalled();
    expect(checkout.openSession).toHaveBeenCalledExactlyOnceWith(checkout.created.id);
    expect(core.store.getState().registry.focus).toEqual(checkout.target);
    checkout.createSession.mockRejectedValueOnce(new Error('Chat creation failed'));
    await expect(commands.createChatInWorktree(target)).resolves.toEqual({ checkout: { directory: '/checkout' }, error: 'Chat creation failed' });
    commands.dispose();
  });

  it('isolates an in-flight reply by project and rejects writes after credential rotation', async () => {
    const core = newCore();
    const { queryClient, commands: { session } } = core;
    const original = { connectionId: 'server', connectionScope: 'original', authRevision: 0 };
    let identity = original;
    let revision = 0;
    const client = { __opencode: { contract: 'v2', directory: '/a' } } as ScopedOpencodeClient;
    const refreshMessages = vi.fn(async (_projectPath: string, _sessionId: string, _silent: boolean) => undefined);
    const manager = {
      getProjectAccess(projectPath: string) {
        const capturedRevision = revision;
        return { identity, revision, client: { __opencode: { ...client.__opencode, directory: projectPath } },
          isCurrent: () => revision === capturedRevision };
      },
      isDemanded: () => false,
      realtime: { getProjectSources: (path: string) => ({
        refreshMessages: (sessionId: string, silent: boolean) => refreshMessages(path, sessionId, silent),
      }) },
    } as unknown as NonNullable<ReturnType<typeof core.connections.get>>;
    vi.spyOn(core.connections, 'get').mockReturnValue(manager);
    const permission = { id: 'p', sessionID: 's' };
    const question = { id: 'q', sessionID: 's' };
    const initial = { permissions: { s: [permission] }, questions: { s: [question] } };
    const key = projectQueryKey(original, client, 'pending-interactions');
    queryClient.setQueryData(key, initial);
    const otherClient = { __opencode: { ...client.__opencode, directory: '/b' } } as ScopedOpencodeClient;
    const otherKey = projectQueryKey(original, otherClient, 'pending-interactions');
    queryClient.setQueryData(otherKey, initial);
    const bound = session.interactions({ connectionId: 'server', projectPath: '/a' }, 0);
    let failReply: (reason: Error) => void = () => {};
    let startReply: () => void = () => {};
    const started = new Promise<void>((resolve) => { startReply = resolve; });
    protocol.replyToPendingPermission.mockImplementationOnce(() => {
      startReply();
      return new Promise<void>((_, reject) => { failReply = reject; });
    });
    const reply = bound.replyToPermission('p', 'once');
    const rejected = expect(reply).rejects.toThrow('revoked');
    await started;
    expect(queryClient.getQueryData(key)).toEqual({ ...initial, permissions: { s: [] } });
    expect(queryClient.getQueryData(otherKey)).toEqual(initial);
    expect(session.isPermissionReplyPending(original, client, 'p')).toBe(true);
    expect(session.isPermissionReplyPending(original, otherClient, 'p')).toBe(false);
    identity = { ...original, connectionScope: 'rotated', authRevision: 1 };
    revision = 1;
    queryClient.removeQueries({ queryKey: key, exact: true });
    failReply(new Error('revoked'));
    await rejected;
    expect(queryClient.getQueryData(key)).toBeUndefined();
    expect(session.isPermissionReplyPending(original, client, 'p')).toBe(false);
    await expect(bound.replyToPermission('p', 'once')).rejects.toThrow('no longer available');
    expect(refreshMessages).not.toHaveBeenCalled();

    const latest = projectQueryKey(identity, client, 'pending-interactions');
    queryClient.setQueryData(latest, initial);
    const current = session.interactions({ connectionId: 'server', projectPath: '/a' }, revision);
    protocol.replyToPendingQuestion.mockResolvedValueOnce(undefined);
    await current.replyToQuestion('q', [['answer']]);
    expect(queryClient.getQueryData(latest)).toEqual({ ...initial, questions: { s: [] } });
    expect(refreshMessages).toHaveBeenCalledExactlyOnceWith('/a', 's', true);
    core.commands.workspace.dispose();
    queryClient.clear();
  });

  it('creates and forks sessions with the current project client and opens a fork in that workspace', async () => {
    const core = newCore();
    const { queryClient, commands } = core;
    const target = { connectionId: 'server', projectPath: '/a' };
    const scopeKey = workspaceKey(target);
    const identity = { connectionId: 'server', connectionScope: 'scope', authRevision: 1 };
    const client = { __opencode: { contract: 'v2', directory: '/a' }, api: {} } as ScopedOpencodeClient;
    const sources = {
      demanded: true, refreshMessages: vi.fn(async () => []), refreshSessionDiff: vi.fn(async () => []),
      refreshSessionTodos: vi.fn(async () => []), refreshPendingInteractions: vi.fn(async () => undefined),
    };
    const manager = {
      getProjectAccess: vi.fn(() => ({ client, identity, revision: 3, isCurrent: () => true })),
      realtime: { getProjectSources: (_path: string, key: string) => key === scopeKey ? sources : undefined },
    } as unknown as NonNullable<ReturnType<typeof core.connections.get>>;
    vi.spyOn(core.connections, 'get').mockReturnValue(manager);
    commands.workspace.change(() => [{
      id: target.connectionId, name: 'Server', settings, enabled: true, projects: [target.projectPath], revision: 3,
      authRevision: 1, preferences: { recentModelIds: ['provider/model'] },
    }]);
    queryClient.setQueryData(['agents'], []);
    queryClient.setQueryData(['configuration'], {});
    queryClient.setQueryData(['capabilities'], { models: [{ id: 'provider/model', providerID: 'provider', modelID: 'model' }] });
    protocol.createSession.mockResolvedValueOnce({ id: 'created' });
    protocol.forkSession.mockResolvedValueOnce({ id: 'forked' });
    protocol.switchSessionModel.mockResolvedValueOnce(undefined);
    const creation = commands.session.creation(target, scopeKey, 3);
    await expect(creation.createSession(' Title ')).resolves.toMatchObject({
      id: 'created', model: { providerID: 'provider', id: 'model' },
    });
    expect(protocol.createSession).toHaveBeenCalledExactlyOnceWith(client, 'Title');
    await expect(creation.forkSession('created', 'later')).resolves.toMatchObject({ id: 'forked' });
    expect(protocol.forkSession).toHaveBeenCalledExactlyOnceWith(client, 'created', 'later');
    expect(core.store.getState().selection[scopeKey].currentSessionId).toBe('forked');
    expect(sources.refreshMessages).toHaveBeenCalledExactlyOnceWith('forked', false);
    await expect(commands.session.creation(target, scopeKey, 2).createSession()).rejects.toThrow('no longer available');
    expect(protocol.createSession).toHaveBeenCalledTimes(1);
    commands.workspace.dispose();
    queryClient.clear();
  });

  it('serializes competing titles and deletes content only from the originating credential partition', async () => {
    const core = newCore();
    const { queryClient, commands, store } = core;
    const target = { connectionId: 'server', projectPath: '/a' };
    const scopeKey = workspaceKey(target);
    const identity = { connectionId: 'server', connectionScope: 'scope', authRevision: 1 };
    const client = { __opencode: { contract: 'v2', directory: '/a' } } as ScopedOpencodeClient;
    const manager = {
      getProjectAccess: () => ({ client, identity, revision: 3, isCurrent: () => true }),
      getCatalogClient: () => undefined,
      realtime: { getProjectSources: () => ({}) },
    } as unknown as NonNullable<ReturnType<typeof core.connections.get>>;
    vi.spyOn(core.connections, 'get').mockReturnValue(manager);
    const ownerKey = connectionQueryKey(identity, 'v2');
    const oldKey = connectionQueryKey({ ...identity, authRevision: 0 }, 'v2');
    const sessionsKey = [...ownerKey, 'sessions', 'project', '/a'];
    const approvalsKey = [...ownerKey, 'project', '/a', 'pending-interactions'];
    const statusesKey = [...ownerKey, 'sessions', 'catalog'];
    queryClient.setQueryData(sessionsKey, [{ id: 's', title: 'Original' }, { id: 'other', title: 'Keep' }]);
    queryClient.setQueryData(approvalsKey, { permissions: { s: [{ id: 'pending' }] }, questions: {} });
    queryClient.setQueryData(statusesKey, { sessions: [], statuses: { s: { type: 'idle' }, other: { type: 'busy' } } });
    const transcript = (id: string, authRevision = 1) => projectQueryKey({ ...identity, authRevision }, client, 'transcript', id);
    queryClient.setQueryData(transcript('s'), 'remove');
    queryClient.setQueryData(transcript('other'), 'keep');
    queryClient.setQueryData(transcript('s', 0), 'old partition');
    for (const name of ['diffs', 'todos']) {
      queryClient.setQueryData([...ownerKey, name], { s: ['remove'], other: ['keep'] });
      queryClient.setQueryData([...oldKey, name], { s: ['old partition'] });
    }
    store.getState().setSelection(scopeKey, { currentSessionId: 's', explicitSessionId: 's' });
    store.getState().setShellValue('favoriteSessions', [
      { sessionId: 's', connectionScope: 'scope', projectPath: '/a', favoritedAt: 1 },
      { sessionId: 's', connectionScope: 'another server', projectPath: '/a', favoritedAt: 2 },
    ]);
    const editing = commands.session.editing(target, scopeKey, 3);
    let rejectRename: (reason: Error) => void = () => {};
    protocol.updateSessionTitle.mockReset().mockReturnValueOnce(new Promise<void>((_, reject) => { rejectRename = reject; })).mockResolvedValueOnce(undefined);
    const failed = expect(editing.renameSession('s', 'First')).rejects.toThrow('first failed');
    const succeeds = editing.renameSession('s', 'Second');
    expect(protocol.updateSessionTitle).toHaveBeenCalledExactlyOnceWith(client, 's', 'First');
    rejectRename(new Error('first failed'));
    await failed;
    await succeeds;
    expect(queryClient.getQueryData(sessionsKey)).toEqual([{ id: 's', title: 'Second' }, { id: 'other', title: 'Keep' }]);

    protocol.deleteSession.mockResolvedValueOnce(undefined);
    await editing.deleteSession('s');
    expect(protocol.deleteSession).toHaveBeenCalledExactlyOnceWith(client, 's');
    expect(queryClient.getQueryData(sessionsKey)).toEqual([{ id: 'other', title: 'Keep' }]);
    expect(queryClient.getQueryData(approvalsKey)).toEqual({ permissions: {}, questions: {} });
    expect(queryClient.getQueryData(statusesKey)).toEqual({ sessions: [], statuses: { other: { type: 'busy' } } });
    expect(queryClient.getQueryData(transcript('s'))).toBeUndefined();
    expect(queryClient.getQueryData(transcript('other'))).toBe('keep');
    expect(queryClient.getQueryData(transcript('s', 0))).toBe('old partition');
    for (const name of ['diffs', 'todos']) {
      expect(queryClient.getQueryData([...ownerKey, name])).toEqual({ other: ['keep'] });
      expect(queryClient.getQueryData([...oldKey, name])).toEqual({ s: ['old partition'] });
    }
    expect(store.getState().shell.favoriteSessions.map(({ connectionScope }) => connectionScope)).toEqual(['another server']);
    expect(store.getState().selection[scopeKey]).toMatchObject({ currentSessionId: undefined, explicitSessionId: undefined });
    commands.workspace.dispose();
    queryClient.clear();
  });
});
