import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

export type SessionStatsRange = { from: number; to: number };
export type SessionStats = { conversations: number; tokens: number; cost: number };

export async function readSessionStats(client: ScopedOpencodeClient, range: SessionStatsRange, project: string | undefined, signal: AbortSignal): Promise<SessionStats> {
  const stats = await client.api?.experimental.session.stats({ ...range, project, tools: 'none' }, { signal });
  const tokens = [stats?.tokens?.input, stats?.tokens?.output, stats?.tokens?.reasoning, stats?.tokens?.cache?.read, stats?.tokens?.cache?.write];
  const isCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (!stats || stats.range?.from !== range.from || stats.range?.to !== range.to || !isCount(stats.sessions)
      || !tokens.every(isCount) || !Number.isFinite(stats.cost) || stats.cost < 0) {
    throw new Error('OpenCode session statistics are unavailable.');
  }
  return { conversations: stats.sessions, tokens: tokens.reduce<number>((total, value) => total + (value ?? 0), 0), cost: stats.cost };
}
