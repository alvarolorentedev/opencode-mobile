import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { createSessionNavigationCommands } from '@/runtime/core/commands/session-navigation';
import { forgetSessionCreation, recentlyCreatedSessionIds, sessionCreationCommands } from '@/features/sessions/services/session-creation';
import { sessionCatalogAccess } from '@/features/sessions/services/session-catalog-access';
import { sessionEditCommands } from '@/features/sessions/services/session-editing';
import { sessionRefreshCommands } from '@/features/sessions/services/session-refresh';
import type { ModelOption } from '@/shared/contracts/model-options';
import { createAppStore } from '@/runtime/core/store';
import type { CommandContext } from '@/runtime/core/commands/context';
import type { RealtimeScopeInput } from '@/runtime/realtime/create-realtime';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { connectionQueryKey, projectQueryKey } from '@/shared/server-data/keys';

import { hookRuntime, loadTs } from '../../tests/helpers/runtime.mjs';

vi.mock('@/features/sessions/runtime', () => ({
  projectSessionsKey: (identity: Parameters<typeof connectionQueryKey>[0], client: ScopedOpencodeClient) =>
    [...connectionQueryKey(identity, client.__opencode.contract), 'sessions', 'project', client.__opencode.directory],
}));

const sessionService = vi.hoisted(() => ({
  createSession: vi.fn(),
  forkSession: vi.fn(),
  switchSessionModel: vi.fn(),
  deleteSession: vi.fn(),
  updateSessionTitle: vi.fn(),
  listSessions: vi.fn(),
  getActiveSessionStatuses: vi.fn(),
  interruptSession: vi.fn(),
  waitForSessionIdle: vi.fn(),
  revertSession: vi.fn(),
  unrevertSession: vi.fn(),
}));
vi.mock('@/shared/protocol/services/session-service', () => sessionService);
vi.mock('@/shared/protocol/opencode/client', () => ({ withReadSignal: (client: ScopedOpencodeClient) => client }));
const listPendingInteractions = vi.hoisted(() => vi.fn());
vi.mock('@/shared/protocol/opencode/client/interactions', () => ({ listPendingInteractions }));

function sessionCreationFixture({ api = false, preferred = false }: { api?: boolean; preferred?: boolean } = {}) {
  sessionService.createSession.mockReset().mockResolvedValue({ id: 'new', title: '' });
  sessionService.forkSession.mockReset().mockResolvedValue({ id: 'fork', title: '' });
  sessionService.switchSessionModel.mockReset().mockResolvedValue(undefined);
  const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const identity = { connectionId: 'server', connectionScope: 'scope', authRevision: 0 };
  const client = { __opencode: { contract: 'v2', directory: '/repo' }, ...(api ? { api: {} } : {}) } as ScopedOpencodeClient;
  const catalog = sessionCatalogAccess(cache, identity, client);
  const model = { id: 'openai/gpt-5', providerID: 'openai', modelID: 'gpt-5' } as ModelOption;
  const commands = sessionCreationCommands({ cache, identity, client, isCurrent: () => true, clock: () => 1_000, recentModel: () => preferred ? model : undefined });
  return { ...commands, cache, catalog, client, identity };
}

function sessionEditFixture() {
  const { cache, catalog, client, identity } = sessionCreationFixture();
  for (const command of [sessionService.deleteSession, sessionService.updateSessionTitle, sessionService.interruptSession,
    sessionService.waitForSessionIdle, sessionService.revertSession, sessionService.unrevertSession]) command.mockReset().mockResolvedValue(undefined);
  const refreshMessages = vi.fn(async (..._args: unknown[]) => []);
  const commands = sessionEditCommands({ cache, client, identity, isCurrent: () => true,
    clearSession: vi.fn(), runRename: (_key, rename) => rename(), refreshSessions: async () => [],
    refreshSessionDiff: async () => [], refreshMessages, refreshActiveSessions: async () => {},
  });
  return { cache, catalog, client, ...commands, refreshMessages };
}

