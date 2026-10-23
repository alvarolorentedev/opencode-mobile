import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

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
    createSession: vi.fn(async () => ({ id: 'new', title: '' })),
    deleteSession: vi.fn(async () => undefined),
    executeCommand: vi.fn(async () => undefined),
    forkSession: vi.fn(async () => ({ id: 'forked' })),
    listArchivedSessions: vi.fn(async () => []),
    revertSession: vi.fn(async () => undefined),
    shareSession: vi.fn(async () => ({ id: 's' })),
    summarizeSession: vi.fn(async () => undefined),
    unrevertSession: vi.fn(async () => undefined),
    unshareSession: vi.fn(async () => ({ id: 's' })),
    updateSessionTitle: vi.fn(async () => ({ id: 's' })),
  };
  const { useSessionCrudActions } = await loadTs('providers/use-session-crud-actions.ts', {
    react: runtime.react,
    '@/providers/services/session-service': services,
    '@/providers/opencode-model-selection': {
      getSelectedModelParts: () => undefined,
      getSelectedModelVariant: () => undefined,
    },
    '@/providers/session-cache': { persistSessionCache: vi.fn(async () => undefined) },
  });
  return { useSessionCrudActions, services };
}

function sessionCrudInput(patch: Record<string, unknown> = {}) {
  let sessions: any[] = (patch.sessions as any[] | undefined) ?? [];
  let statuses: Record<string, any> = {};
  let currentSessionId: string | undefined = patch.currentSessionId as string | undefined;
  let bootstrapping = false;
  const bootstrapPromiseRef: { current: Promise<string | undefined> | null } = { current: null };
  const bootstrapTokenRef: { current: object | undefined } = { current: undefined };
  const currentSessionIdRef: { current: string | undefined } = { current: currentSessionId };
  const explicitSessionSelectionRef: { current: string | undefined } = { current: undefined };
  const locallyCreatedSessionsRef = { current: new Map<string, number>() };
  return {
    bootstrapPromiseRef,
    bootstrapTokenRef,
    currentSessionIdRef,
    explicitSessionSelectionRef,
    locallyCreatedSessionsRef,
    state: {
      get sessions() { return sessions; },
      get statuses() { return statuses; },
      get currentSessionId() { return currentSessionId; },
      get bootstrapping() { return bootstrapping; },
    },
    input: {
      client: { __opencode: { contract: 'v2' } },
      catalogClient: {},
      isCurrentClient: () => true,
      isCurrentCatalogClient: () => true,
      activeProjectPath: '/repo',
      connectionScopeRef: { current: 'scope' },
      currentSessionId,
      availableModels: [],
      diffScopeBySessionRef: { current: {} },
      sessions,
      sessionStatuses: statuses,
      bootstrapPromiseRef,
      bootstrapTokenRef,
      currentSessionIdRef,
      explicitSessionSelectionRef,
      locallyCreatedSessionsRef,
      setIsBootstrappingChat: (value: any) => {
        bootstrapping = typeof value === 'function' ? value(bootstrapping) : value;
      },
      setLastSessionByConnection: () => undefined,
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
      fetchSessions: async () => [],
      refreshSessions: async () => undefined,
      refreshMessages: async () => [],
      refreshSessionDiff: async () => [],
      refreshSessionTodos: async () => [],
      refreshVcsDiff: async () => [],
      refreshPendingInteractions: async () => undefined,
      refreshActiveSessions: async () => undefined,
      chatPreferences: { modelId: undefined, modelVariantSelections: {}, mode: 'build', promptDelivery: 'steer' },
      ...patch,
    },
  };
}

