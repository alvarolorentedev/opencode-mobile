import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

export type SessionStatsRange = { from: number; to: number };
export type SessionStatsActivityDay = { date: string; steps: number };
export type SessionStats = { conversations: number; tokens: number; cost: number; activity?: SessionStatsActivityDay[] };

export async function readSessionStats(client: ScopedOpencodeClient, range: SessionStatsRange, project: string | undefined, signal: AbortSignal, timezone?: string): Promise<SessionStats> {
  const stats = await client.api?.experimental.session.stats({ ...range, project, tools: 'none', ...(timezone ? { timezone } : {}) }, { signal });
  const tokens = [stats?.tokens?.input, stats?.tokens?.output, stats?.tokens?.reasoning, stats?.tokens?.cache?.read, stats?.tokens?.cache?.write];
  const isCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const activityValid = stats?.activity === undefined
    || (Array.isArray(stats.activity) && stats.activity.every((day) => typeof day?.date === 'string' && isCount(day.steps)));
  if (!stats || stats.range?.from !== range.from || stats.range?.to !== range.to || !isCount(stats.sessions)
      || !tokens.every(isCount) || !Number.isFinite(stats.cost) || stats.cost < 0 || !activityValid) {
    throw new Error('OpenCode session statistics are unavailable.');
  }
  const activity = (stats.activity ?? []).map(({ date, steps }) => ({ date, steps }));
  return {
    conversations: stats.sessions,
    tokens: tokens.reduce<number>((total, value) => total + (value ?? 0), 0),
    cost: stats.cost,
    ...(activity.length ? { activity } : {}),
  };
}
