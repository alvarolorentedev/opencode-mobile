import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

const client = { id: 'client-one' };
const nextClient = { id: 'client-two' };

async function mount(refreshMessages: (...args: any[]) => Promise<unknown>, isCurrentClient = () => true) {
  const runtime = hookRuntime();
  const { useTranscriptReadErrors } = await loadTs('features/chat/state/use-transcript-read-errors.ts', {
    react: runtime.react,
    "@/shared/utilities/error-message": { getErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }
  });
  runtime.mount(useTranscriptReadErrors, { client, isCurrentClient, refreshMessages });
  return runtime;
}

async function read(runtime: ReturnType<typeof hookRuntime>, sessionId: string, silent = false) {
  try {
    await runtime.value.readMessages(sessionId, silent);
  } catch {
    // The hook rethrows so callers can keep their existing failure handling.
  }
  await runtime.settle();
}

describe('transcript read errors', () => {
  it('keeps a cold failure visible until a retry succeeds', async () => {
    const refreshMessages = vi.fn().mockRejectedValueOnce(new Error('request timed out')).mockResolvedValueOnce([]);
    const runtime = await mount(refreshMessages);

    await read(runtime, 'session-1');
    expect(runtime.value.errors['session-1']).toBe('request timed out');

    await read(runtime, 'session-1');
    expect(runtime.value.errors['session-1']).toBeUndefined();
    runtime.unmount();
  });

  it('does not surface background refresh failures', async () => {
    const runtime = await mount(vi.fn().mockRejectedValue(new Error('silent failure')));
    await read(runtime, 'session-1', true);
    expect(runtime.value.errors).toEqual({});
    runtime.unmount();
  });

  it('ignores failures from a replaced client', async () => {
    const runtime = await mount(vi.fn().mockRejectedValue(new Error('boom')), () => false);
    await read(runtime, 'session-1');
    expect(runtime.value.errors).toEqual({});
    runtime.update({ client: nextClient });
    expect(runtime.value.errors).toEqual({});
    runtime.unmount();
  });

  it('hides errors after the client changes', async () => {
    const runtime = await mount(vi.fn().mockRejectedValue(new Error('boom')));
    await read(runtime, 'session-1');
    expect(runtime.value.errors['session-1']).toBe('boom');
    runtime.update({ client: nextClient });
    expect(runtime.value.errors).toEqual({});
    runtime.unmount();
  });
});
