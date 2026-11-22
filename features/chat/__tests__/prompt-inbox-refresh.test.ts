import { describe, expect, it, vi } from 'vitest';

import type { PendingPrompt } from '@/shared/protocol/opencode/prompt-inbox';
import { createTestInbox } from '../../../tests/helpers/prompt-inbox';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({}));

const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };

describe('prompt inbox refresh', () => {
  it('only promotes a delivered prompt after the server inbox no longer holds it', async () => {
    const prompt: PendingPrompt = { id: 'm1', sessionId: 's', createdAt: 1, text: 'Waiting prompt', state: 'waiting', delivery: 'steer', attachments: [] };
    const inbox = vi.fn(async () => [prompt]);
    const appendUserMessage = vi.fn();
    const client = { __opencode: { contract: 'v2', directory: '/workspace' }, promptInbox: { list: inbox } } as never;
    const runtime = createTestInbox().configure({
      identity, client, scope: 'scope', isCurrentClient: () => true, readMessages: async () => [], appendUserMessage,
      connected: true, online: true,
    });
    const delivery = { inboxOnly: true, delivered: true, inboxID: 'm1' };
    await runtime.value.refreshMessages('s', true, delivery);
    expect(appendUserMessage).not.toHaveBeenCalled();

    inbox.mockResolvedValueOnce([]);
    await runtime.value.refreshMessages('s', true, delivery);
    expect(appendUserMessage).toHaveBeenCalledExactlyOnceWith('s', { id: 'm1', createdAt: 1, text: 'Waiting prompt', attachments: [] });
  });

  it('flushes a workspace outbox on reconnect and ignores remote results from superseded credentials', async () => {
    const admission = Promise.withResolvers<unknown>();
    const submit = vi.fn(() => admission.promise);
    const { store, query, controller } = createTestInbox();
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
    expect(query.getQueryCache().getAll()).toHaveLength(0);
    expect(submit).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('skips the inbox for a targeted message reconcile but reads it for a page', async () => {
    const inbox = vi.fn(async () => []);
    const notices = vi.fn(async () => []);
    const readMessages = vi.fn(async () => []);
    const { value } = createTestInbox().configure({
      identity, client: { __opencode: { contract: 'v2', directory: '/workspace' }, promptInbox: { list: inbox, listNotices: notices } } as never,
      scope: 'scope', isCurrentClient: () => true, readMessages, connected: true, online: true,
    });

    await value.refreshMessages('s', true, { messageId: 'm1' });
    expect(readMessages).toHaveBeenCalledWith('s', true, { messageId: 'm1' });
    expect(inbox).not.toHaveBeenCalled();

    await value.refreshMessages('s', true);
    expect(inbox).toHaveBeenCalledOnce();
    expect(readMessages).toHaveBeenCalledTimes(2);
  });
});
