import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { createSessionNavigationCommands } from '@/runtime/core/commands/session-navigation';
import { forgetSessionCreation, recentlyCreatedSessionIds, sessionCreationCommands } from '@/features/sessions/services/session-creation';
import { sessionCatalogAccess } from '@/features/sessions/services/session-catalog-access';
import type { ModelOption } from '@/shared/contracts/model-options';
import { createAppStore } from '@/runtime/core/store';
import type { CommandContext } from '@/runtime/core/commands/context';
import type { RealtimeScopeInput } from '@/runtime/realtime/create-realtime';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { connectionQueryKey } from '@/shared/server-data/keys';

import { hookRuntime, loadTs } from '../../tests/helpers/runtime.mjs';

vi.mock('@/features/sessions/runtime', () => ({
  projectSessionsKey: (identity: Parameters<typeof connectionQueryKey>[0], client: ScopedOpencodeClient) =>
    [...connectionQueryKey(identity, client.__opencode.contract), 'sessions', 'project', client.__opencode.directory],
}));

const sessionService = vi.hoisted(() => ({
  createSession: vi.fn(),
  forkSession: vi.fn(),
  switchSessionModel: vi.fn(),
}));
vi.mock('@/shared/protocol/services/session-service', () => sessionService);
vi.mock('@/shared/protocol/opencode/client', () => ({ withReadSignal: (client: ScopedOpencodeClient) => client }));

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

async function loadSessionCrud(runtime: ReturnType<typeof hookRuntime>) {
  const services = {
    archiveSession: vi.fn(async () => undefined),
    compactSession: vi.fn(async () => undefined),
    createSession: vi.fn(async () => ({ id: 'new', title: '' })),
    deleteSession: vi.fn(async () => undefined),
    executeCommand: vi.fn(async () => undefined),
    forkSession: vi.fn(async () => ({ id: 'forked' })),
    generateSessionText: vi.fn(async () => 'answer'),
    interruptSession: vi.fn(async () => undefined),
    listArchivedSessions: vi.fn(async () => []),
    revertSession: vi.fn(async () => undefined),
    shareSession: vi.fn(async () => ({ id: 's' })),
    switchSessionModel: vi.fn(async () => undefined),
    summarizeSession: vi.fn(async () => undefined),
    unrevertSession: vi.fn(async () => undefined),
    unshareSession: vi.fn(async () => ({ id: 's' })),
    updateSessionTitle: vi.fn(async () => ({ id: 's' })),
    waitForSessionIdle: vi.fn(async () => undefined),
  };
  const { useSessionCrudActions } = await loadTs('features/sessions/state/use-session-crud-actions.ts', {
    react: runtime.react,
    '@/shared/protocol/services/session-service': services,
    "@/features/sessions/services/session-cache": { persistSessionCache: vi.fn(async () => undefined) }
  });
  return { useSessionCrudActions, services };
}

