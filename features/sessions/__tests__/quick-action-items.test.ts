import { describe, expect, it } from 'vitest';

import type { ActiveSessionItem } from '@/shared/contracts/domain';
import { MAX_SESSION_QUICK_ACTIONS, getSessionQuickActions } from '@/features/sessions/model/quick-action-items';

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

describe('session quick actions', () => {
  it('publishes running-first sessions with a non-secret routing payload', () => {
    const items = getSessionQuickActions({
      activeSessions: [
        session({ sessionId: 'busy', title: 'Running task', status: { type: 'busy' } }),
        session({ sessionId: 'idle', title: 'Idle task' }),
      ],
      connectionScope: 'scope',
      untitledLabel: 'Untitled chat',
    });

    expect(items).toEqual([
      {
        id: 'session:busy',
        title: 'Running task',
        params: { sessionId: 'busy', projectPath: '/repo', connectionScope: 'scope' },
      },
      {
        id: 'session:idle',
        title: 'Idle task',
        params: { sessionId: 'idle', projectPath: '/repo', connectionScope: 'scope' },
      },
    ]);
  });

  it('falls back to the untitled label and drops entries without routing data', () => {
    const items = getSessionQuickActions({
      activeSessions: [
        session({ sessionId: 'blank', title: '   ' }),
        session({ sessionId: 'no-project', projectPath: '' }),
        session({ sessionId: '', title: 'Missing id' }),
      ],
      connectionScope: 'scope',
      untitledLabel: 'Untitled chat',
    });

    expect(items).toEqual([
      {
        id: 'session:blank',
        title: 'Untitled chat',
        params: { sessionId: 'blank', projectPath: '/repo', connectionScope: 'scope' },
      },
    ]);
  });

  it('leaves room for the New chat action and never publishes without a scope', () => {
    const activeSessions = Array.from({ length: 6 }, (_, index) => session({ sessionId: `s${index}` }));
    expect(getSessionQuickActions({ activeSessions, connectionScope: 'scope', untitledLabel: 'x' }))
      .toHaveLength(MAX_SESSION_QUICK_ACTIONS);
    expect(getSessionQuickActions({ activeSessions, connectionScope: '', untitledLabel: 'x' })).toEqual([]);
  });
});
