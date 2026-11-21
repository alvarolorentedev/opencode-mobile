import { describe, expect, it, vi } from 'vitest';

import { loadTs } from '../../tests/helpers/runtime.mjs';

describe('connection lifecycle manager', () => {
  it('applies transitions and notifies subscribers without React', async () => {
    const { createConnectionLifecycle } = await loadTs('runtime/connections/connection-lifecycle.ts', {
      '@/features/connections/runtime': await loadTs('features/connections/model/connection-lifecycle.ts'),
    });
    const manager = createConnectionLifecycle();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    manager.dispatch({ type: 'start', operation: 1, message: 'Connecting' });
    expect(manager.getState().connection).toEqual({ status: 'connecting', message: 'Connecting' });
    manager.dispatch({ type: 'settle', operation: 1, contract: 'v2', connection: { status: 'connected', message: 'Connected', checkedAt: 1 } });
    expect(manager.getState().connection.status).toBe('connected');
    expect(listener).toHaveBeenCalledTimes(2);

    manager.dispatch({ type: 'settle', operation: 0, connection: { status: 'error', message: 'stale' } });
    expect(manager.getState().connection.status).toBe('connected');
    unsubscribe();
  });
});
