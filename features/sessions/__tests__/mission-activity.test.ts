// @vitest-environment happy-dom

import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { useMissionActivity } from '@/features/sessions/state/use-mission-activity';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import { renderHook } from '../../../tests/helpers/render-hook';

const protocol = vi.hoisted(() => ({ buildClient: vi.fn(), listPendingInteractions: vi.fn() }));
vi.mock('@/shared/protocol/opencode/client', () => ({ buildClient: protocol.buildClient }));
vi.mock('@/shared/protocol/opencode/client/interactions', () => ({ listPendingInteractions: protocol.listPendingInteractions }));
vi.mock('@/shared/protocol/services/session-service', () => ({ getV2SessionSummary: vi.fn(), listV2RunningSessionIds: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('checks approvals on other tabs with bounded reads and rejects work after backgrounding', async () => {
  vi.useFakeTimers();
  const setTimer = vi.spyOn(globalThis, 'setTimeout');
  const requests = Array.from({ length: 3 }, () => Promise.withResolvers<unknown>());
  const signals: AbortSignal[] = [];
  let emit!: (event: OpencodeEvent) => void;
  let health!: (healthy: boolean) => void;
  const list = protocol.listPendingInteractions;
  list.mockReset().mockImplementation(() => requests[list.mock.calls.length - 1]?.promise ?? Promise.resolve({ permissions: [], questions: [] }));
  protocol.buildClient.mockImplementation((_: object, _version: string, signal: AbortSignal) => { signals.push(signal); return {}; });
  const catalog = {
    sessions: [{ id: 'one', directory: '/a' }], statuses: {}, refresh: vi.fn(),
  };
  const entry = { enabled: true, settings: {} };
  const events = {
    observe: (observe: typeof emit) => { emit = observe; return () => undefined; },
    observeHealth: (observe: typeof health) => { health = observe; return () => undefined; },
    isHealthy: () => true,
  };
  const input = { entry, events, catalog, catalogCheckedAt: 1,
    client: { __opencode: { contract: 'v2' } }, connected: true, authorized: true, online: true, foreground: true, visible: false,
    knownDirectories: ['/a', '/b', '/c'], projects: [], reconnect: vi.fn(),
  } as unknown as Parameters<typeof useMissionActivity>[0];
  const driver = renderHook(useMissionActivity, input);
  act(() => { vi.advanceTimersByTime(200); });
  expect(list).toHaveBeenCalledTimes(2);
  expect(setTimer.mock.calls.filter(([, interval]) => interval === 30_000).length).toBe(0);
  await act(async () => {
    requests[0].resolve({ permissions: [{ id: 'permission', sessionID: 'one' }], questions: [] });
    requests[1].resolve({ permissions: [], questions: [] });
  });
  expect(list).toHaveBeenCalledTimes(3);
  await act(async () => { requests[2].resolve({ permissions: [], questions: [] }); });
  expect(driver.result.current.approvals['/a'].permissions).toHaveLength(1);
  act(() => health(false));
  expect(driver.result.current.approvals).toEqual({});
  act(() => emit({ type: 'permission.replied', location: { directory: '/a' }, data: { sessionID: 'one', requestID: 'permission' } } as OpencodeEvent));
  act(() => { vi.advanceTimersByTime(200); });
  expect(list).toHaveBeenCalledTimes(5);
  driver.rerender({ ...input, foreground: false });
  await act(async () => {});
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(driver.result.current.approvals).toEqual({});
  driver.rerender({ ...input, foreground: false, connected: false, connectionFailed: true, catalogCheckedAt: undefined });
  expect(driver.result.current.phase).toBe('offline');
  driver.unmount();
});
