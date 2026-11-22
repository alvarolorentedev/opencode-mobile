import { dehydrate, hydrate, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { normalizeNetworkState, networkStatusKey } from '@/shared/network/network-status';
import {
  getRequestTimeout,
  isEventStreamUrl,
  shouldRetryRead,
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
} from '@/shared/protocol/opencode/client/request-policy';
import { hydrateTranscriptCache } from '@/features/chat/services/transcript-cache';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { projectQueryKey } from '@/shared/server-data/keys';
import { createServerQueryPersister, shouldPersistQuery } from '@/shared/server-data/persistence';
import { transcriptCacheKey } from '@/shared/storage/keys';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

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
    const values = new Map<string, string>([['settings', 'keep']]);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const persister = createServerQueryPersister(storage);
    const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const restored = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const record: SessionMessageRecord = {
      info: { id: 'm1', role: 'assistant', providerID: 'test', modelID: 'test', time: { created: 1, completed: 2 }, sessionID: 's' },
      parts: [{ id: 'p1', sessionID: 's', messageID: 'm1', type: 'text', text: 'hello' }],
    };
    const identity = { connectionId: 'machine', connectionScope: 'scope', authRevision: 1 };
    const client = { __opencode: { contract: 'v2' as const, directory: '/repo' } };
    const queryKey = (sessionId: string) => projectQueryKey(identity, client, 'transcript', sessionId);
    const put = (sessionId: string, updatedAt: number) => cache.setQueryData(queryKey(sessionId), {
      pages: [{ records: [{ ...record, info: { ...record.info, sessionID: sessionId } }], hasMore: true, nextBefore: 'old' }],
      pageParams: [null],
    }, { updatedAt });
    const now = Date.now();
    put('expired', now - 8 * 24 * 60 * 60_000);
    for (let index = 0; index < 64; index += 1) put(String(index), now - 100 + index);
    put('s', now);
    await persister.persistClient({ timestamp: now, buster: 'v1', clientState: dehydrate(cache, { shouldDehydrateQuery: shouldPersistQuery }) });
    const saved = await persister.restoreClient();
    expect(saved).toBeDefined();
    hydrate(restored, saved!.clientState);
    expect(restored.getQueryData(queryKey('s'))).toEqual({ pages: [{ records: [record], hasMore: false, restored: true }], pageParams: [null] });
    expect(restored.getQueryCache().getAll()).toHaveLength(64);
    expect(values.get('settings')).toBe('keep');
    expect(restored.getQueryData(queryKey('expired'))).toBeUndefined();
    expect(restored.getQueryData(queryKey('0'))).toBeUndefined();
    expect(restored.getQueryData(queryKey('1'))).toBeDefined();

    const key = transcriptCacheKey('scope', '/repo', 's');
    const apply = vi.fn();
    values.set(key, JSON.stringify({ cachedAt: now, records: [record] }));
    await hydrateTranscriptCache('scope', '/repo', 's', apply, () => true, storage);
    expect(apply).toHaveBeenCalledWith([record]);

    values.set(key, JSON.stringify({ cachedAt: now, records: [{ bad: true }] }));
    apply.mockClear();
    await hydrateTranscriptCache('scope', '/repo', 's', apply, () => true, storage);
    expect(apply).not.toHaveBeenCalled();
    expect(values.has(key)).toBe(false);
  });
});
