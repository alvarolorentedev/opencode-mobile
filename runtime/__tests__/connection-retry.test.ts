import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConnectionRetry } from '@/runtime/connections/retry';

vi.mock('@/shared/protocol/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));

const clock = {
  now: () => Date.now(),
  setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
  clearTimeout: (timer?: ReturnType<typeof setTimeout>) => clearTimeout(timer),
};
const failure = { status: 'error', kind: 'unknown', message: 'Network failure' } as const;

afterEach(() => vi.useRealTimers());

describe('connect retry policy', () => {
  it('retries a retryable foreground failure with a bounded budget', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(async () => {
      retry.update({ status: 'connecting', message: '' }, true, true);
      retry.update(failure, true, true);
    });
    const retry = createConnectionRetry(connect, clock);
    retry.update(failure, true, true);
    expect(connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(5);
    expect(retry.getSnapshot()).toEqual({ attempt: 5, maxAttempts: 5 });
    retry.dispose();
  });

  it('does not auto-retry auth failures or spend attempts while offline', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(async () => undefined);
    const retry = createConnectionRetry(connect, clock);
    retry.update({ ...failure, kind: 'auth' }, true, true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connect).not.toHaveBeenCalled();

    retry.update(failure, true, false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connect).not.toHaveBeenCalled();

    retry.update(failure, false, true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connect).not.toHaveBeenCalled();
    retry.dispose();
  });

  it('uses the brief radio settling delay after going online and cancels retry when demand moves', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(async () => undefined);
    const retry = createConnectionRetry(connect, clock);
    retry.update(failure, true, false);
    retry.update(failure, true, true);
    expect(retry.getSnapshot().retryAt).toBe(Date.now() + 500);
    await vi.advanceTimersByTimeAsync(499);
    expect(connect).not.toHaveBeenCalled();
    retry.update(failure, false, true);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).not.toHaveBeenCalled();
    expect(retry.getSnapshot().attempt).toBe(0);
    retry.dispose();
  });
});
