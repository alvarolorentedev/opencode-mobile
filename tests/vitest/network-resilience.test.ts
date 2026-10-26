import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { normalizeNetworkState, networkStatusKey } from '@/lib/network-status';
import {
  getRequestTimeout,
  isEventStreamUrl,
  shouldRetryRead,
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
} from '@/lib/opencode/client/request-policy';
import { loadTs } from '../helpers/runtime.mjs';
import { loadPersistedValue } from '@/providers/persistence-hydration';

describe('network status normalization', () => {
  it('treats unknown reachability as online and keeps cellular metered', () => {
    expect(normalizeNetworkState({ type: 'cellular', isConnected: true, isInternetReachable: null, details: { cellularGeneration: '4g' } }))
      .toEqual({ online: true, type: 'cellular', expensive: true, constrained: false, generation: '4g' });
  });

  it('marks 2G/3G as constrained while preserving usability', () => {
    const status = normalizeNetworkState({ type: 'cellular', isConnected: true, isInternetReachable: true, details: { cellularGeneration: '3g' } });
    expect(status.online).toBe(true);
    expect(status.constrained).toBe(true);
    expect(networkStatusKey(status)).toBe('online:cellular:constrained');
  });

  it('treats a disconnected radio or none type as offline', () => {
    expect(normalizeNetworkState({ type: 'wifi', isConnected: false }).online).toBe(false);
    expect(normalizeNetworkState({ type: 'none', isConnected: true }).online).toBe(false);
    // A failed external reachability probe or a captive portal must not make a
    // connected radio look offline; the next server request is authoritative.
    expect(normalizeNetworkState({ type: 'wifi', isConnected: true, isInternetReachable: false }).online).toBe(true);
  });
});

describe('request policy', () => {
  it('keeps reads and writes finite while leaving SSE unbounded', () => {
    expect(isEventStreamUrl('http://server/api/event')).toBe(true);
    expect(isEventStreamUrl('http://server/api/event?directory=x')).toBe(true);
    expect(getRequestTimeout('http://server/api/event', 'GET')).toBeUndefined();
    expect(getRequestTimeout('http://server/api/session', 'GET')).toBe(READ_TIMEOUT_MS);
    expect(getRequestTimeout('http://server/api/session/s/message', 'POST')).toBe(WRITE_TIMEOUT_MS);
  });

  it('retries a fast idempotent transport failure once but never a mutation or a late failure', () => {
    expect(shouldRetryRead({ method: 'GET', url: 'http://server/api/session', attempt: 0, elapsedMs: 300, error: new Error('Failed to fetch') })).toBe(true);
    expect(shouldRetryRead({ method: 'POST', url: 'http://server/api/session', attempt: 0, elapsedMs: 300, error: new Error('Failed to fetch') })).toBe(false);
    expect(shouldRetryRead({ method: 'GET', url: 'http://server/api/session', attempt: 1, elapsedMs: 300, error: new Error('Failed to fetch') })).toBe(false);
    expect(shouldRetryRead({ method: 'GET', url: 'http://server/api/session', attempt: 0, elapsedMs: 20_000, error: new Error('Failed to fetch') })).toBe(false);
    expect(shouldRetryRead({ method: 'GET', url: 'http://server/api/session', attempt: 0, elapsedMs: 300, status: 503 })).toBe(true);
    expect(shouldRetryRead({ method: 'GET', url: 'http://server/api/session', attempt: 0, elapsedMs: 300, status: 404 })).toBe(false);
    expect(shouldRetryRead({ method: 'GET', url: 'http://server/api/session', attempt: 0, elapsedMs: 300, error: new Error('OpenCode read canceled.') })).toBe(false);
  });
});

describe('transcript cache', () => {
  it('round-trips a bounded tail and rejects malformed entries', async () => {
    const values = new Map();
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const cache = await loadTs('providers/transcript-cache.ts', {
      '@/lib/storage-keys': { transcriptCacheKey: (scope: string, project: string, session: string) => `${scope}:${project}:${session}` },
      '@/providers/persistence-hydration': { loadPersistedValue },
      '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
      zod: { z },
    });
    const record = {
      info: { id: 'm1', role: 'assistant', time: { created: 1, completed: 2 }, sessionID: 's' },
      parts: [{ id: 'p1', sessionID: 's', messageID: 'm1', type: 'text', text: 'hello' }],
    };
    await cache.persistTranscriptCache('scope', '/repo', 's', [record], storage);
    let loaded;
    await cache.hydrateTranscriptCache('scope', '/repo', 's', (records: unknown[]) => { loaded = records; }, () => true, storage);
    expect(loaded).toEqual([record]);

    const key = [...values.keys()][0];
    values.set(key, JSON.stringify({ cachedAt: Date.now(), records: [{ bad: true }] }));
    let rejected = false;
    await cache.hydrateTranscriptCache('scope', '/repo', 's', () => { rejected = true; }, () => true, storage);
    expect(rejected).toBe(false);
    expect(values.has(key)).toBe(false);
  });
});