describe('local-first session selection', () => {
  it('selects the active session before transcript hydration finishes', async () => {
    const runtime = hookRuntime();
    const { useSessionBootstrapActions } = await loadTs('providers/use-session-bootstrap-actions.ts', {
      react: runtime.react,
    });
    const hydration = deferredGate();
    let currentSessionId: string | undefined;
    const currentSessionIdRef: { current: string | undefined } = { current: undefined };
    let bootstrapping = false;
    let refreshes = 0;
    const input = {
      activeProjectPath: '/repo',
      connection: { status: 'connected' },
      connectionScope: 'scope',
      client: {},
      createSession: async () => ({ id: 'created' }),
      currentSessionId: undefined,
      currentSessionIdRef,
      explicitSessionSelectionRef: { current: undefined },
      sessions: [{ id: 'target' }],
      sessionsRef: { current: [{ id: 'target' }] },
      messagesBySession: {},
      lastSessionByConnection: {},
      pendingDeepLinkTargetRef: { current: undefined },
      bootstrapPromiseRef: { current: null },
      bootstrapTokenRef: { current: undefined },
      isCurrentClient: () => true,
      fetchSessions: async () => [{ id: 'target' }],
      refreshMessages: async () => { refreshes += 1; await hydration.promise; return []; },
      refreshSessionDiff: async () => [],
      refreshSessionTodos: async () => [],
      refreshPendingInteractions: async () => undefined,
      refreshChatCapabilities: async () => undefined,
      refreshServerFeatures: async () => undefined,
      refreshDiagnostics: async () => undefined,
      setCurrentSessionId: (value: any) => {
        currentSessionId = typeof value === 'function' ? value(currentSessionId) : value;
        currentSessionIdRef.current = currentSessionId;
      },
      setLastSessionByConnection: () => undefined,
      setIsBootstrappingChat: (value: any) => {
        bootstrapping = typeof value === 'function' ? value(bootstrapping) : value;
      },
    };
    runtime.mount(useSessionBootstrapActions, input);

    await expect(runtime.value.ensureActiveSession()).resolves.toBe('target');
    expect(currentSessionId).toBe('target');
    expect(currentSessionIdRef.current).toBe('target');
    expect(bootstrapping).toBe(false);
    expect(refreshes).toBe(1);

    hydration.resolve();
    await runtime.settle();
    runtime.unmount();
  });

  it('does not let a superseded bootstrap overwrite an explicit selection', async () => {
    const runtime = hookRuntime();
    const { useSessionBootstrapActions } = await loadTs('providers/use-session-bootstrap-actions.ts', {
      react: runtime.react,
    });
    const fetchGate = deferredGate<any[]>();
    let currentSessionId: string | undefined;
    const currentSessionIdRef: { current: string | undefined } = { current: undefined };
    let bootstrapping = false;
    const input = {
      activeProjectPath: '/repo',
      connection: { status: 'connected' },
      connectionScope: 'scope',
      client: {},
      createSession: async () => ({ id: 'created' }),
      currentSessionId: undefined,
      currentSessionIdRef,
      explicitSessionSelectionRef: { current: undefined },
      sessions: [],
      sessionsRef: { current: [] },
      messagesBySession: {},
      lastSessionByConnection: {},
      pendingDeepLinkTargetRef: { current: undefined },
      bootstrapPromiseRef: { current: null },
      bootstrapTokenRef: { current: undefined },
      isCurrentClient: () => true,
      fetchSessions: async () => fetchGate.promise,
      refreshMessages: async () => [],
      refreshSessionDiff: async () => [],
      refreshSessionTodos: async () => [],
      refreshPendingInteractions: async () => undefined,
      refreshChatCapabilities: async () => undefined,
      refreshServerFeatures: async () => undefined,
      refreshDiagnostics: async () => undefined,
      setCurrentSessionId: (value: any) => {
        currentSessionId = typeof value === 'function' ? value(currentSessionId) : value;
        currentSessionIdRef.current = currentSessionId;
      },
      setLastSessionByConnection: () => undefined,
      setIsBootstrappingChat: (value: any) => {
        bootstrapping = typeof value === 'function' ? value(bootstrapping) : value;
      },
    };
    runtime.mount(useSessionBootstrapActions, input);

    const ensuring = runtime.value.ensureActiveSession();
    await runtime.settle();
    expect(input.bootstrapTokenRef.current).toBeDefined();
    input.bootstrapTokenRef.current = undefined;
    input.setCurrentSessionId('explicit');
    input.setIsBootstrappingChat(false);
    fetchGate.resolve([{ id: 'remembered' }]);

    await expect(ensuring).resolves.toBeUndefined();
    expect(currentSessionId).toBe('explicit');
    expect(bootstrapping).toBe(false);
    runtime.unmount();
  });

  it('accepts a just-selected session but still validates a missing deep-link target', async () => {
    const runtime = hookRuntime();
    const { useSessionBootstrapActions } = await loadTs('providers/use-session-bootstrap-actions.ts', {
      react: runtime.react,
    });
    const fetches: number[] = [];
    let pendingTarget: { sessionId: string } | undefined;
    const input = {
      activeProjectPath: '/repo',
      connection: { status: 'connected' },
      connectionScope: 'scope',
      client: {},
      createSession: async () => ({ id: 'created' }),
      currentSessionId: undefined,
      currentSessionIdRef: { current: 'explicit' as string | undefined },
      explicitSessionSelectionRef: { current: 'explicit' as string | undefined },
      sessions: [],
      sessionsRef: { current: [] },
      messagesBySession: {},
      lastSessionByConnection: {},
      pendingDeepLinkTargetRef: { get current() { return pendingTarget; } },
      bootstrapPromiseRef: { current: null },
      bootstrapTokenRef: { current: undefined },
      isCurrentClient: () => true,
      fetchSessions: async (...args: any[]) => { fetches.push(args.length); return []; },
      refreshMessages: async () => [],
      refreshSessionDiff: async () => [],
      refreshSessionTodos: async () => [],
      refreshPendingInteractions: async () => undefined,
      refreshChatCapabilities: async () => undefined,
      refreshServerFeatures: async () => undefined,
      setCurrentSessionId: () => undefined,
      setLastSessionByConnection: () => undefined,
      setIsBootstrappingChat: () => undefined,
    };
    runtime.mount(useSessionBootstrapActions, input);

    await expect(runtime.value.ensureActiveSession()).resolves.toBe('explicit');
    expect(fetches).toHaveLength(0);

    input.currentSessionIdRef.current = 'missing';
    input.explicitSessionSelectionRef.current = undefined;
    pendingTarget = { sessionId: 'missing' };
    input.bootstrapPromiseRef.current = null;
    await expect(runtime.value.ensureActiveSession()).resolves.toBeUndefined();
    expect(fetches).toHaveLength(1);
    runtime.unmount();
  });

  it('openSession returns after selection without waiting for hydration', async () => {
    const runtime = hookRuntime();
    const { useSessionCrudActions } = await loadSessionCrud(runtime);
    const hydration = deferredGate();
    const { state, input } = sessionCrudInput({
      refreshMessages: async () => { await hydration.promise; return []; },
    });
    runtime.mount(useSessionCrudActions, input);
    const inFlightBootstrap = Promise.resolve('remembered');
    input.bootstrapPromiseRef.current = inFlightBootstrap;
    input.bootstrapTokenRef.current = {};
    input.setIsBootstrappingChat(true);

    await expect(runtime.value.openSession('target')).resolves.toBeUndefined();
    expect(state.currentSessionId).toBe('target');
    expect(state.bootstrapping).toBe(false);
    expect(input.bootstrapPromiseRef.current).toBeNull();
    expect(input.bootstrapTokenRef.current).toBeUndefined();

    hydration.resolve();
    await runtime.settle();
    runtime.unmount();
  });

  it('createSession shows the returned session before the list refresh resolves', async () => {
    const runtime = hookRuntime();
    const { useSessionCrudActions, services } = await loadSessionCrud(runtime);
    const refresh = deferredGate();
    const { state, input } = sessionCrudInput({
      refreshSessions: async () => { await refresh.promise; },
    });
    runtime.mount(useSessionCrudActions, input);

    await expect(runtime.value.createSession()).resolves.toEqual({ id: 'new', title: '' });
    expect(services.createSession).toHaveBeenCalledOnce();
    expect(state.sessions).toEqual([{ id: 'new', title: '' }]);
    expect(state.statuses.new).toEqual({ type: 'idle' });

    refresh.resolve();
    await runtime.settle();
    runtime.unmount();
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
});

describe('non-blocking prompt reconciliation', () => {
  it('returns after admission while post-send reads are still pending', async () => {
    const runtime = hookRuntime();
    const preferences = await loadTs('providers/opencode-preferences.ts');
    const models = await loadTs('providers/opencode-model-selection.ts', {
      '@/providers/opencode-preferences': preferences,
    });
    const notifications = {
      clearPendingTaskFinishedNotification: vi.fn(async () => true),
      listPendingTaskFinishedNotifications: async () => [],
      notifyTaskFinished: vi.fn(),
      trackPendingTaskFinishedNotification: vi.fn(async () => undefined),
    };
    const { usePromptLifecycle } = await loadTs('providers/use-prompt-lifecycle.ts', {
      react: runtime.react,
      '@/providers/services/session-service': {
        interruptSession: async () => undefined,
        readSessionSettlement: async () => ({ state: 'finished' }),
      },
      '@/lib/notification-pending': { pendingNotificationKey: (scope: string, id: string) => `${scope}:${id}` },
      '@/lib/notifications': notifications,
      '@/providers/opencode-preferences': preferences,
      '@/providers/opencode-model-selection': models,
      '@/lib/connection-scope': {
        getConnectionScope: () => 'scope',
        getConnectionUiScope: () => 'scope',
      },
      '@/lib/opencode/attachment': { prepareAttachment: async (att: unknown) => att },
    });
    const refresh = deferredGate();
    let messagesSettled = false;
    const submitPrompt = vi.fn(async () => undefined);
    const refreshMessages = vi.fn(async () => { await refresh.promise; messagesSettled = true; return []; });
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
      availableModels: [],
      chatPreferences: preferences.defaultChatPreferences,
      settingsRef: { current: { serverUrl: 'http://server', username: '' } },
      busyNotificationsRef: { current: new Set() },
      promptSubmissionRef: { current: { active: false } },
      setSelectedDiffMessageBySession: vi.fn(),
      fetchSessions: vi.fn(async () => [{ id: 's', title: 'chat' }]),
      refreshSessions: vi.fn(async () => undefined),
      refreshMessages,
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
    expect(scheduleSessionRefresh).toHaveBeenCalledOnce();
    expect(refreshMessages).toHaveBeenCalledOnce();
    expect(messagesSettled).toBe(false);

    refresh.resolve();
    await runtime.settle();
    expect(messagesSettled).toBe(true);
    expect(refreshSessionDiff).toHaveBeenCalledOnce();
    expect(refreshSessionTodos).toHaveBeenCalledOnce();
    runtime.unmount();
  });
});

describe('interaction refresh suppression', () => {
  it('does not re-add a request whose reply is in flight', async () => {
    const runtime = hookRuntime();
    const utilities = await loadTs('providers/opencode-provider-utils.ts');
    const request = { id: 'p1', sessionID: 's' };
    const { useProjectRefreshActions } = await loadTs('providers/use-project-refresh-actions.ts', {
      react: runtime.react,
      '@/lib/opencode/client': { listPendingInteractions: async () => ({ permissions: [request], questions: undefined }) },
      '@/lib/opencode/transcript': { resolveDiffTurn: () => undefined },
      '@/providers/opencode-provider-utils': utilities,
      '@/providers/session-cache': {},
      '@/providers/services/session-service': {},
      '@/providers/services/project-service': {},
    });
    const suppressed = { current: new Set(['p1']) };
    const setPermissions = vi.fn();
    const setQuestions = vi.fn();
    runtime.mount(useProjectRefreshActions, {
      client: {},
      isCurrentClient: () => true,
      suppressedPendingRequestIdsRef: suppressed,
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
    const runtime = hookRuntime();
    const reply = deferredGate();
    const client = {
      replyToPendingPermission: vi.fn(() => reply.promise),
      replyToPendingQuestion: vi.fn(async () => undefined),
      rejectPendingQuestion: vi.fn(async () => undefined),
    };
    const { useSessionInteractionActions } = await loadTs('providers/use-session-interaction-actions.ts', {
      react: runtime.react,
      '@/lib/opencode/client': client,
    });
    const request = { id: 'p1', sessionID: 's' };
    let permissions: Record<string, any[]> = { s: [request] };
    const suppressed = new Set<string>();
    const refreshMessages = vi.fn(async () => []);
    const input = {
      client: {},
      pendingPermissionsBySession: permissions,
      pendingQuestionsBySession: {},
      setPendingPermissionsBySession: (value: any) => {
        permissions = typeof value === 'function' ? value(permissions) : value;
      },
      setPendingQuestionsBySession: () => undefined,
      suppressedPendingRequestIdsRef: { current: suppressed },
      refreshMessages,
      refreshSavedPermissions: vi.fn(async () => undefined),
    };
    runtime.mount(useSessionInteractionActions, input);

    const replying = runtime.value.replyToPermission('p1', 'once');
    await Promise.resolve();
    expect(permissions.s).toEqual([]);
    expect(suppressed.has('p1')).toBe(true);

    reply.reject(new Error('reply failed'));
    await expect(replying).rejects.toThrow('reply failed');
    expect(permissions.s).toEqual([request]);
    expect(suppressed.has('p1')).toBe(false);
    expect(refreshMessages).not.toHaveBeenCalled();

    runtime.unmount();
  });

  it('keeps the permission removed after a successful reply', async () => {
    const runtime = hookRuntime();
    const client = {
      replyToPendingPermission: vi.fn(async () => undefined),
      replyToPendingQuestion: vi.fn(async () => undefined),
      rejectPendingQuestion: vi.fn(async () => undefined),
    };
    const { useSessionInteractionActions } = await loadTs('providers/use-session-interaction-actions.ts', {
      react: runtime.react,
      '@/lib/opencode/client': client,
    });
    const request = { id: 'p1', sessionID: 's' };
    let permissions: Record<string, any[]> = { s: [request] };
    const suppressed = new Set<string>();
    const refreshMessages = vi.fn(async () => []);
    const input = {
      client: {},
      pendingPermissionsBySession: permissions,
      pendingQuestionsBySession: {},
      setPendingPermissionsBySession: (value: any) => {
        permissions = typeof value === 'function' ? value(permissions) : value;
      },
      setPendingQuestionsBySession: () => undefined,
      suppressedPendingRequestIdsRef: { current: suppressed },
      refreshMessages,
      refreshSavedPermissions: vi.fn(async () => undefined),
    };
    runtime.mount(useSessionInteractionActions, input);

    await expect(runtime.value.replyToPermission('p1', 'once')).resolves.toBeUndefined();
    expect(permissions.s).toEqual([]);
    expect(suppressed.has('p1')).toBe(false);
    expect(refreshMessages).toHaveBeenCalledWith('s', true);

    runtime.unmount();
  });
});