function sessionNavigationFixture(sessions: { id: string }[] = [], overrides: Partial<RealtimeScopeInput> = {}) {
  const target = { connectionId: 'server', projectPath: '/repo' };
  const scopeKey = JSON.stringify([target.connectionId, target.projectPath]);
  const identity = { connectionId: target.connectionId, connectionScope: 'scope', authRevision: 0 };
  const client = { __opencode: { contract: 'v2', directory: target.projectPath } } as ScopedOpencodeClient;
  const store = createAppStore({ settings: { serverUrl: 'http://server', username: '', password: '', directory: '' }, chatPreferences: {} as never, controlPlaneUrl: '' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const key = [...connectionQueryKey(identity, client.__opencode.contract), 'sessions', 'project', target.projectPath];
  const writeSessions = (next: { id: string }[]) => queryClient.setQueryData(key, next);
  const sources = {
    projectPath: target.projectPath,
    workspaceKey: scopeKey,
    busy: false,
    onEvent: () => {},
    refreshSessions: async () => {},
    refreshMessages: async () => [],
    refreshSessionDiff: async () => [],
    refreshSessionTodos: async () => [],
    refreshPendingInteractions: async () => {},
    ...overrides,
  };
  const manager = {
    getProjectAccess: () => ({ client, identity, revision: 0, isCurrent: () => true }),
    realtime: { getProjectSources: () => sources },
  };
  const commands = createSessionNavigationCommands({ store, queryClient, clock: Date.now,
    connections: { get: () => manager } as unknown as CommandContext['connections'],
  }, async () => { throw new Error('The fixture did not expect a session to be created.'); });
  writeSessions(sessions);
  return {
    ...commands.navigation(target, scopeKey, 0),
    writeSessions,
    select: (patch: Parameters<ReturnType<typeof store.getState>['setSelection']>[1]) => store.getState().setSelection(scopeKey, patch),
    read: () => store.getState().selection[scopeKey],
  };
}

function deferredGate<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function loadSessionExecution(runtime: ReturnType<typeof hookRuntime>) {
  const services = {
    compactSession: vi.fn(async () => undefined),
    executeCommand: vi.fn(async () => undefined),
    generateSessionText: vi.fn(async () => 'answer'),
  };
  const { useSessionExecutionActions } = await loadTs('features/sessions/state/use-session-execution-actions.ts', {
    react: runtime.react,
    '@/shared/protocol/services/session-service': services,
  });
  return { useSessionExecutionActions, services };
}

function sessionExecutionInput() {
  return {
    client: { __opencode: { contract: 'v2' } },
    isCurrentClient: () => true,
    availableAgents: [{ id: 'build', label: 'Build', mode: 'primary' }],
    commands: [],
    refreshSessions: async () => [],
    refreshMessages: async () => [],
    chatPreferences: { mode: 'build' },
  };
}

describe('local-first session selection', () => {
  it('keeps an explicit selection while the project catalog is stale, then reconciles later removal', async () => {
    const runtime = hookRuntime();
    const { useOpencodeProviderEffects } = await loadTs('runtime/composition/use-opencode-provider-effects.ts', {
    react: runtime.react,
    "@/features/chat/model/transcript-pruning": { pruneProviderTranscripts: vi.fn() }
  });
    const previous = [{ id: 'old' }];
    const sessionsRef = { current: previous };
    const explicitSessionSelectionRef = { current: 'target' as string | undefined };
    const currentSessionIdRef = { current: 'target' as string | undefined };
    const setCurrentSessionId = vi.fn((id?: string) => { currentSessionIdRef.current = id; });
    runtime.mount(useOpencodeProviderEffects, {
      connection: { status: 'idle' }, isHydrated: false, active: false,
      activeProjectPath: '/repo', connectionScope: 'scope',
      currentSessionId: 'target', currentSessionIdRef, explicitSessionSelectionRef,
      sessions: previous, sessionsRef,
      setCurrentSessionId,
      sessionRefreshTimeoutsRef: { current: {} }, sessionRefreshOptionsRef: { current: {} },
    });
    expect(setCurrentSessionId).not.toHaveBeenCalled();
    expect(currentSessionIdRef.current).toBe('target');
    expect(explicitSessionSelectionRef.current).toBe('target');

    // Another stale list must not override the tap while the target is loading.
    sessionsRef.current = [...previous];
    runtime.update({ sessions: sessionsRef.current });
    expect(setCurrentSessionId).not.toHaveBeenCalled();

    sessionsRef.current = [...previous, { id: 'target' }];
    runtime.update({ sessions: sessionsRef.current });
    expect(explicitSessionSelectionRef.current).toBeUndefined();
    expect(setCurrentSessionId).not.toHaveBeenCalled();

    sessionsRef.current = previous;
    runtime.update({ sessions: previous });
    expect(setCurrentSessionId).toHaveBeenCalledWith('old');
    expect(currentSessionIdRef.current).toBe('old');
    runtime.unmount();
  });

  it('selects the active session before transcript hydration finishes', async () => {
    const hydration = deferredGate();
    const refreshMessages = vi.fn(async () => hydration.promise);
    const context = sessionNavigationFixture([{ id: 'target' }], { refreshMessages });

    await expect(context.ensureActiveSession()).resolves.toBe('target');
    expect(context.read()).toMatchObject({ currentSessionId: 'target', isBootstrappingChat: false });
    expect(refreshMessages).toHaveBeenCalledTimes(1);
    hydration.resolve();
    await hydration.promise;
  });

  it('refreshes a cached selection so its paging window can be rebuilt', async () => {
    const refreshMessages = vi.fn(async () => []);
    const context = sessionNavigationFixture([{ id: 'target' }], { refreshMessages, hasMessages: () => true });
    context.select({ currentSessionId: 'target' });

    await expect(context.ensureActiveSession()).resolves.toBe('target');
    expect(refreshMessages).toHaveBeenCalledWith('target', true);
  });

  it('does not let a superseded bootstrap overwrite an explicit selection', async () => {
    const fetchGate = deferredGate<{ id: string }[]>();
    const context = sessionNavigationFixture([], { refreshSessions: async () => context.writeSessions(await fetchGate.promise) });
    const ensuring = context.ensureActiveSession();
    expect(context.read().isBootstrappingChat).toBe(true);
    await context.openSession('explicit');
    fetchGate.resolve([{ id: 'remembered' }]);

    await expect(ensuring).resolves.toBeUndefined();
    expect(context.read()).toMatchObject({ currentSessionId: 'explicit', explicitSessionId: 'explicit', isBootstrappingChat: false });
  });

  it('accepts a just-selected session but still validates a missing deep-link target', async () => {
    const refreshSessions = vi.fn(async () => []);
    const context = sessionNavigationFixture([], { refreshSessions });
    context.select({ currentSessionId: 'explicit', explicitSessionId: 'explicit' });

    await expect(context.ensureActiveSession()).resolves.toBe('explicit');
    expect(refreshSessions).not.toHaveBeenCalled();

    context.select({ currentSessionId: 'missing', explicitSessionId: undefined, pendingDeepLink: { sessionId: 'missing' } });
    await expect(context.ensureActiveSession()).resolves.toBeUndefined();
    expect(refreshSessions).toHaveBeenCalledTimes(1);
  });

  it('openSession returns after selection without waiting for hydration', async () => {
    const hydration = deferredGate();
    const refreshMessages = vi.fn(async () => hydration.promise);
    const fetched = deferredGate();
    const context = sessionNavigationFixture([], { refreshMessages, refreshSessions: () => fetched.promise });
    const ensuring = context.ensureActiveSession();
    expect(context.read().isBootstrappingChat).toBe(true);

    await expect(context.openSession('target')).resolves.toBeUndefined();
    expect(context.read()).toMatchObject({ currentSessionId: 'target', explicitSessionId: 'target', isBootstrappingChat: false });
    expect(refreshMessages).toHaveBeenCalledWith('target', false);
    fetched.resolve();
    await expect(ensuring).resolves.toBeUndefined();
    hydration.resolve();
    await hydration.promise;
  });

  it('createSession shows the returned session before the list refresh resolves', async () => {
    const fixture = sessionCreationFixture();
    const { cache, catalog, client, identity } = fixture;
    const created = { id: 'new', title: '', time: { created: 1000, updated: 1000 } };
    sessionService.createSession.mockResolvedValueOnce(created);
    const reply = deferredGate<{ sessions: { id: string; title: string }[]; statuses: Record<string, unknown> }>();
    sessionService.listSessions.mockReset().mockReturnValueOnce(reply.promise);
    const commands = sessionRefreshCommands({ cache, identity, client, isCurrent: () => true, clock: () => 1_001, isPermissionReplyPending: () => false });
    const list = commands.refreshSessions();

    await expect(fixture.createSession()).resolves.toEqual(created);
    expect(sessionService.listSessions).toHaveBeenCalledExactlyOnceWith(client);
    expect(sessionService.createSession).toHaveBeenCalledOnce();
    expect(sessionService.switchSessionModel).not.toHaveBeenCalled();
    expect(catalog.readSessions()).toEqual([created]);
    expect(cache.getQueryData(catalog.catalogKey)).toEqual({ sessions: [], statuses: { new: { type: 'idle' } } });
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(), 1001)).toEqual(new Set(['new']));

    reply.resolve({ sessions: [], statuses: {} });
    await expect(list).resolves.toEqual([created]);
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(['new']), 1002)).toEqual(new Set());
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(), 1003)).toEqual(new Set());
    cache.clear();
  });

  it('createSession starts on the model the user last picked', async () => {
    const fixture = sessionCreationFixture({ api: true, preferred: true });
    const model = { providerID: 'openai', id: 'gpt-5' };
    await expect(fixture.createSession()).resolves.toEqual({ id: 'new', title: '', model });
    expect(sessionService.switchSessionModel).toHaveBeenCalledWith(fixture.client, 'new', model);
    expect(fixture.catalog.readSessions()[0].model).toEqual(model);
    fixture.cache.clear();
  });

  it('createSession keeps the server default when the last model cannot be applied', async () => {
    const fixture = sessionCreationFixture({ api: true, preferred: true });
    sessionService.switchSessionModel.mockRejectedValueOnce(new Error('model unavailable'));

    await expect(fixture.createSession()).resolves.toEqual({ id: 'new', title: '' });
    expect(fixture.catalog.readSessions()[0].model).toBeUndefined();
    fixture.cache.clear();
  });

  it('publishes the returned fork and removes the grace entry when the session is removed', async () => {
    const fixture = sessionCreationFixture();
    const { cache, catalog, client, identity } = fixture;
    await expect(fixture.forkSession('source', 'point')).resolves.toEqual({ id: 'fork', title: '' });
    expect(sessionService.forkSession).toHaveBeenCalledExactlyOnceWith(client, 'source', 'point');
    expect(catalog.readSessions()).toEqual([{ id: 'fork', title: '' }]);
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(), 1001)).toEqual(new Set(['fork']));
    forgetSessionCreation(cache, identity, client, 'fork');
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(), 1002)).toEqual(new Set());
    cache.clear();
  });

  it('renameSession echoes the title and rolls back on failure', async () => {
    const fixture = sessionEditFixture();
    const rename = deferredGate<void>();
    sessionService.updateSessionTitle.mockReturnValueOnce(rename.promise);
    fixture.catalog.setSessions([{ id: 's', title: 'Old' }] as ReturnType<typeof fixture.catalog.readSessions>);

    const renaming = fixture.renameSession('s', 'New');
    expect(fixture.catalog.readSessions()[0].title).toBe('New');
    rename.reject(new Error('rename failed'));
    await expect(renaming).rejects.toThrow('rename failed');
    expect(fixture.catalog.readSessions()[0].title).toBe('Old');
    fixture.cache.clear();
  });

  it('revertSession stops and settles a running session before staging', async () => {
    const fixture = sessionEditFixture();
    const order: string[] = [];
    sessionService.interruptSession.mockImplementation(async () => { order.push('interrupt'); });
    sessionService.waitForSessionIdle.mockImplementation(async () => { order.push('wait'); });
    sessionService.revertSession.mockImplementation(async () => { order.push('revert'); });

    await fixture.revertSession('s', 'm1');

    expect(order).toEqual(['interrupt', 'wait', 'revert']);
    expect(sessionService.revertSession).toHaveBeenCalledWith(fixture.client, 's', 'm1');
    fixture.cache.clear();
  });

  it('revertSession does not stage when the session cannot be stopped', async () => {
    const fixture = sessionEditFixture();
    sessionService.interruptSession.mockRejectedValueOnce(new Error('stop failed'));

    await expect(fixture.revertSession('s', 'm1')).rejects.toThrow('stop failed');

    expect(sessionService.waitForSessionIdle).not.toHaveBeenCalled();
    expect(sessionService.revertSession).not.toHaveBeenCalled();
    fixture.cache.clear();
  });

  it('unrevert replaces the displayed transcript after the server clears the rewind', async () => {
    const fixture = sessionEditFixture();
    await fixture.unrevertSession('s');

    expect(sessionService.unrevertSession).toHaveBeenCalledExactlyOnceWith(fixture.client, 's');
    expect(fixture.refreshMessages).toHaveBeenCalledExactlyOnceWith('s', true, { mode: 'replace' });
    fixture.cache.clear();
  });
});

