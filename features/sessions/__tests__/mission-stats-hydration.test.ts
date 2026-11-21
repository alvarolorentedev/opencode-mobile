import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { deferred, hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

const SERVICE = 'features/sessions/services/mission-stats-cache.ts';
const HOOK = 'features/sessions/state/use-mission-stats.ts';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    async getItem(key: string) { return map.get(key) ?? null; },
    async setItem(key: string, value: string) { map.set(key, value); },
    async removeItem(key: string) { map.delete(key); },
    async multiRemove(keys: string[]) { keys.forEach((key) => map.delete(key)); },
  };
}

describe('Mission activity snapshot hydration', () => {
  it('paints the stored snapshot before the server answers and persists only the confirmed read', async () => {
    const storage = memoryStorage();
    const snapshots: { total: { tokens: number } }[] = [];
    const service = await loadTs(SERVICE, { zod: { z } });
    await service.persistMissionActivityCache('scope-a', {
      total: { tokens: 42, cost: 1 },
      buckets: [{ tokens: 42, cost: 1 }],
    }, storage);

    const pending = deferred();
    const read = vi.fn(() => pending.promise);
    const driver = hookRuntime();
    const { useMissionStats } = await loadTs(HOOK, {
      react: driver.react,
      'expo-router': { useFocusEffect: () => undefined },
      '@/features/sessions/services/mission-stats-cache': {
        hydrateMissionActivityCache: (scope: string, apply: unknown, isCurrent: unknown) =>
          service.hydrateMissionActivityCache(scope, apply, isCurrent, storage),
        persistMissionActivityCache: (scope: string, snapshot: { total: { tokens: number } }) => {
          snapshots.push(snapshot);
          return service.persistMissionActivityCache(scope, snapshot, storage);
        },
      },
    }, driver.globals);

    // The hook takes positional screen arguments; adapt them to the driver's
    // object prop shape.
    driver.mount((props: { servers: unknown[] }) => useMissionStats(props.servers as never, undefined, 24, true, 0), {
      servers: [{
        id: 'a', name: 'A', phase: 'ready', authorized: true, requests: 0,
        stats: { identity: { connectionId: 'a', connectionScope: 'scope-a', authRevision: 0 }, read },
      }],
    });
    await driver.settle();
    expect(driver.value.series?.total.tokens).toBe(42);
    expect(snapshots).toHaveLength(0);

    pending.resolve({ conversations: 0, tokens: 999, cost: 2 });
    await driver.settle();
    expect(driver.value.series?.total.tokens).toBe(999);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].total.tokens).toBe(999);
    driver.unmount();
  });
});
