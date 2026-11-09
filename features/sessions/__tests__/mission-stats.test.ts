import { describe, expect, it, vi } from 'vitest';
import { MISSION_STATS_RANGES, missionStatsBuckets, sumMissionActivity, sumMissionStats } from '@/features/sessions/model/mission-stats';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { readSessionStats } from '@/shared/protocol/services/session-stats';
import { sessionStatsOptions } from '@/shared/server-data/session-stats';
import { QueryClient } from '@tanstack/react-query';

describe('Mission activity statistics', () => {
  it.each(MISSION_STATS_RANGES)('covers $hours hours with adjacent, equal buckets', ({ hours, buckets }) => {
    const to = 1_800_000_000_000;
    const series = missionStatsBuckets(hours, to);
    expect(series).toHaveLength(buckets);
    expect(series[0].from).toBe(to - hours * 3_600_000);
    expect(series.at(-1)?.to).toBe(to);
    series.forEach((bucket, index) => {
      expect(bucket.to - bucket.from).toBe(hours * 3_600_000 / buckets);
      if (index) expect(bucket.from).toBe(series[index - 1].to);
    });
  });

  it('keeps distinct conversation totals separate from bucket counts', () => {
    const row = { total: { conversations: 1, tokens: 5, cost: 0.5 },
      buckets: [{ conversations: 1, tokens: 2, cost: 0.25 }, { conversations: 1, tokens: 3, cost: 0.25 }] };
    expect(sumMissionStats([row, row], 2)).toEqual({ total: { conversations: 2, tokens: 10, cost: 1 },
      buckets: [{ conversations: 2, tokens: 4, cost: 0.5 }, { conversations: 2, tokens: 6, cost: 0.5 }] });
  });

  it('merges daily activity across servers', () => {
    expect(sumMissionActivity([
      { activity: [{ date: '2026-11-08', steps: 2 }, { date: '2026-11-09', steps: 1 }] },
      { activity: [{ date: '2026-11-08', steps: 3 }] },
    ])).toEqual([{ date: '2026-11-08', steps: 5 }, { date: '2026-11-09', steps: 1 }]);
  });

  it('reads project-scoped usage and daily activity with a cancelable signal and validates numbers', async () => {
    const range = { from: 10, to: 20 };
    const signal = new AbortController().signal;
    const result = { range, sessions: 3, cost: 0.01, tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      activity: [{ date: '2026-11-09', steps: 7 }] };
    const stats = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, cost: -1 });
    const client = { api: { experimental: { session: { stats } } } } as unknown as ScopedOpencodeClient;
    await expect(readSessionStats(client, range, 'project', signal, 'Europe/Madrid')).resolves.toEqual({
      conversations: 3, cost: 0.01, tokens: 15, activity: [{ date: '2026-11-09', steps: 7 }],
    });
    expect(stats).toHaveBeenCalledWith({ ...range, project: 'project', tools: 'none', timezone: 'Europe/Madrid' }, { signal });
    await expect(readSessionStats(client, range, 'project', signal)).rejects.toThrow('unavailable');
  });

  it('cancels remaining buckets when the query is canceled', async () => {
    const cache = new QueryClient();
    let finish!: () => void;
    const read = vi.fn(() => new Promise<{ conversations: number; tokens: number; cost: number }>((resolve) => {
      finish = () => resolve({ conversations: 0, tokens: 0, cost: 0 });
    }));
    const options = sessionStatsOptions({ identity: { connectionId: 'a', connectionScope: 'server', authRevision: 0 }, read },
      undefined, missionStatsBuckets(1, 1_800_000_000_000));
    const pending = cache.fetchQuery(options).catch(() => undefined);
    await cache.cancelQueries({ queryKey: options.queryKey });
    finish();
    await pending;
    expect(read).toHaveBeenCalledTimes(1);
    expect(cache.getQueryData(options.queryKey)).toBeUndefined();
    cache.clear();
  });
});
