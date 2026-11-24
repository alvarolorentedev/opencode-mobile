import { describe, expect, it } from 'vitest';

import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

import { areSessionListsEqual, sessionUnreadAt } from '../model/session-utils';
import { librarySessions } from '../model/workspace-library';

const time = (idle?: number, viewed?: number) => ({
  created: 1,
  updated: 1,
  ...(idle === undefined ? {} : { idle }),
  ...(viewed === undefined ? {} : { viewed }),
});

const session = (idle?: number, viewed?: number): Session => ({ id: 's', title: 'Chat', time: time(idle, viewed) }) as Session;

const connection = {
  id: 'c',
  name: 'Server',
  enabled: true,
  settings: { serverUrl: 'http://server.test', username: '', password: '', directory: '/repo' },
} as never;
const lifecycles = new Map([['c', { connection: { status: 'connected' } }]]);
const project = (currentSessionId?: string) => [{ connectionId: 'c', projectPath: '/repo', currentSessionId, sessions: [session(20, 10)] }];
const catalogs = (statuses: Record<string, SessionStatus> = {}) => ({ c: { sessions: [], statuses } });

describe('session read state', () => {
  it('treats a completed run newer than the viewed watermark as unread', () => {
    expect(sessionUnreadAt(session(20, 10))).toBe(20);
    expect(sessionUnreadAt(session(20, 20))).toBeUndefined();
    expect(sessionUnreadAt(session())).toBeUndefined();
  });

  it('notices a viewed-only list change', () => {
    const before = [session(20, 10)];
    const after = [{ ...before[0], time: { ...before[0].time, viewed: 20 } }];
    expect(areSessionListsEqual(before, after)).toBe(false);
  });

  it('marks idle, unviewed rows outside the current selection as unread', () => {
    const unread = librarySessions([connection], project(), lifecycles, catalogs(), [])[0];
    const current = librarySessions([connection], project('s'), lifecycles, catalogs(), [], { connectionId: 'c', projectPath: '/repo' })[0];
    const running = librarySessions([connection], project(), lifecycles, catalogs({ s: { type: 'busy' } }), [])[0];
    const viewed = librarySessions([connection], [{ connectionId: 'c', projectPath: '/repo', sessions: [session(20, 20)] }], lifecycles, catalogs(), [])[0];
    expect(unread.unread).toBe(true);
    expect(current.unread).toBe(false);
    expect(running.unread).toBe(false);
    expect(viewed.unread).toBe(false);
  });
});
