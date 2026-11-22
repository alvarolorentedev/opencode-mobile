// @vitest-environment happy-dom

import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { persistMissionActivityCache, type MissionActivitySnapshot } from '@/features/sessions/services/mission-stats-cache';
import { useMissionStats } from '@/features/sessions/state/use-mission-stats';
import type { SessionStats } from '@/shared/protocol/services/session-stats';
import { createServerQueryClient } from '@/shared/server-data/query-client';
import { renderHook } from '../../../tests/helpers/render-hook';

const native = vi.hoisted(() => ({ values: new Map<string, string>(), write: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => native.values.get(key) ?? null,
    setItem: async (key: string, value: string) => { native.values.set(key, value); native.write(key, value); },
    removeItem: async (key: string) => { native.values.delete(key); },
  },
}));
vi.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, AppState: { currentState: 'active' } }));

afterEach(() => vi.useRealTimers());

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe('Mission activity snapshot hydration', () => {
  it('paints the stored snapshot before the server answers and persists only the confirmed read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    focusManager.setFocused(true);
    onTestFinished(() => focusManager.setFocused(undefined));
    const now = Date.now();
    await persistMissionActivityCache('scope-a', {
      total: { tokens: 42, cost: 1 },
      buckets: [{ tokens: 42, cost: 1 }],
    });
    native.write.mockClear();

    const pending = Promise.withResolvers<SessionStats>();
    const read = vi.fn(() => pending.promise);
    const cache = createServerQueryClient();
    onTestFinished(() => cache.clear());
    const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: cache }, children);
    const servers = [{
      id: 'a', name: 'A', phase: 'ready', authorized: true, requests: 0,
      stats: { identity: { connectionId: 'a', connectionScope: 'scope-a', authRevision: 0 }, read },
    }] as unknown as Parameters<typeof useMissionStats>[0];
    const driver = renderHook(() => useMissionStats(servers, undefined, 24, true, 0), undefined, wrapper);
    await settle();
    await settle();
    expect(driver.result.current.series?.total.tokens).toBe(42);
    expect(native.write).not.toHaveBeenCalled();

    vi.setSystemTime(now + 1);
    await act(async () => { pending.resolve({ conversations: 0, tokens: 999, cost: 2 }); });
    await settle();
    expect(driver.result.current.series?.total.tokens).toBe(999);
    expect(native.write).toHaveBeenCalledOnce();
    const snapshot = JSON.parse(native.write.mock.calls[0][1]) as MissionActivitySnapshot;
    expect(snapshot.total.tokens).toBe(999);
    driver.unmount();
  });
});