describe('non-blocking prompt reconciliation', () => {
  it('returns after admission without a transcript read', async () => {
    const runtime = hookRuntime();
    const appearance = await loadTs('shared/ui/theme/appearance.ts');
    const autoModelPreferences = await loadTs('shared/preferences/auto-model.ts');
    const preferences = await loadTs(['shared/preferences/opencode-preferences.ts', 'features/chat/model/system-prompt.ts'], {
    '@/shared/ui/theme/appearance': appearance,
    '@/shared/preferences/auto-model': autoModelPreferences,
    "@/shared/platform/voice/wake-phrase": { DEFAULT_WAKE_PHRASE: 'hey code' },
    "@/shared/platform/voice/local-wake-word/types": { DEFAULT_LOCAL_WAKE_PHRASE: 'hey-code', DEFAULT_LOCAL_COMMAND_MODEL: 'moonshine-tiny-en' }
  });
    const models = await loadTs('features/ai/model/opencode-model-selection.ts', {
    "@/shared/preferences/opencode-preferences": preferences
  });
    const notifications = {
      clearPendingTaskFinishedNotification: vi.fn(async () => true),
      listPendingTaskFinishedNotifications: async () => [],
      notifyTaskFinished: vi.fn(),
      trackPendingTaskFinishedNotification: vi.fn(async () => undefined),
    };
    const { usePromptLifecycle } = await loadTs('features/chat/state/use-prompt-lifecycle.ts', {
    react: runtime.react,
    '@/features/notifications/services/notifications': notifications,
    "@/features/chat/model/system-prompt": preferences,
    "@/features/ai/model/opencode-model-selection": models,
    "@/shared/protocol/services/session-service": { interruptSession: async () => undefined, readSessionSettlement: async () => ({ state: 'finished' }) },
    "@/features/notifications/model/notification-pending": { pendingNotificationKey: (scope: string, id: string) => `${scope}:${id}` },
    "@/shared/contracts/connection-scope": { getConnectionScope: () => 'scope', getConnectionUiScope: () => 'scope' },
    "@/shared/protocol/opencode/attachment": { prepareAttachment: async (att: unknown) => att },
    "@/features/ai/state/use-prompt-routing": { usePromptRouting: () => async () => undefined }
  });
    const submitPrompt = vi.fn(async () => ({ id: 'u1', sessionId: 's', createdAt: 1, text: 'Hello', attachments: [], delivery: 'steer', state: 'waiting' }));
    const markLocalSend = vi.fn();
    const refreshSessionDiff = vi.fn(async () => []);
    const refreshSessionTodos = vi.fn(async () => []);
    const scheduleSessionRefresh = vi.fn();
    const input = {
      client: { __opencode: { contract: 'v2' } },
      isCurrentClient: () => true,
      activeProjectPath: '/repo',
      connectionScope: 'scope',
      sessions: [{ id: 's', title: 'chat' }],
      sessionStatuses: {},
      availableAgents: [{ id: 'build', label: 'Build', mode: 'primary' }],
      availableModels: [],
      chatPreferences: { ...preferences.defaultChatPreferences, mode: 'summary' },
      settingsRef: { current: { serverUrl: 'http://server', username: '' } },
      busyNotificationsRef: { current: new Set() },
      promptSubmissionRef: { current: { active: false } },
      setSelectedDiffMessageBySession: vi.fn(),
      refreshSessions: vi.fn(async () => [{ id: 's', title: 'chat' }]),
      markLocalSend,
      refreshSessionDiff,
      refreshSessionTodos,
      scheduleSessionRefresh,
      summarizeSessionTitle: vi.fn(),
      submitPrompt,
    };
    runtime.mount(usePromptLifecycle, input);

    let resolved = false;
    const sending = runtime.value.sendPrompt('s', 'Hello').then((value: boolean) => {
      resolved = true;
      return value;
    });
    await runtime.settle();
    expect(resolved).toBe(true);
    await expect(sending).resolves.toBe(true);
    expect(submitPrompt).toHaveBeenCalledOnce();
    expect(submitPrompt).toHaveBeenCalledWith(expect.objectContaining({ agent: 'build' }), 'steer');
    expect(markLocalSend).toHaveBeenCalledWith('s');
    runtime.update({ availableAgents: [] });
    await expect(runtime.value.sendPrompt('s', 'Keep this draft')).rejects.toThrow('chat:composer.noEligibleAgent');
    expect(submitPrompt).toHaveBeenCalledOnce();
    await runtime.settle();
    expect(runtime.value.promptError.message).toBe('chat:composer.noEligibleAgent');
    expect(scheduleSessionRefresh).toHaveBeenCalledOnce();
    expect(markLocalSend).toHaveBeenCalledOnce();
    expect(refreshSessionDiff).not.toHaveBeenCalled();
    expect(refreshSessionTodos).not.toHaveBeenCalled();
    runtime.unmount();
  });
});

