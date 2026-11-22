import '../../tests/helpers/native-view-hosts';
import '../../tests/helpers/native-animation';
import '../../tests/helpers/cloud-link-platform';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { reconcileProjectSessionSelection } from '@/runtime/core/project-session-selection';
import { createSessionNavigationCommands } from '@/runtime/core/commands/session-navigation';
import { getLiveTranscriptBuffer } from '@/features/chat/model/live-transcript';
import { forgetSessionCreation, recentlyCreatedSessionIds, sessionCreationCommands } from '@/features/sessions/services/session-creation';
import { sessionCatalogAccess } from '@/features/sessions/services/session-catalog-access';
import { sessionEditCommands } from '@/features/sessions/services/session-editing';
import { sessionRefreshCommands } from '@/features/sessions/services/session-refresh';
import type { ModelOption } from '@/shared/contracts/model-options';
import { createAppStore } from '@/runtime/core/store';
import type { CommandContext } from '@/runtime/core/commands/context';
import type { RealtimeScopeInput } from '@/runtime/realtime/create-realtime';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { projectQueryKey } from '@/shared/server-data/keys';

import { createSessionExecutionActions } from '@/features/sessions/services/session-execution';
import { createInteractionCommands } from '@/features/sessions/services/interaction-commands';
import { projectSessionsKey } from '@/features/sessions/services/queries';
import { i18n } from '@/shared/i18n/index';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { PromptCommandInput } from '@/features/chat/runtime';

import { promptFixture } from './real-prompt-fixture';

vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-clipboard', () => ({}));

function sessionData(id: string) {
  return { id, title: '', time: { created: 1_000, updated: 1_000 } };
}

function sessionCreationFixture({ preferred = false }: { preferred?: boolean } = {}) {
  const api = {
    session: {
      create: vi.fn(async () => sessionData('new')), fork: vi.fn(async () => sessionData('fork')),
      switchModel: vi.fn(async () => {}), list: vi.fn(async () => ({ data: [] as ReturnType<typeof sessionData>[] })),
      active: vi.fn(async () => ({})), remove: vi.fn(async () => {}),
      update: vi.fn(async () => {}), get: vi.fn(async () => sessionData('s')),
      interrupt: vi.fn(async () => {}), wait: vi.fn(async () => {}),
      revert: { stage: vi.fn(async () => {}), clear: vi.fn(async () => {}) },
    },
    permission: { request: { list: vi.fn(async () => ({ data: [] as unknown[] })) } },
    form: { list: vi.fn(async () => ({ data: [] })) },
  };
  const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const identity = { connectionId: 'server', connectionScope: 'scope', authRevision: 0 };
  const client = { __opencode: { contract: 'v2', directory: '/repo' }, api } as unknown as ScopedOpencodeClient;
  const catalog = sessionCatalogAccess(cache, identity, client);
  const model = { id: 'openai/gpt-5', providerID: 'openai', modelID: 'gpt-5' } as ModelOption;
  const commands = sessionCreationCommands({ cache, identity, client, isCurrent: () => true, clock: () => 1_000, recentModel: () => preferred ? model : undefined });
  return { ...commands, cache, catalog, client, identity, api };
}

function sessionEditFixture() {
  const { cache, catalog, client, identity, api } = sessionCreationFixture();
  const refreshMessages = vi.fn(async (..._args: unknown[]) => []);
  const commands = sessionEditCommands({ cache, client, identity, isCurrent: () => true,
    clearSession: vi.fn(), runRename: (_key, rename) => rename(), refreshSessions: async () => [],
    refreshSessionDiff: async () => [], refreshMessages, refreshActiveSessions: async () => {},
  });
  return { cache, catalog, client, ...commands, refreshMessages, api };
}

