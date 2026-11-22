import { describe, expect, it, vi } from 'vitest';

import { loadTs } from '../../../tests/helpers/runtime.mjs';

async function loadRelayModel() {
  return loadTs('features/connections/model/relay.ts');
}

describe('relay discovery contracts', () => {
  it('requires HTTPS except for explicit loopback development hosts', async () => {
    const model = await loadRelayModel();
    expect(model.normalizeRelayUrl('https://relay.example.com/')).toBe('https://relay.example.com');
    expect(model.normalizeRelayUrl('http://localhost:9000')).toBe('http://localhost:9000');
    expect(model.normalizeRelayUrl('http://127.0.0.1:9000')).toBe('http://127.0.0.1:9000');
    expect(model.normalizeRelayUrl('http://[::1]:9000')).toBe('http://[::1]:9000');
    expect(model.normalizeRelayUrl('http://relay.example.com')).toBeUndefined();
    expect(model.normalizeRelayUrl('https://user:secret@relay.example.com')).toBeUndefined();
    expect(model.normalizeRelayUrl('https://relay.example.com/path/../elsewhere')).toBeUndefined();
    expect(model.normalizeRelayUrl('ftp://relay.example.com')).toBeUndefined();
  });

  it('rejects malformed tokens and environment lists instead of casting payloads', async () => {
    const model = await loadRelayModel();
    expect(model.parseRelayToken({ token: 'bearer-value' })).toBe('bearer-value');
    expect(model.parseRelayToken({ token: '' })).toBeUndefined();
    expect(model.parseRelayToken({ token: 'bad\nvalue' })).toBeUndefined();
    expect(model.parseRelayEnvironments({ environments: [] })).toEqual([]);
    expect(model.parseRelayEnvironments({ environments: [{ id: 'env', name: 'Desktop', status: 'online' }] })).toEqual([
      { id: 'env', name: 'Desktop', status: 'online' },
    ]);
    expect(model.parseRelayEnvironments({ environments: [{ id: '', name: 'Desktop', status: 'online' }] })).toBeUndefined();
    expect(model.parseRelayEnvironments({ environments: [{ id: 'env', name: 'Desktop' }] })).toBeUndefined();
    expect(model.parseRelayEnvironments({ environments: 'not-an-array' })).toBeUndefined();
  });
});

describe('relay discovery transport', () => {
  it('rejects redirects and validates the login response shape', async () => {
    const calls: unknown[][] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return { ok: true, json: async () => ({ token: 'relay-token' }) };
    });
    const model = await loadRelayModel();
    const service = await loadTs('features/connections/services/relay-discovery.ts', {
      'expo/fetch': { fetch: fetchMock },
      '@/features/connections/model/relay': model,
      '@/shared/storage/relay-session': {},
    });

    await expect(service.loginToRelay('https://relay.example.com', 'alice', 'secret')).resolves.toEqual({
      relayUrl: 'https://relay.example.com', username: 'alice', token: 'relay-token',
    });
    expect(calls[0][0]).toBe('https://relay.example.com/api/auth/login');
    expect(calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST', signal: expect.any(AbortSignal) });

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 5 }) } as never);
    await expect(service.loginToRelay('https://relay.example.com', 'alice', 'secret')).rejects.toMatchObject({ kind: 'response' });
  });

  it('maps authentication failures to a typed error without exposing response text', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'password echoed by server' }));
    const model = await loadRelayModel();
    const service = await loadTs('features/connections/services/relay-discovery.ts', {
      'expo/fetch': { fetch: fetchMock },
      '@/features/connections/model/relay': model,
      '@/shared/storage/relay-session': {},
    });
    await expect(service.loginToRelay('https://relay.example.com', 'alice', 'secret')).rejects.toMatchObject({ kind: 'authentication' });
    await expect(service.listRelayEnvironments({ relayUrl: 'https://relay.example.com', username: 'alice', token: 'safe-token' })).rejects.toThrow('authentication');
  });

  it('validates empty and populated environment responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ environments: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ environments: [{ id: 'env', name: 'Desktop', status: 'online' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ environments: [{ id: 'env' }] }) });
    const model = await loadRelayModel();
    const service = await loadTs('features/connections/services/relay-discovery.ts', {
      'expo/fetch': { fetch: fetchMock },
      '@/features/connections/model/relay': model,
      '@/shared/storage/relay-session': {},
    });
    const session = { relayUrl: 'https://relay.example.com', username: 'alice', token: 'safe-token' };
    await expect(service.listRelayEnvironments(session)).resolves.toEqual([]);
    await expect(service.listRelayEnvironments(session)).resolves.toMatchObject([{ id: 'env', name: 'Desktop' }]);
    await expect(service.listRelayEnvironments(session)).rejects.toMatchObject({ kind: 'response' });
  });

  it('cancels in-flight requests and aborts timed-out requests', async () => {
    const model = await loadRelayModel();
    const session = { relayUrl: 'https://relay.example.com', username: 'alice', token: 'safe-token' };
    const controller = new AbortController();
    const cancelFetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const cancelService = await loadTs('features/connections/services/relay-discovery.ts', {
      'expo/fetch': { fetch: cancelFetch },
      '@/features/connections/model/relay': model,
      '@/shared/storage/relay-session': {},
    });
    const cancelled = cancelService.listRelayEnvironments(session, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: 'cancelled' });

    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      const timeoutFetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        requestSignal = init.signal ?? undefined;
        requestSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
      const timeoutService = await loadTs('features/connections/services/relay-discovery.ts', {
        'expo/fetch': { fetch: timeoutFetch },
        '@/features/connections/model/relay': model,
        '@/shared/storage/relay-session': {},
      });
      const timedOut = timeoutService.listRelayEnvironments(session);
      const timeoutAssertion = expect(timedOut).rejects.toMatchObject({ kind: 'request' });
      await vi.advanceTimersByTimeAsync(15_000);
      await timeoutAssertion;
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