describe('interaction refresh suppression', () => {
  it('does not re-add a request whose reply is in flight', async () => {
    const { cache, client, identity } = sessionCreationFixture();
    const request = { id: 'p1', sessionID: 's' };
    listPendingInteractions.mockResolvedValue({ permissions: [request], questions: undefined });
    let suppressed = true;
    const key = projectQueryKey(identity, client, 'pending-interactions');
    const cachedQuestions = { s: [{ id: 'q' }] };
    cache.setQueryData(key, { permissions: {}, questions: cachedQuestions });
    const commands = sessionRefreshCommands({ cache, identity, client, isCurrent: () => true, clock: () => 1_001,
      isPermissionReplyPending: (id) => suppressed && id === request.id });
    await commands.refreshPendingInteractions();
    expect(cache.getQueryData(key)).toEqual({ permissions: {}, questions: cachedQuestions });

    suppressed = false;
    await commands.refreshPendingInteractions();
    expect(cache.getQueryData(key)).toEqual({ permissions: { s: [request] }, questions: cachedQuestions });
    cache.clear();
  });
});

describe('session status reconciliation', () => {
  it('refreshes busy statuses without a catalog read and falls back when status reads fail', async () => {
    const { cache, catalog, client, identity } = sessionCreationFixture();
    const commands = sessionRefreshCommands({ cache, identity, client, isCurrent: () => true, clock: () => 1_001,
      isPermissionReplyPending: () => false });
    catalog.setSessionStatuses({ previous: { type: 'busy' } });
    sessionService.listSessions.mockReset();
    sessionService.getActiveSessionStatuses.mockReset().mockResolvedValueOnce({ running: {} });
    await commands.refreshSessionStatuses();
    expect(cache.getQueryData(catalog.catalogKey)).toEqual({ sessions: [], statuses: {
      previous: { type: 'idle' }, running: { type: 'busy' },
    } });
    expect(sessionService.listSessions).not.toHaveBeenCalled();

    const sessions = [{ id: 'recovered', title: '', time: { created: 1000, updated: 1000 } }];
    sessionService.getActiveSessionStatuses.mockRejectedValueOnce(new Error('status unavailable'));
    sessionService.listSessions.mockResolvedValueOnce({ sessions, statuses: { recovered: { type: 'idle' } } });
    await commands.refreshSessionStatuses();
    expect(sessionService.listSessions).toHaveBeenCalledExactlyOnceWith(client);
    expect(catalog.readSessions()).toEqual(sessions);
    expect(cache.getQueryData(catalog.catalogKey)).toEqual({ sessions: [], statuses: { recovered: { type: 'idle' } } });
    cache.clear();
  });
});

