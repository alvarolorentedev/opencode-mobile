import { describe, expect, it } from 'vitest';

import type { ActiveSessionItem } from '@/providers/opencode-provider-types';
import {
  WIDGET_SNAPSHOT_MAX_SESSIONS,
  WIDGET_SNAPSHOT_MAX_TITLE,
  buildWidgetSnapshot,
  parseWidgetSnapshot,
} from '@/providers/widget-snapshot';

function session(overrides: Partial<ActiveSessionItem> = {}): ActiveSessionItem {
  return {
    sessionId: 's1',
    projectPath: '/repo',
    title: 'Fix the parser',
    status: { type: 'idle' },
    isCurrent: false,
    updatedAt: 1,
    ...overrides,
  };
}

describe('widget snapshot', () => {
  it('builds bounded, non-secret session rows with resolver links', () => {
    const snapshot = buildWidgetSnapshot({
      activeSessions: [
        session({ sessionId: 'busy', status: { type: 'busy' } }),
        session({ sessionId: 'idle' }),
        session({ sessionId: 'retry', status: { type: 'retry', attempt: 1, message: 'x', next: 2 } }),
        session({ sessionId: 'extra' }),
      ],
      connectionScope: 'scope',
      untitledLabel: 'Untitled chat',
      updatedAt: 1234,
    });

    expect(snapshot.updatedAt).toBe(1234);
    expect(snapshot.sessions).toHaveLength(WIDGET_SNAPSHOT_MAX_SESSIONS);
    expect(snapshot.sessions[0]).toEqual({
      id: 'busy',
      title: 'Fix the parser',
      status: 'busy',
      link: 'opencodemobile://session/busy?project=%2Frepo&connectionScope=scope',
    });
    expect(snapshot.sessions.map((entry) => entry.status)).toEqual(['busy', 'idle', 'retry']);
  });

  it('publishes an empty list without a connection scope or usable routing data', () => {
    expect(buildWidgetSnapshot({
      activeSessions: [session()],
      connectionScope: '',
      untitledLabel: 'x',
      updatedAt: 1,
    }).sessions).toEqual([]);
    expect(buildWidgetSnapshot({
      activeSessions: [session({ sessionId: '', projectPath: '' })],
      connectionScope: 'scope',
      untitledLabel: 'x',
      updatedAt: 1,
    }).sessions).toEqual([]);
  });

  it('truncates long titles and falls back to the untitled label', () => {
    const snapshot = buildWidgetSnapshot({
      activeSessions: [
        session({ sessionId: 'long', title: 't'.repeat(WIDGET_SNAPSHOT_MAX_TITLE + 50) }),
        session({ sessionId: 'blank', title: '  ' }),
      ],
      connectionScope: 'scope',
      untitledLabel: 'Untitled chat',
      updatedAt: 1,
    });

    expect(snapshot.sessions[0].title).toHaveLength(WIDGET_SNAPSHOT_MAX_TITLE);
    expect(snapshot.sessions[1].title).toBe('Untitled chat');
  });

  it('rejects malformed snapshot values and drops bad rows individually', () => {
    expect(parseWidgetSnapshot(undefined)).toBeUndefined();
    expect(parseWidgetSnapshot('nope')).toBeUndefined();
    expect(parseWidgetSnapshot({ updatedAt: 'yesterday', sessions: [] })).toBeUndefined();
    expect(parseWidgetSnapshot({ updatedAt: 1, sessions: 'nope' })).toBeUndefined();

    const parsed = parseWidgetSnapshot({
      updatedAt: 42,
      sessions: [
        { id: 'ok', title: 'Good', status: 'busy', link: 'opencodemobile://session/ok?project=%2Fr&connectionScope=s' },
        { id: 'bad-link', title: 'Bad', status: 'idle', link: 'https://example.com' },
        { id: 'bad-status', title: 'Bad', status: 'running', link: 'opencodemobile://session/x' },
        { id: 'bad-title', title: '  ', status: 'idle', link: 'opencodemobile://session/x' },
      ],
    });

    expect(parsed).toEqual({
      updatedAt: 42,
      sessions: [
        { id: 'ok', title: 'Good', status: 'busy', link: 'opencodemobile://session/ok?project=%2Fr&connectionScope=s' },
      ],
    });
  });
});
