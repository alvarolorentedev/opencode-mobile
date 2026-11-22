import { describe, expect, it, vi } from 'vitest';
import { createTranscriptReader } from '@/features/chat/services/transcript-reader';
import { createAppStore } from '@/runtime/core/store';

const client = { id: 'client-one' };
const nextClient = { id: 'client-two' };

type RefreshMessages = Parameters<typeof createTranscriptReader>[1]['refreshMessages'];

function setup(refreshMessages: RefreshMessages, isCurrentClient = () => true) {
  const scopeKey = 'project';
  const store = createAppStore({ settings: { serverUrl: '', username: '', password: '', directory: '' },
    chatPreferences: {} as never, controlPlaneUrl: '' });
  const createReader = (selected: object) => createTranscriptReader(store, { client: selected, scopeKey, isCurrentClient, refreshMessages });
  let reader = createReader(client);
  return {
    errors: () => store.getState().chat[scopeKey]?.readErrors ?? {},
    read: (sessionId: string, silent = false) => reader.readMessages(sessionId, silent).catch(() => undefined),
    replaceClient(selected: object) {
      reader.reset();
      reader = createReader(selected);
    },
  };
}

describe('transcript read errors', () => {
  it('keeps a cold failure visible until a retry succeeds', async () => {
    const refreshMessages = vi.fn().mockRejectedValueOnce(new Error('request timed out')).mockResolvedValueOnce([]);
    const runtime = setup(refreshMessages);

    await runtime.read('session-1');
    expect(runtime.errors()['session-1']).toBe('request timed out');

    await runtime.read('session-1');
    expect(runtime.errors()['session-1']).toBeUndefined();
  });

  it('does not surface background refresh failures', async () => {
    const runtime = setup(vi.fn().mockRejectedValue(new Error('silent failure')));
    await runtime.read('session-1', true);
    expect(runtime.errors()).toEqual({});
  });

  it('ignores failures from a replaced client', async () => {
    const runtime = setup(vi.fn().mockRejectedValue(new Error('boom')), () => false);
    await runtime.read('session-1');
    expect(runtime.errors()).toEqual({});
    runtime.replaceClient(nextClient);
    expect(runtime.errors()).toEqual({});
  });

  it('hides errors after the client changes', async () => {
    const runtime = setup(vi.fn().mockRejectedValue(new Error('boom')));
    await runtime.read('session-1');
    expect(runtime.errors()['session-1']).toBe('boom');
    runtime.replaceClient(nextClient);
    expect(runtime.errors()).toEqual({});
  });
});