describe('optimistic interaction replies', () => {
  it('removes a permission immediately and restores it when the reply fails', async () => {
    const reply = deferredGate();
    const client = {
      listPendingInteractions: vi.fn(async () => undefined),
      replyToPendingPermission: vi.fn(() => reply.promise),
      replyToPendingQuestion: vi.fn(async () => undefined),
      rejectPendingQuestion: vi.fn(async () => undefined),
    };
    const { createInteractionCommands } = await loadTs('features/sessions/services/interaction-commands.ts', {
    '@/shared/protocol/opencode/client': client
  });
    const request = { id: 'p1', sessionID: 's' };
    let permissions: Record<string, any[]> = { s: [request] };
    const suppressed = new Set<string>();
    const refreshMessages = vi.fn(async () => []);
    const input = {
      client: {},
      isCurrent: () => true,
      readPermissions: () => permissions,
      readQuestions: () => ({}),
      updatePermissions: (value: any) => {
        permissions = typeof value === 'function' ? value(permissions) : value;
      },
      updateQuestions: () => undefined,
      runPermissionReply: (id: string, run: () => Promise<void>) => {
        suppressed.add(id);
        return run().finally(() => suppressed.delete(id));
      },
      refreshMessages,
      refreshSavedPermissions: vi.fn(async () => undefined),
    };
    const commands = createInteractionCommands(input);

    const replying = commands.replyToPermission('p1', 'once');
    await Promise.resolve();
    expect(permissions.s).toEqual([]);
    expect(suppressed.has('p1')).toBe(true);

    reply.reject(new Error('reply failed'));
    await expect(replying).rejects.toThrow('reply failed');
    expect(permissions.s).toEqual([request]);
    expect(suppressed.has('p1')).toBe(false);
    expect(refreshMessages).not.toHaveBeenCalled();

  });

  it('keeps the permission removed after a successful reply', async () => {
    const client = {
      listPendingInteractions: vi.fn(async () => undefined),
      replyToPendingPermission: vi.fn(async () => undefined),
      replyToPendingQuestion: vi.fn(async () => undefined),
      rejectPendingQuestion: vi.fn(async () => undefined),
    };
    const { createInteractionCommands } = await loadTs('features/sessions/services/interaction-commands.ts', {
    '@/shared/protocol/opencode/client': client
  });
    const request = { id: 'p1', sessionID: 's' };
    let permissions: Record<string, any[]> = { s: [request] };
    const suppressed = new Set<string>();
    const refreshMessages = vi.fn(async () => []);
    const input = {
      client: {},
      isCurrent: () => true,
      readPermissions: () => permissions,
      readQuestions: () => ({}),
      updatePermissions: (value: any) => {
        permissions = typeof value === 'function' ? value(permissions) : value;
      },
      updateQuestions: () => undefined,
      runPermissionReply: (id: string, run: () => Promise<void>) => {
        suppressed.add(id);
        return run().finally(() => suppressed.delete(id));
      },
      refreshMessages,
      refreshSavedPermissions: vi.fn(async () => undefined),
    };
    const commands = createInteractionCommands(input);

    await expect(commands.replyToPermission('p1', 'once')).resolves.toBeUndefined();
    expect(permissions.s).toEqual([]);
    expect(suppressed.has('p1')).toBe(false);
    expect(refreshMessages).toHaveBeenCalledWith('s', true);

  });
});

