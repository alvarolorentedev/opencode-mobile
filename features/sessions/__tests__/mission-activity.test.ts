import { expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';

it('checks approvals on other tabs with bounded reads and rejects work after backgrounding', async () => {
  const driver = hookRuntime();
  const requests = Array.from({ length: 3 }, () => deferred());
  const signals: AbortSignal[] = [];
  let emit!: (event: OpencodeEvent) => void;
  let health!: (healthy: boolean) => void;
  const list = vi.fn(() => requests[list.mock.calls.length - 1]?.promise ?? Promise.resolve({ permissions: [], questions: [] }));
  const { useMissionActivity } = await loadTs('features/sessions/state/use-mission-activity.ts', {
    react: driver.react,
    '@/shared/protocol/opencode/client': { buildClient: (_: object, _version: string, signal: AbortSignal) => { signals.push(signal); return {}; } },
    '@/shared/protocol/opencode/client/interactions': { listPendingInteractions: list },
    '@/shared/protocol/opencode/events': { getEventSessionStatus: () => undefined },
    '@/shared/protocol/opencode/server-data-events': { isServerConnectedEvent: () => false },
    '@/shared/protocol/services/session-service': { getV2SessionSummary: vi.fn(), listV2RunningSessionIds: vi.fn() },
  }, driver.globals);
  const catalog = {
    sessions: [{ id: 'one', directory: '/a' }], statuses: {}, refresh: vi.fn(),
  };
  const entry = { enabled: true, settings: {}, events: {
    observe: (observe: typeof emit) => { emit = observe; return () => undefined; },
    observeHealth: (observe: typeof health) => { health = observe; return () => undefined; },
    isHealthy: () => true,
  } };
  driver.mount(useMissionActivity, { entry, catalog, catalogCheckedAt: 1,
    client: { __opencode: { contract: 'v2' } }, connected: true, authorized: true, online: true, foreground: true, visible: false,
    knownDirectories: ['/a', '/b', '/c'], projects: [], reconnect: vi.fn(),
  });
  driver.fire(200);
  expect(list).toHaveBeenCalledTimes(2);
  expect(driver.countTimers(30_000)).toBe(0);
  requests[0].resolve({ permissions: [{ id: 'permission', sessionID: 'one' }], questions: [] });
  requests[1].resolve({ permissions: [], questions: [] });
  await driver.settle();
  expect(list).toHaveBeenCalledTimes(3);
  requests[2].resolve({ permissions: [], questions: [] });
  await driver.settle();
  expect(driver.value.approvals['/a'].permissions).toHaveLength(1);
  health(false);
  driver.flush();
  expect(driver.value.approvals).toEqual({});
  emit({ type: 'permission.replied', location: { directory: '/a' }, data: { sessionID: 'one', requestID: 'permission' } } as OpencodeEvent);
  driver.fire(200);
  expect(list).toHaveBeenCalledTimes(5);
  driver.update({ foreground: false });
  await driver.settle();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(driver.value.approvals).toEqual({});
  driver.update({ connected: false, connectionFailed: true, catalogCheckedAt: undefined });
  expect(driver.value.phase).toBe('offline');
  driver.unmount();
});
