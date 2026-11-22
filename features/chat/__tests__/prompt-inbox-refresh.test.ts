import { describe, expect, it, vi } from 'vitest';

import { deferred, hookRuntime } from '../../../tests/helpers/runtime.mjs';
import { createFixtureInbox, loadPromptInbox } from '../../../runtime/__tests__/prompt-command-fixture';

const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };

describe('prompt inbox refresh', () => {
  it('only promotes a delivered prompt after the server inbox no longer holds it', async () => {
    const runtime = hookRuntime();
    const prompt = { id: 'm1', sessionId: 's', createdAt: 1, text: 'Waiting prompt', state: 'waiting', delivery: 'steer', attachments: [] };
    const inbox = vi.fn(async () => [prompt]);
    const appendUserMessage = vi.fn();
    const client = { __opencode: { contract: 'v2', directory: '/workspace' }, promptInbox: {} } as never;
    const { usePromptInbox } = await loadPromptInbox(runtime, {
      '@/shared/protocol/services/session-service': { getSessionInbox: inbox, getSessionNotices: async () => [] },
      '@/shared/protocol/opencode/client/errors': { classifyConnectionFailure: () => 'unknown' },
    });
    runtime.mount(() => usePromptInbox({
      identity,
      client, queueScope: 'scope', isCurrentClient: () => true, refreshMessages: async () => [], appendUserMessage,
    }), {});
    const delivery = { inboxOnly: true, delivered: true, inboxID: 'm1' };
    await runtime.value.refreshMessages('s', true, delivery);
    expect(appendUserMessage).not.toHaveBeenCalled();

    inbox.mockResolvedValueOnce([]);
    await runtime.value.refreshMessages('s', true, delivery);
    expect(appendUserMessage).toHaveBeenCalledExactlyOnceWith('s', { id: 'm1', createdAt: 1, text: 'Waiting prompt', attachments: [] });
    runtime.unmount();
  });

  it('flushes a workspace outbox on reconnect and ignores remote results from superseded credentials', async () => {
    const runtime = hookRuntime();
    const admission = deferred();
    const submit = vi.fn(() => admission.promise);
    const { store, query, prompt } = await createFixtureInbox(runtime, {
      '@/shared/protocol/services/session-service': {},
      '@/shared/protocol/opencode/client/errors': { classifyConnectionFailure: () => 'unknown' },
    });
    const controller = prompt.createInbox();
    const client = { __opencode: { contract: 'v2', directory: '/workspace' }, promptInbox: { submit } } as never;
    const input = {
      client, identity: { connectionId: 'saved', connectionScope: 'connection', authRevision: 0 },
      isCurrentClient: () => true, readMessages: async () => [], scope: 'scope', connected: true, online: false,
    };
    controller.configure(input);
    const actions = controller.actions(input);
    await actions.submitPrompt({ sessionID: 's', parts: [] }, 'steer');
    expect(submit).not.toHaveBeenCalled();
    expect(store.getState().prompt.scope?.outbox?.bySession.s[0].prompt.state).toBe('queued');

    controller.configure({ ...input, online: true });
    expect(submit).toHaveBeenCalledOnce();
    expect(store.getState().prompt.scope?.outbox?.bySession.s[0].prompt.state).toBe('sending');
    controller.configure({ ...input, online: true, identity: { ...input.identity, authRevision: 1 } });
    admission.resolve({ id: 'prior-credential-prompt' });
    await expect.poll(() => store.getState().prompt.scope?.outbox?.bySession.s).toEqual([]);
    expect(query.useQueryClient().getQueryCache().getAll()).toHaveLength(0);
    expect(submit).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('skips the inbox for a targeted message reconcile but reads it for a page', async () => {
    const runtime = hookRuntime();
    const inbox = vi.fn(async () => []);
    const notices = vi.fn(async () => []);
    const readMessages = vi.fn(async () => []);
    const { usePromptInbox } = await loadPromptInbox(runtime, {
      '@/shared/protocol/services/session-service': { getSessionInbox: inbox, getSessionNotices: notices, submitLegacyPrompt: async () => undefined },
      '@/shared/protocol/opencode/client/errors': { classifyConnectionFailure: () => 'unknown' },
      '@/shared/utilities/error-message': { getErrorMessage: (error: unknown) => String(error) },
    });
    const value = runtime.mount(() => usePromptInbox({
      identity,
      client: { __opencode: { contract: 'v2', directory: '/workspace' }, promptInbox: {} } as never,
      queueScope: 'scope',
      isCurrentClient: () => true,
      refreshMessages: readMessages,
    }), {});

    await value.refreshMessages('s', true, { messageId: 'm1' });
    expect(readMessages).toHaveBeenCalledWith('s', true, { messageId: 'm1' });
    expect(inbox).not.toHaveBeenCalled();

    await value.refreshMessages('s', true);
    expect(inbox).toHaveBeenCalledOnce();
    expect(readMessages).toHaveBeenCalledTimes(2);
    runtime.unmount();
  });
});