describe('command agent eligibility', () => {
  it('repairs stale selections at execution and refuses an unverifiable agent', async () => {
    const runtime = hookRuntime();
    const { useSessionExecutionActions, services } = await loadSessionExecution(runtime);
    const input = sessionExecutionInput();
    runtime.mount(useSessionExecutionActions, { ...input, chatPreferences: { ...input.chatPreferences, mode: 'summary' },
      availableAgents: [{ id: 'build', label: 'Build', mode: 'primary' }, { id: 'plan', label: 'Plan', mode: 'all' }], currentConfig: { default_agent: 'plan' } });
    await runtime.value.executeCommand('s', 'review', '');
    expect(services.executeCommand).toHaveBeenCalledWith(input.client, 's', 'review', '', expect.objectContaining({ agent: 'plan' }));
    runtime.update({ availableAgents: [{ id: 'general', label: 'General', mode: 'subagent' }] });
    await expect(runtime.value.executeCommand('s', 'review', '')).rejects.toThrow('chat:composer.noEligibleAgent');
    expect(services.executeCommand).toHaveBeenCalledOnce();
    runtime.unmount();
  });

  it('routes built-in compact and btw before the server command', async () => {
    const runtime = hookRuntime();
    const { useSessionExecutionActions, services } = await loadSessionExecution(runtime);
    const input = sessionExecutionInput();
    runtime.mount(useSessionExecutionActions, input);

    await runtime.value.executeCommand('s', 'compact', '');
    expect(services.compactSession).toHaveBeenCalledWith(input.client, 's');
    expect(services.executeCommand).not.toHaveBeenCalled();

    await expect(runtime.value.executeCommand('s', 'btw', 'why?')).resolves.toEqual({ question: 'why?', answer: 'answer' });
    expect(services.generateSessionText).toHaveBeenCalledWith(input.client, 's', expect.stringContaining('why?'));
    expect(services.executeCommand).not.toHaveBeenCalled();

    await expect(runtime.value.executeCommand('s', 'btw', '')).rejects.toThrow('chat:composer.sideQuestionEmpty');
    await expect(runtime.value.executeCommand('s', 'btw', 'why?', { attachments: [{ uri: 'file:///a' }] })).rejects.toThrow('chat:composer.builtinAttachmentsUnsupported');

    runtime.unmount();
  });
});