function sessionNavigationFixture(sessions: { id: string }[] = [], overrides: Partial<RealtimeScopeInput> = {}) {
  const target = { connectionId: 'server', projectPath: '/repo' };
  const scopeKey = JSON.stringify([target.connectionId, target.projectPath]);
  const identity = { connectionId: target.connectionId, connectionScope: 'scope', authRevision: 0 };
  const client = { __opencode: { contract: 'v2', directory: target.projectPath } } as ScopedOpencodeClient;
  const store = createAppStore({ settings: { serverUrl: 'http://server', username: '', password: '', directory: '' }, chatPreferences: {} as never, controlPlaneUrl: '' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const key = projectSessionsKey(identity, client);
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

function sessionExecutionFixture() {
  const session = {
    compact: vi.fn(async () => {}), command: vi.fn(async () => {}),
    generate: vi.fn(async () => ({ text: 'answer' })), switchAgent: vi.fn(async () => {}),
  };
  const input: Parameters<typeof createSessionExecutionActions>[0] = {
    client: { __opencode: { contract: 'v2' }, api: { session } } as unknown as ScopedOpencodeClient,
    isCurrentClient: () => true,
    availableAgents: [{ id: 'build', label: 'Build', mode: 'primary' }],
    commands: [],
    refreshSessions: async () => [],
    refreshMessages: async () => [],
    chatPreferences: { ...defaultChatPreferences, mode: 'build' },
  };
  return { input, session };
}

describe('local-first session selection', () => {
  it('keeps an explicit selection while the project catalog is stale, then reconciles later removal', async () => {
    const previous = [{ id: 'old' }];
    let explicitSessionId: string | undefined = 'target';
    let currentSessionId: string | undefined = 'target';
    const setCurrentSessionId = vi.fn((id?: string) => { currentSessionId = id; });
    const reconcile = (sessions: { id: string }[]) => reconcileProjectSessionSelection({
      sessions, currentSessionId, explicitSessionId, setCurrentSessionId,
      clearExplicitSessionId: () => { explicitSessionId = undefined; },
    });

    reconcile(previous);
    expect(setCurrentSessionId).not.toHaveBeenCalled();
    expect(currentSessionId).toBe('target');
    expect(explicitSessionId).toBe('target');

    // Another stale list must not override the tap while the target is loading.
    reconcile([...previous]);
    expect(setCurrentSessionId).not.toHaveBeenCalled();

    reconcile([...previous, { id: 'target' }]);
    expect(explicitSessionId).toBeUndefined();
    expect(setCurrentSessionId).not.toHaveBeenCalled();

    reconcile(previous);
    expect(setCurrentSessionId).toHaveBeenCalledWith('old');
    expect(currentSessionId).toBe('old');
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
    const { cache, catalog, client, identity, api } = fixture;
    const created = { id: 'new', title: '', time: { created: 1000, updated: 1000 } };
    api.session.create.mockResolvedValueOnce(created);
    const reply = deferredGate<{ data: ReturnType<typeof sessionData>[] }>();
    api.session.list.mockReset().mockReturnValueOnce(reply.promise);
    const commands = sessionRefreshCommands({ cache, identity, client, isCurrent: () => true, clock: () => 1_001, isPermissionReplyPending: () => false });
    const list = commands.refreshSessions();

    await expect(fixture.createSession()).resolves.toEqual(created);
    expect(api.session.list).toHaveBeenCalledExactlyOnceWith({ directory: '/repo' });
    expect(api.session.create).toHaveBeenCalledOnce();
    expect(api.session.switchModel).not.toHaveBeenCalled();
    expect(catalog.readSessions()).toEqual([created]);
    expect(cache.getQueryData(catalog.catalogKey)).toEqual({ sessions: [], statuses: { new: { type: 'idle' } } });
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(), 1001)).toEqual(new Set(['new']));

    reply.resolve({ data: [] });
    await expect(list).resolves.toEqual([created]);
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(['new']), 1002)).toEqual(new Set());
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(), 1003)).toEqual(new Set());
    cache.clear();
  });

  it('createSession starts on the model the user last picked', async () => {
    const fixture = sessionCreationFixture({ preferred: true });
    const model = { providerID: 'openai', id: 'gpt-5' };
    await expect(fixture.createSession()).resolves.toEqual({ ...sessionData('new'), model });
    expect(fixture.api.session.switchModel).toHaveBeenCalledWith({ sessionID: 'new', model });
    expect(fixture.catalog.readSessions()[0].model).toEqual(model);
    fixture.cache.clear();
  });

  it('createSession keeps the server default when the last model cannot be applied', async () => {
    const fixture = sessionCreationFixture({ preferred: true });
    fixture.api.session.switchModel.mockRejectedValueOnce(new Error('model unavailable'));

    await expect(fixture.createSession()).resolves.toEqual(sessionData('new'));
    expect(fixture.catalog.readSessions()[0].model).toBeUndefined();
    fixture.cache.clear();
  });

  it('publishes the returned fork and removes the grace entry when the session is removed', async () => {
    const fixture = sessionCreationFixture();
    const { cache, catalog, client, identity, api } = fixture;
    await expect(fixture.forkSession('source', 'point')).resolves.toEqual(sessionData('fork'));
    expect(api.session.fork).toHaveBeenCalledExactlyOnceWith({ sessionID: 'source', before: 'point' });
    expect(catalog.readSessions()).toEqual([sessionData('fork')]);
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(), 1001)).toEqual(new Set(['fork']));
    forgetSessionCreation(cache, identity, client, 'fork');
    expect(recentlyCreatedSessionIds(cache, identity, client, new Set(), 1002)).toEqual(new Set());
    cache.clear();
  });

  it('renameSession echoes the title and rolls back on failure', async () => {
    const fixture = sessionEditFixture();
    const rename = deferredGate<void>();
    fixture.api.session.update.mockReturnValueOnce(rename.promise);
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
    fixture.api.session.interrupt.mockImplementation(async () => { order.push('interrupt'); });
    fixture.api.session.wait.mockImplementation(async () => { order.push('wait'); });
    fixture.api.session.revert.stage.mockImplementation(async () => { order.push('revert'); });

    await fixture.revertSession('s', 'm1');

    expect(order).toEqual(['interrupt', 'wait', 'revert']);
    expect(fixture.api.session.revert.stage).toHaveBeenCalledWith({ sessionID: 's', messageID: 'm1' });
    fixture.cache.clear();
  });

  it('revertSession does not stage when the session cannot be stopped', async () => {
    const fixture = sessionEditFixture();
    fixture.api.session.interrupt.mockRejectedValueOnce(new Error('stop failed'));

    await expect(fixture.revertSession('s', 'm1')).rejects.toThrow('stop failed');

    expect(fixture.api.session.wait).not.toHaveBeenCalled();
    expect(fixture.api.session.revert.stage).not.toHaveBeenCalled();
    fixture.cache.clear();
  });

  it('unrevert replaces the displayed transcript after the server clears the rewind', async () => {
    const fixture = sessionEditFixture();
    await fixture.unrevertSession('s');

    expect(fixture.api.session.revert.clear).toHaveBeenCalledExactlyOnceWith({ sessionID: 's' });
    expect(fixture.refreshMessages).toHaveBeenCalledExactlyOnceWith('s', true, { mode: 'replace' });
    fixture.cache.clear();
  });
});

