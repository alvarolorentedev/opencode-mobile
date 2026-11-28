import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { Session } from '@/shared/protocol/opencode/types';
import { adjacentSessionId, swipeSessionDirection } from '@/features/chat/model/session-swipe';

function session(id: string, updated: number, extra: Partial<Session> = {}): Session {
  return { id, title: id, directory: '/workspace/demo-project', time: { created: 1, updated }, ...extra } as Session;
}

describe('session swipe ordering', () => {
  it('walks the project catalog newest first and stops at the ends', () => {
    const sessions = [session('oldest', 100), session('newest', 300), session('middle', 200)];
    assert.equal(adjacentSessionId(sessions, 'middle', 'next'), 'oldest');
    assert.equal(adjacentSessionId(sessions, 'middle', 'previous'), 'newest');
    assert.equal(adjacentSessionId(sessions, 'newest', 'previous'), undefined);
    assert.equal(adjacentSessionId(sessions, 'oldest', 'next'), undefined);
  });

  it('skips archived and subagent chats', () => {
    const sessions = [
      session('current', 400),
      session('archived', 300, { time: { created: 1, updated: 300, archived: 1 } }),
      session('child', 200, { parentID: 'current' }),
      session('sibling', 100),
    ];
    assert.equal(adjacentSessionId(sessions, 'current', 'next'), 'sibling');
    assert.equal(adjacentSessionId(sessions, 'sibling', 'previous'), 'current');
  });

  it('is deterministic for equal timestamps and ignores an unknown current chat', () => {
    const sessions = [session('b', 100), session('a', 100)];
    assert.equal(adjacentSessionId(sessions, 'b', 'previous'), 'a');
    assert.equal(adjacentSessionId(sessions, 'missing', 'next'), undefined);
    assert.equal(adjacentSessionId(sessions, undefined, 'next'), undefined);
  });

  it('maps physical swipes to catalog order and mirrors them in RTL', () => {
    assert.equal(swipeSessionDirection(-100, false), 'next');
    assert.equal(swipeSessionDirection(100, false), 'previous');
    assert.equal(swipeSessionDirection(-100, true), 'previous');
    assert.equal(swipeSessionDirection(100, true), 'next');
  });
});
