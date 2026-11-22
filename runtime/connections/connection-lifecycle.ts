import { connectionTransition } from '@/features/connections/runtime';
import type { ConnectionLifecycle } from '@/features/connections/index';
import { idleConnection } from './idle-connection';

type Transition = Parameters<typeof connectionTransition>[1];

// The connection state machine is plain state plus listeners, so it can be
// driven without React and reused by a future non-React manager.
export function createConnectionLifecycle(initial: ConnectionLifecycle = idleConnection) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispatch(event: Transition) {
      const next = connectionTransition(state, event);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}
