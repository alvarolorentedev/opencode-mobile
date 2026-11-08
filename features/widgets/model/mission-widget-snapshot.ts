import { MISSION_FILTERS, type MissionCounts, type MissionWidgetSnapshot } from '@/shared/contracts/mission-control';

const natural = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseMissionWidgetSnapshot(value: unknown): MissionWidgetSnapshot | undefined {
  if (!value || typeof value !== 'object') return;
  const { checkedAt, checkedServers, totalServers, counts, stale, language } = value as Record<string, unknown>;
  if (!natural(checkedAt) || !natural(checkedServers) || !natural(totalServers) || checkedServers > totalServers || typeof stale !== 'boolean') return;
  if (!counts || typeof counts !== 'object') return;
  const fields = counts as Record<string, unknown>;
  if (!MISSION_FILTERS.every((key) => natural(fields[key]))) return;
  return { checkedAt, checkedServers, totalServers, stale, counts: Object.fromEntries(MISSION_FILTERS.map((key) => [key, fields[key]])) as MissionCounts,
    language: typeof language === 'string' ? language.slice(0, 32) : undefined };
}
