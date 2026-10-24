import { describe, expect, it, vi } from 'vitest';

import type { Session } from '@/lib/opencode/types';
import { recentWidgetSessions, widgetSession } from '@/providers/widget-content';
import {
  WIDGET_SNAPSHOT_MAX_SESSIONS,
  WIDGET_SNAPSHOT_MAX_TITLE,
  parseWidgetSnapshot,
} from '@/providers/widget-snapshot';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Fix the parser',
    directory: '/repo',
    time: { created: 1, updated: 1 },
    ...overrides,
  };
}

describe('widget snapshot', () => {
  it('builds bounded, non-secret session rows with resolver links', () => {
    const sessions = [
      session({ id: 'busy', time: { created: 1, updated: 4 } }),
      session({ id: 'idle', time: { created: 1, updated: 3 } }),
      session({ id: 'retry', time: { created: 1, updated: 2 } }),
      session({ id: 'extra', time: { created: 1, updated: 1 } }),
    ];
    const statuses = {
      busy: { type: 'busy' as const },
      idle: { type: 'idle' as const },
      retry: { type: 'retry' as const, attempt: 1, message: 'x', next: 2 },
    };
    const recent = recentWidgetSessions(sessions);

    expect(recent).toHaveLength(WIDGET_SNAPSHOT_MAX_SESSIONS);
    const rows = recent.map((entry) => widgetSession(entry, 'scope', 'Untitled chat', statuses[entry.id as keyof typeof statuses]));
    expect(rows[0]).toEqual({
      id: 'busy',
      title: 'Fix the parser',
      status: 'busy',
      link: 'opencodemobile://session/busy?project=%2Frepo&connectionScope=scope',
    });
    expect(rows.map((entry) => entry.status)).toEqual(['busy', 'idle', 'retry']);
  });

  it('drops sessions without usable routing data', () => {
    expect(recentWidgetSessions([session({ directory: undefined })])).toEqual([]);
    expect(recentWidgetSessions([session({ parentID: 'parent' })])).toEqual([]);
    expect(recentWidgetSessions([session({ time: { created: 1, updated: 1, archived: 2 } })])).toEqual([]);
  });

  it('truncates long titles and falls back to the untitled label', () => {
    expect(widgetSession(session({ title: 't'.repeat(WIDGET_SNAPSHOT_MAX_TITLE + 50) }), 'scope', 'Untitled chat').title)
      .toHaveLength(WIDGET_SNAPSHOT_MAX_TITLE);
    expect(widgetSession(session({ title: '  ' }), 'scope', 'Untitled chat').title).toBe('Untitled chat');
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
