import { describe, expect, it } from 'vitest';
import { missionBadge, RECENT_COMPLETION_MS, selectMission } from '@/features/sessions/model/mission-control';
import type { MissionConnectionActivity } from '@/shared/contracts/mission-control';
import type { WorkspaceCatalog } from '@/shared/contracts/workspace';
import type { Session } from '@/shared/protocol/opencode/types';

const now = 2 * RECENT_COMPLETION_MS;
const server = (id: string) => ({ id, name: id, revision: 1, enabled: true });
const chat = (id: string, options: Partial<Session> = {}): Session => ({ id, title: id, directory: '/repo', time: { created: 1, updated: now }, ...options });
const catalog = (sessions: Session[], mission: Partial<MissionConnectionActivity> = {}, statuses: WorkspaceCatalog['statuses'] = {}): WorkspaceCatalog => ({
  sessions, statuses, refresh: async () => undefined, removeSession: () => undefined,
  mission: { phase: 'ready', revision: 1, authorized: true, projects: [], approvals: {}, execution: {}, supplemental: [], removed: new Set(),
    catalogAt: now, refresh: () => undefined, ...mission },
});

describe('Mission Control', () => {
  it('counts distinct blocked conversations across servers and ignores duplicated and sessionless requests', () => {
    const approval = { id: 'request', sessionID: 'same' };
    const a = catalog([chat('same')], { approvals: { '/repo': { permissions: [approval, approval], questions: [approval, { id: 'global', sessionID: 'global' }] },
      '/other': { questions: [{ id: 'global', sessionID: 'global' }] } } }, { same: { type: 'busy' } });
    const b = catalog([chat('same')], { approvals: { '/repo': { questions: [approval] } } });
    const overview = selectMission([server('a'), server('b')], { a, b }, now);
    expect(overview.counts).toEqual({ attention: 2, running: 0, failed: 0, completed: 0 });
    expect(overview.rows.map(({ target }) => target)).toEqual([
      { connectionId: 'a', projectPath: '/repo', sessionId: 'same' }, { connectionId: 'b', projectPath: '/repo', sessionId: 'same' },
    ]);
    expect(overview.rows[0]).toMatchObject({ permission: true, question: true });
    expect(overview.servers[0].requests).toBe(1);
    expect([missionBadge(0), missionBadge(2), missionBadge(100)]).toEqual([undefined, 2, '99+']);
  });

  it('uses execution evidence, preserves retries and expires confirmed completions', () => {
    const completed = chat('completed', { outcome: 'succeeded', time: { created: 1, updated: now, idle: now - 100 } });
    const a = catalog([completed, chat('failed', { outcome: 'failed' }), chat('old', { outcome: 'succeeded' }),
      chat('interrupt', { outcome: 'interrupted' }), chat('idle'), chat('retry'), chat('running'), chat('fresh')], {
      execution: { retry: { type: 'retry', at: now - 10 }, fresh: { type: 'busy', at: now + 1 } },
    }, { running: { type: 'busy' } });
    const overview = selectMission([server('a')], { a }, now);
    expect(overview.counts).toEqual({ attention: 0, running: 3, failed: 1, completed: 1 });
    expect(overview.expires).toBe(now - 100 + RECENT_COMPLETION_MS);
    expect(selectMission([server('a')], { a }, overview.expires!).counts.completed).toBe(0);
  });

  it('isolates partial data and suppresses offline, deleted, archived and superseded approval data', () => {
    const approvals = { '/repo': { permissions: ['same', 'deleted', 'archived'].map((sessionID) => ({ sessionID, id: sessionID })) } };
    const sessions = [chat('same'), chat('deleted'), chat('archived', { time: { created: 1, updated: now, archived: now } })];
    const catalogs = {
      a: catalog(sessions, { phase: 'partial', approvals, removed: new Set(['deleted']) }),
      b: catalog([chat('same')], { phase: 'offline', approvals }),
      c: catalog([chat('same')], { revision: 0, approvals }),
      d: catalog([chat('same')], { authorized: false, phase: 'offline', approvals }),
    };
    const overview = selectMission(['a', 'b', 'c', 'd'].map(server), catalogs, now);
    expect(overview.counts.attention).toBe(1);
    expect(overview.rows.map(({ status, stale }) => [status, stale])).toEqual([['attention', false], ['unknown', true]]);
    expect(overview.servers.map(({ phase }) => phase)).toEqual(['partial', 'offline', 'checking', 'offline']);
  });

  it('aggregates a large catalog without treating idle metadata as success', () => {
    const chats = Array.from({ length: 2_000 }, (_, index) => chat(String(index)));
    const a = catalog(chats, { running: { ids: new Set(['42']), at: now } });
    const overview = selectMission([server('a')], { a }, now);
    expect(overview.rows).toHaveLength(chats.length);
    expect(overview.rows[0].target.sessionId).toBe('42');
    expect(overview.counts).toEqual({ attention: 0, running: 1, failed: 0, completed: 0 });
  });
});
