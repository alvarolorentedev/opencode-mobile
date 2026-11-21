import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadTs } from '../../../tests/helpers/runtime.mjs';

const SERVICE = 'features/sessions/services/mission-stats-cache.ts';
const ACTIVITY_KEY = 'opencode-mobile.mission-activity.';
const CONTRIBUTIONS_KEY = 'opencode-mobile.mission-contributions.';
const TTL_MS = 24 * 60 * 60 * 1000;

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

function days(count: number, start = new Date(2026, 9, 1)) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { date: key, steps: index };
  });
}

async function service() {
  return loadTs(SERVICE, { zod: { z } });
}

describe('Mission stats snapshot cache', () => {
  it('round-trips only the painted metrics and scopes entries by connection', async () => {
    const { hydrateMissionActivityCache, persistMissionActivityCache } = await service();
    const storage = memoryStorage();
    const snapshot = { total: { tokens: 120, cost: 0.5 }, buckets: [{ tokens: 60, cost: 0.25 }] };
    await persistMissionActivityCache('scope-a', snapshot, storage);
    const raw = storage.map.get(`${ACTIVITY_KEY}scope-a`)!;
    expect(JSON.parse(raw)).toMatchObject(snapshot);
    expect(raw).not.toContain('conversations');

    let applied: unknown;
    await hydrateMissionActivityCache('scope-a', (value: unknown) => { applied = value; }, () => true, storage);
    expect(applied).toEqual(snapshot);

    let otherScope = false;
    await hydrateMissionActivityCache('scope-b', () => { otherScope = true; }, () => true, storage);
    expect(otherScope).toBe(false);
  });

  it('drops malformed, expired, and future-dated snapshots', async () => {
    const { hydrateMissionActivityCache } = await service();
    const storage = memoryStorage();
    let applied = false;
    for (const raw of [
      '{not json',
      JSON.stringify({ cachedAt: Date.now() - TTL_MS - 1, total: { tokens: 1, cost: 0 }, buckets: [] }),
      JSON.stringify({ cachedAt: Date.now() + 60_000, total: { tokens: 1, cost: 0 }, buckets: [] }),
      JSON.stringify({ cachedAt: Date.now(), total: { tokens: -1, cost: 0 }, buckets: [] }),
    ]) {
      storage.map.set(`${ACTIVITY_KEY}scope`, raw);
      await hydrateMissionActivityCache('scope', () => { applied = true; }, () => true, storage);
      expect(applied).toBe(false);
      expect(storage.map.has(`${ACTIVITY_KEY}scope`)).toBe(false);
    }
  });

  it('keeps the contribution snapshot to the last 31 days', async () => {
    const { hydrateMissionContributionsCache, persistMissionContributionsCache } = await service();
    const storage = memoryStorage();
    await persistMissionContributionsCache('scope', days(40), storage);
    let applied: { steps: number }[] = [];
    await hydrateMissionContributionsCache('scope', (value: { steps: number }[]) => { applied = value; }, () => true, storage);
    expect(applied).toHaveLength(31);
    expect(applied[0].steps).toBe(9);
    expect(applied.at(-1)?.steps).toBe(39);
  });

  it('moves snapshots across a connection-scope renewal and clears removed connections', async () => {
    const { clearMissionStatsCaches, migrateMissionStatsCaches, persistMissionActivityCache, persistMissionContributionsCache } = await service();
    const storage = memoryStorage();
    await persistMissionActivityCache('old', { total: { tokens: 3, cost: 1 }, buckets: [{ tokens: 3, cost: 1 }] }, storage);
    await persistMissionContributionsCache('old', days(2), storage);

    await migrateMissionStatsCaches('old', 'new', storage);
    expect(storage.map.has(`${ACTIVITY_KEY}old`)).toBe(false);
    expect(storage.map.has(`${CONTRIBUTIONS_KEY}old`)).toBe(false);
    expect(storage.map.has(`${ACTIVITY_KEY}new`)).toBe(true);
    expect(storage.map.has(`${CONTRIBUTIONS_KEY}new`)).toBe(true);

    await clearMissionStatsCaches('new', storage);
    expect(storage.map.has(`${ACTIVITY_KEY}new`)).toBe(false);
    expect(storage.map.has(`${CONTRIBUTIONS_KEY}new`)).toBe(false);
  });
});