describe('non-blocking prompt reconciliation', () => {
  it('returns after admission without a transcript read', async () => {
    const submitPrompt = vi.fn<PromptCommandInput['submitPrompt']>(async () =>
      ({ id: 'u1', sessionId: 's', createdAt: 1, text: 'Hello', attachments: [], delivery: 'steer', state: 'waiting' }));
    const refreshSessionDiff = vi.fn(async () => []);
    const refreshSessionTodos = vi.fn(async () => []);
    const scheduleSessionRefresh = vi.fn();
    const { runtime, store, scopeKey } = promptFixture({
      chatPreferences: { ...defaultChatPreferences, mode: 'summary' },
      refreshSessionDiff, refreshSessionTodos, scheduleSessionRefresh, submitPrompt,
    }, 'prompt-scope');
    const markLocalSend = vi.spyOn(getLiveTranscriptBuffer(store.getState().transcriptLive, scopeKey).localSends, 'set');

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
    expect(markLocalSend).toHaveBeenCalledWith('s', expect.any(Number));
    runtime.update({ availableAgents: [] });
    await expect(runtime.value.sendPrompt('s', 'Keep this draft')).rejects.toThrow(i18n.t('chat:composer.noEligibleAgent'));
    expect(submitPrompt).toHaveBeenCalledOnce();
    await runtime.settle();
    expect(runtime.value.promptError?.message).toBe(i18n.t('chat:composer.noEligibleAgent'));
    expect(scheduleSessionRefresh).toHaveBeenCalledOnce();
    expect(markLocalSend).toHaveBeenCalledOnce();
    expect(refreshSessionDiff).not.toHaveBeenCalled();
    expect(refreshSessionTodos).not.toHaveBeenCalled();
    runtime.unmount();
  });
});

