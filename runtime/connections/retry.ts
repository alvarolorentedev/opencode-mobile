import type { ConnectionState } from '@/features/connections/index';
import { isRetryableConnectionFailure } from '@/shared/protocol/opencode/client/errors';

const DELAYS_MS = [1000, 2000, 5000, 10_000, 20_000] as const;
type Timer = ReturnType<typeof setTimeout>;
type Retry = { retryAt?: number; attempt: number; maxAttempts: number };

const NO_RETRY: Retry = { attempt: 0, maxAttempts: DELAYS_MS.length };

export function createConnectionRetry(connect: () => Promise<unknown>, clock: {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => Timer;
  clearTimeout: (timer?: Timer) => void;
}) {
  let online = true;
  let status: ConnectionState['status'] | undefined;
  let kind: ConnectionState['kind'];
  let active = false;
  let attempts = 0;
  let timer: Timer | undefined;
  let snapshot = NO_RETRY;
  const listeners = new Set<() => void>();

  function publish(next: Retry) {
    if (snapshot.retryAt === next.retryAt && snapshot.attempt === next.attempt) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update(state: ConnectionState, nextActive: boolean, nextOnline: boolean) {
      if (status === state.status && kind === state.kind && active === nextActive && online === nextOnline) return;
      const restored = !online && nextOnline;
      ({ status, kind } = state);
      active = nextActive;
      online = nextOnline;
      clock.clearTimeout(timer);
      timer = undefined;
      if (status === 'connected' || status === 'idle') attempts = 0;
      if (status !== 'error' || !active || !online || (kind && !isRetryableConnectionFailure(kind)) || attempts >= DELAYS_MS.length) {
        publish({ ...NO_RETRY, attempt: status === 'error' ? attempts : 0 });
        return;
      }

      // A connecting phase keeps the budget. A restored radio gets a short
      // settling period before trying the existing connection again.
      const delay = restored ? 500 : DELAYS_MS[attempts];
      timer = clock.setTimeout(() => {
        timer = undefined;
        attempts += 1;
        publish({ ...NO_RETRY, attempt: attempts });
        void connect().catch(() => undefined);
      }, delay);
      publish({ ...NO_RETRY, attempt: attempts + 1, retryAt: clock.now() + delay });
    },
    dispose() { clock.clearTimeout(timer); listeners.clear(); },
  };
}
