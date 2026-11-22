// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type PropsWithChildren } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { useSessionCatalog } from '@/features/sessions/state/use-session-catalog';
import { createServerQueryClient } from '@/shared/server-data/query-client';
import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };

const client = { __opencode: { contract: 'v2', directory: '/repo' } };

describe('session catalog', () => {
  it('keeps the project list and the connection status map in separate Query entries', async () => {
    const clientCache = createServerQueryClient();
    onTestFinished(() => clientCache.clear());
    const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: clientCache }, children);
    const driver = renderHook(() => useSessionCatalog(identity, client as never), undefined, wrapper);
    await act(async () => {
      driver.result.current.setSessions([{ id: 's1', title: 'one', time: { created: 1, updated: 1 } } as never]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(driver.result.current.sessions).toHaveLength(1);
    expect(driver.result.current.sessionStatuses).toEqual({});
    expect(driver.result.current.sessionsRef.current).toEqual(driver.result.current.sessions);

    act(() => { driver.result.current.setSessionStatuses({ s1: { type: 'busy' } }); });
    expect(driver.result.current.sessions).toHaveLength(1);
    expect(driver.result.current.sessionStatuses).toEqual({ s1: { type: 'busy' } });
    driver.unmount();
  });
});