describe('interaction refresh suppression', () => {
  it('does not re-add a request whose reply is in flight', async () => {
    const { cache, client, identity, api } = sessionCreationFixture();
    const request = { id: 'p1', sessionID: 's', permission: 'edit', patterns: [], always: [], metadata: {} };
    api.permission.request.list.mockResolvedValue({ data: [{ id: 'p1', sessionID: 's', action: 'edit', resources: [] }] });
    api.form.list.mockRejectedValue(new Error('Forms unavailable'));
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
    const { cache, catalog, client, identity, api } = sessionCreationFixture();
    const commands = sessionRefreshCommands({ cache, identity, client, isCurrent: () => true, clock: () => 1_001,
      isPermissionReplyPending: () => false });
    catalog.setSessionStatuses({ previous: { type: 'busy' } });
    api.session.list.mockReset();
    api.session.active.mockReset().mockResolvedValueOnce({ running: {} });
    await commands.refreshSessionStatuses();
    expect(cache.getQueryData(catalog.catalogKey)).toEqual({ sessions: [], statuses: {
      previous: { type: 'idle' }, running: { type: 'busy' },
    } });
    expect(api.session.list).not.toHaveBeenCalled();

    const sessions = [{ id: 'recovered', title: '', time: { created: 1000, updated: 1000 } }];
    api.session.active.mockRejectedValueOnce(new Error('status unavailable'));
    api.session.active.mockResolvedValueOnce({});
    api.session.list.mockResolvedValueOnce({ data: sessions });
    await commands.refreshSessionStatuses();
    expect(api.session.list).toHaveBeenCalledExactlyOnceWith({ directory: '/repo' });
    expect(catalog.readSessions()).toEqual(sessions);
    expect(cache.getQueryData(catalog.catalogKey)).toEqual({ sessions: [], statuses: { recovered: { type: 'idle' } } });
    cache.clear();
  });
});

describe('optimistic interaction replies', () => {
  it('removes a permission immediately and restores it when the reply fails', async () => {
    const reply = deferredGate();
    const request = { id: 'p1', sessionID: 's' };
    const client = {
      compatibility: {
        permission: { reply: vi.fn(() => reply.promise), list: async () => ({ data: [request] }) },
        question: { list: async () => ({ data: [] }) },
      },
    } as unknown as ScopedOpencodeClient;
    let permissions: Record<string, any[]> = { s: [request] };
    const suppressed = new Set<string>();
    const refreshMessages = vi.fn(async () => []);
    const input = {
      client,
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
    const request = { id: 'p1', sessionID: 's' };
    const client = {
      compatibility: {
        permission: { reply: vi.fn(() => Promise.resolve()), list: async () => ({ data: [request] }) },
        question: { list: async () => ({ data: [] }) },
      },
    } as unknown as ScopedOpencodeClient;
    let permissions: Record<string, any[]> = { s: [request] };
    const suppressed = new Set<string>();
    const refreshMessages = vi.fn(async () => []);
    const input = {
      client,
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
    const { input, session } = sessionExecutionFixture();
    const selected: typeof input = { ...input, chatPreferences: { ...input.chatPreferences, mode: 'summary' },
      availableAgents: [{ id: 'build', label: 'Build', mode: 'primary' }, { id: 'plan', label: 'Plan', mode: 'all' }], currentConfig: { default_agent: 'plan' } };
    const actions = createSessionExecutionActions(selected);
    await actions.executeCommand('s', 'review', '');
    expect(session.switchAgent).toHaveBeenCalledWith({ sessionID: 's', agent: 'plan' });
    expect(session.command).toHaveBeenCalledWith({ sessionID: 's', name: 'review', text: '' });
    const unavailable = createSessionExecutionActions({ ...selected, availableAgents: [{ id: 'general', label: 'General', mode: 'subagent' }] });
    await expect(unavailable.executeCommand('s', 'review', '')).rejects.toThrow(i18n.t('chat:composer.noEligibleAgent'));
    expect(session.command).toHaveBeenCalledOnce();
  });

  it('routes built-in compact and btw before the server command', async () => {
    const { input, session } = sessionExecutionFixture();
    const actions = createSessionExecutionActions(input);

    await actions.executeCommand('s', 'compact', '');
    expect(session.compact).toHaveBeenCalledWith({ sessionID: 's' });
    expect(session.command).not.toHaveBeenCalled();

    await expect(actions.executeCommand('s', 'btw', 'why?')).resolves.toEqual({ question: 'why?', answer: 'answer' });
    expect(session.generate).toHaveBeenCalledWith({ sessionID: 's', prompt: expect.stringContaining('why?') });
    expect(session.command).not.toHaveBeenCalled();

    await expect(actions.executeCommand('s', 'btw', '')).rejects.toThrow(i18n.t('chat:composer.sideQuestionEmpty'));
    await expect(actions.executeCommand('s', 'btw', 'why?', { attachments: [{ uri: 'file:///a' }] })).rejects.toThrow(i18n.t('chat:composer.builtinAttachmentsUnsupported'));

  });
});
