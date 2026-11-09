import type { SessionStats, SessionStatsActivityDay } from '@/shared/protocol/services/session-stats';
import type { SessionStatsSeries } from '@/shared/server-data/session-stats';

export const MISSION_STATS_RANGES = [
  { hours: 1, buckets: 6 }, { hours: 12, buckets: 6 }, { hours: 24, buckets: 6 },
  { hours: 120, buckets: 5 }, { hours: 168, buckets: 7 }, { hours: 360, buckets: 5 }, { hours: 720, buckets: 6 },
] as const;
export type MissionStatsHours = typeof MISSION_STATS_RANGES[number]['hours'];

export function missionStatsBuckets(hours: MissionStatsHours, to: number) {
  const count = MISSION_STATS_RANGES.find((range) => range.hours === hours)!.buckets;
  const interval = hours * 3_600_000 / count;
  const from = to - interval * count;
  return Array.from({ length: count }, (_, index) => ({ from: from + index * interval, to: from + (index + 1) * interval }));
}

export function sumMissionStats(rows: SessionStatsSeries[], bucketCount: number): SessionStatsSeries {
  const empty = (): SessionStats => ({ conversations: 0, tokens: 0, cost: 0 });
  const add = (target: SessionStats, value: SessionStats) => {
    target.conversations += value.conversations;
    target.tokens += value.tokens;
    target.cost += value.cost;
  };
  const total = empty();
  const buckets = Array.from({ length: bucketCount }, empty);
  for (const row of rows) {
    add(total, row.total);
    row.buckets.forEach((value, index) => add(buckets[index], value));
  }
  return { total, buckets };
}

export function sumMissionActivity(rows: Pick<SessionStats, 'activity'>[]): SessionStatsActivityDay[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const day of row.activity ?? []) totals.set(day.date, (totals.get(day.date) ?? 0) + day.steps);
  }
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, steps]) => ({ date, steps }));
}
