import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

async function mountHook(initial: { status: string; kind?: string; online?: boolean; active?: boolean; paused?: boolean }) {
  const runtime = hookRuntime();
  const { useConnectionRetry } = await loadTs('providers/use-connection-retry.ts', {
    react: runtime.react,
    '@/lib/opencode/client/errors': {
      isRetryableConnectionFailure: (kind: string) => kind !== 'auth' && kind !== 'entitlement' && kind !== 'server-incompatible',
    },
  }, runtime.globals);
  const connect = vi.fn(async () => undefined);
  runtime.mount(useConnectionRetry, {
    active: initial.active ?? true,
    paused: initial.paused ?? false,
    status: initial.status,
    kind: initial.kind,
    online: initial.online ?? true,
    connect,
  });
  return { runtime, connect };
}

describe('connect retry policy', () => {
  it('retries a retryable foreground failure with a bounded budget', async () => {
    const { runtime, connect } = await mountHook({ status: 'error', kind: 'unknown' });
    await runtime.settle();
    expect(connect).not.toHaveBeenCalled();
    runtime.fire(1000);
    await runtime.settle();
    expect(connect).toHaveBeenCalledTimes(1);
    runtime.unmount();
  });

  it('does not auto-retry auth failures or spend attempts while offline', async () => {
    const auth = await mountHook({ status: 'error', kind: 'auth' });
    await auth.runtime.settle();
    auth.runtime.fire(30_000);
    await auth.runtime.settle();
    expect(auth.connect).not.toHaveBeenCalled();
    auth.runtime.unmount();

    const offline = await mountHook({ status: 'error', kind: 'unknown', online: false });
    await offline.runtime.settle();
    offline.runtime.fire(30_000);
    await offline.runtime.settle();
    expect(offline.connect).not.toHaveBeenCalled();
    offline.runtime.unmount();

    const activation = await mountHook({ status: 'error', kind: 'unknown', paused: true });
    await activation.runtime.settle();
    activation.runtime.fire(30_000);
    await activation.runtime.settle();
    expect(activation.connect).not.toHaveBeenCalled();
    activation.runtime.unmount();
  });
});