function sessionCrudInput(patch: Record<string, unknown> = {}) {
  let sessions: any[] = (patch.sessions as any[] | undefined) ?? [];
  let statuses: Record<string, any> = {};
  let currentSessionId: string | undefined = patch.currentSessionId as string | undefined;
  const currentSessionIdRef: { current: string | undefined } = { current: currentSessionId };
  const explicitSessionSelectionRef: { current: string | undefined } = { current: undefined };
  return {
    currentSessionIdRef,
    explicitSessionSelectionRef,
    state: {
      get sessions() { return sessions; },
      get statuses() { return statuses; },
      get currentSessionId() { return currentSessionId; },
    },
    input: {
      client: { __opencode: { contract: 'v2' } },
      catalogClient: {},
      isCurrentClient: () => true,
      isCurrentCatalogClient: () => true,
      activeProjectPath: '/repo',
      connectionScopeRef: { current: 'scope' },
      currentSessionId,
      availableAgents: [{ id: 'build', label: 'Build', mode: 'primary' }],
      availableModels: [],
      readDiffScope: () => undefined,
      sessions,
      sessionStatuses: statuses,
      commands: [],
      currentSessionIdRef,
      explicitSessionSelectionRef,
        forgetSessionCreation: vi.fn(),
      setCurrentSessionId: (value: any) => {
        currentSessionId = typeof value === 'function' ? value(currentSessionId) : value;
        currentSessionIdRef.current = currentSessionId;
      },
      setSessions: (value: any) => { sessions = typeof value === 'function' ? value(sessions) : value; },
      setSessionStatuses: (value: any) => { statuses = typeof value === 'function' ? value(statuses) : value; },
      setMessagesBySession: () => undefined,
      setDiffsBySession: () => undefined,
      setTodosBySession: () => undefined,
      setPendingPermissionsBySession: () => undefined,
      setPendingQuestionsBySession: () => undefined,
      setFavoriteSessions: () => undefined,
      setArchivedSessions: () => undefined,
      refreshSessions: async () => [],
      refreshMessages: async () => [],
      beginHydration: () => () => undefined,
      refreshSessionDiff: async () => [],
      refreshSessionTodos: async () => [],
      refreshVcsDiff: async () => [],
      refreshPendingInteractions: async () => undefined,
      refreshActiveSessions: async () => undefined,
      chatPreferences: { mode: 'build', promptDelivery: 'steer', recentModelIds: [] },
      ...patch,
    },
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
    const refresh = deferredGate<{ id: string; title: string }[]>();
    const list = cache.fetchQuery({ queryKey: catalog.projectKey, queryFn: () => refresh.promise });

    await expect(fixture.createSession()).resolves.toEqual({ id: 'new', title: '' });
    expect(sessionService.createSession).toHaveBeenCalledOnce();
    expect(sessionService.switchSessionModel).not.toHaveBeenCalled();
    expect(catalog.readSessions()).toEqual([{ id: 'new', title: '' }]);
    expect(cache.getQueryState(catalog.projectKey)?.fetchStatus).toBe('fetching');
    expect(cache.getQueryData(catalog.catalogKey)).toEqual({ sessions: [], statuses: { new: { type: 'idle' } } });
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(), 1001)).toEqual(new Set(['new']));

    refresh.resolve([{ id: 'new', title: '' }]);
    await list;
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
    const runtime = hookRuntime();
    const { useSessionCrudActions, services } = await loadSessionCrud(runtime);
    const rename = deferredGate<{ id: string }>();
    services.updateSessionTitle.mockReturnValueOnce(rename.promise);
    const { state, input } = sessionCrudInput({ sessions: [{ id: 's', title: 'Old' }] });
    runtime.mount(useSessionCrudActions, input);

    const renaming = runtime.value.renameSession('s', 'New');
    await Promise.resolve();
    expect(state.sessions[0].title).toBe('New');

    rename.reject(new Error('rename failed'));
    await expect(renaming).rejects.toThrow('rename failed');
    expect(state.sessions[0].title).toBe('Old');

    runtime.unmount();
  });

  it('revertSession stops and settles a running session before staging', async () => {
    const runtime = hookRuntime();
    const { useSessionCrudActions, services } = await loadSessionCrud(runtime);
    const order: string[] = [];
    services.interruptSession.mockImplementation(async () => { order.push('interrupt'); });
    services.waitForSessionIdle.mockImplementation(async () => { order.push('wait'); });
    services.revertSession.mockImplementation(async () => { order.push('revert'); });
    const { input } = sessionCrudInput();
    runtime.mount(useSessionCrudActions, input);

    await runtime.value.revertSession('s', 'm1');

    expect(order).toEqual(['interrupt', 'wait', 'revert']);
    expect(services.revertSession).toHaveBeenCalledWith(expect.anything(), 's', 'm1');
    runtime.unmount();
  });

  it('revertSession does not stage when the session cannot be stopped', async () => {
    const runtime = hookRuntime();
    const { useSessionCrudActions, services } = await loadSessionCrud(runtime);
    services.interruptSession.mockRejectedValueOnce(new Error('stop failed'));
    const { input } = sessionCrudInput();
    runtime.mount(useSessionCrudActions, input);

    await expect(runtime.value.revertSession('s', 'm1')).rejects.toThrow('stop failed');

    expect(services.waitForSessionIdle).not.toHaveBeenCalled();
    expect(services.revertSession).not.toHaveBeenCalled();
    runtime.unmount();
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
    const runtime = hookRuntime();
    const utilities = await loadTs(["features/projects/model/project-utils.ts","features/sessions/model/session-utils.ts","shared/utilities/prune.ts"]);
    const request = { id: 'p1', sessionID: 's' };
    const { useProjectRefreshActions } = await loadTs('runtime/workspace/use-project-refresh-actions.ts', {
    react: runtime.react,
    "@/features/projects/model/project-utils": utilities,
    "@/features/sessions/model/session-utils": utilities,
    "@/shared/utilities/prune": utilities,
    "@/features/sessions/services/session-cache": { persistSessionCache: async () => {} },
    "@/shared/protocol/opencode/contracts/interactions": { listPendingInteractions: async () => ({ permissions: [request], questions: undefined }) },
    "@/shared/presentation/transcript": { resolveDiffTurn: () => undefined }
  });
    const suppressed = { current: new Set(['p1']) };
    const setPermissions = vi.fn();
    const setQuestions = vi.fn();
    runtime.mount(useProjectRefreshActions, {
      client: {},
      isCurrentClient: () => true,
      isPermissionReplyPending: (id: string) => suppressed.current.has(id),
      setPendingPermissionsBySession: setPermissions,
      setPendingQuestionsBySession: setQuestions,
    });

    await runtime.value.refreshPendingInteractions();
    expect(setPermissions).toHaveBeenCalledWith({});
    expect(setQuestions).not.toHaveBeenCalled();

    suppressed.current.clear();
    await runtime.value.refreshPendingInteractions();
    expect(setPermissions).toHaveBeenLastCalledWith({ s: [request] });

    runtime.unmount();
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
    const { useSessionCrudActions, services } = await loadSessionCrud(runtime);
    const { input } = sessionCrudInput({});
    runtime.mount(useSessionCrudActions, { ...input, chatPreferences: { ...input.chatPreferences, mode: 'summary' },
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
    const { useSessionCrudActions, services } = await loadSessionCrud(runtime);
    const { input } = sessionCrudInput({});
    runtime.mount(useSessionCrudActions, input);

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
