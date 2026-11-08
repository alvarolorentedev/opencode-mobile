import { expect, it } from 'vitest';
import { parseMissionWidgetSnapshot } from '@/features/widgets/model/mission-widget-snapshot';

it('validates and redacts Mission Control snapshots before rendering them headlessly', () => {
  const snapshot = { checkedAt: 10, checkedServers: 1, totalServers: 2, stale: true, language: 'en',
    counts: { attention: 2, running: 0, failed: 1, completed: 3 } };
  expect(parseMissionWidgetSnapshot({ ...snapshot, title: 'private chat', counts: { ...snapshot.counts, link: 'untrusted' } })).toEqual(snapshot);
  expect(parseMissionWidgetSnapshot({ ...snapshot, checkedServers: 3 })).toBeUndefined();
  expect(parseMissionWidgetSnapshot({ ...snapshot, counts: { ...snapshot.counts, attention: -1 } })).toBeUndefined();
});
