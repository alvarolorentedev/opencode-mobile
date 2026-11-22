import { setImmediate } from 'node:timers';
import { act } from 'react';
import { onTestFinished, vi } from 'vitest';

// Timer diagnostics also distinguish two simultaneously armed deadlines.
export function controlledClock(now?: number) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  if (now !== undefined) vi.setSystemTime(now);
  const deadlines = new Map<ReturnType<typeof setTimeout>, number>();
  const schedule = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  const scheduleSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay = 0, ...args) => {
    const id = schedule(() => {
      deadlines.delete(id);
      callback(...args);
    }, delay);
    deadlines.set(id, delay);
    return id;
  });
  const cancelSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation((id) => {
    if (id != null) deadlines.delete(id as ReturnType<typeof setTimeout>);
    cancel(id);
  });
  let restored = false;
  function restore() {
    if (restored) return;
    restored = true;
    scheduleSpy.mockRestore();
    cancelSpy.mockRestore();
    vi.useRealTimers();
  }
  onTestFinished(restore);
  return {
    restore,
    countTimers: (delay: number) => [...deadlines.values()].filter((value) => value === delay).length,
    advance: (delay: number) => act(async () => { await vi.advanceTimersByTimeAsync(delay); }),
  };
}

// Keep long-lived promises pending across commits while processing callbacks
// that have already entered the microtask queue.
export async function settleReact() {
  await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
