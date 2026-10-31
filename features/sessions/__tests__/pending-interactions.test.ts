import { describe, expect, it, vi } from 'vitest';

import { getCurrentPendingRequests } from '@/features/sessions/model/selectors';
import { isPromptErrorVisible } from '@/features/chat/model/selectors';
import { collectDescendantSessionIds } from '@/features/sessions/model/session-utils';

vi.mock('@/shared/i18n/index', () => ({ getFormatLocale: () => 'en' }));

type MiniSession = { id: string; parentID?: string };
const tree = (sessions: MiniSession[]) => sessions as never;

describe('collectDescendantSessionIds', () => {
  const sessions: MiniSession[] = [
    { id: 'root' },
    { id: 'child', parentID: 'root' },
    { id: 'grandchild', parentID: 'child' },
    { id: 'great-grandchild', parentID: 'grandchild' },
    { id: 'sibling', parentID: 'other-root' },
    { id: 'other-root' },
  ];

  it('collects the full descendant subtree, including roots', () => {
    expect([...collectDescendantSessionIds(tree(sessions), ['root'])]).toEqual([
      'root', 'child', 'grandchild', 'great-grandchild',
    ]);
  });

  it('ignores siblings and other roots', () => {
    const ids = collectDescendantSessionIds(tree(sessions), ['root']);
    expect(ids.has('sibling')).toBe(false);
    expect(ids.has('other-root')).toBe(false);
  });

  it('is cycle-safe and ignores empty roots', () => {
    const cyclic: MiniSession[] = [
      { id: 'a', parentID: 'b' },
      { id: 'b', parentID: 'a' },
    ];
    expect([...collectDescendantSessionIds(tree(cyclic), ['a'])]).toEqual(['a', 'b']);
    expect([...collectDescendantSessionIds(tree(sessions), [undefined, 'child'])]).toEqual([
      'child', 'grandchild', 'great-grandchild',
    ]);
  });
});

describe('getCurrentPendingRequests', () => {
  const permission = (id: string, sessionID: string) => ({ id, sessionID });

  it('drops a subagent request when no related sessions are supplied', () => {
    const bySession = { child: [permission('p1', 'child')] };
    expect(getCurrentPendingRequests('root', undefined, bySession)).toEqual([]);
  });

  it('surfaces a subagent request through its root session', () => {
    const bySession = { child: [permission('p1', 'child')] };
    const related = collectDescendantSessionIds(
      tree([{ id: 'root' }, { id: 'child', parentID: 'root' }]),
      ['root'],
    );
    expect(getCurrentPendingRequests('root', undefined, bySession, related)).toEqual([
      permission('p1', 'child'),
    ]);
  });

  it('keeps unrelated sessions out and preserves the global sentinel', () => {
    const bySession = {
      root: [permission('p-root', 'root')],
      unrelated: [permission('p-unrelated', 'unrelated')],
      global: [permission('p-global', 'global')],
    };
    const related = collectDescendantSessionIds(
      tree([{ id: 'root' }, { id: 'child', parentID: 'root' }, { id: 'unrelated' }]),
      ['root'],
    );
    expect(getCurrentPendingRequests('root', undefined, bySession, related).map((item) => item.id)).toEqual([
      'p-root', 'p-global',
    ]);
  });
});

describe('isPromptErrorVisible', () => {
  const related = collectDescendantSessionIds(
    tree([{ id: 'root' }, { id: 'child', parentID: 'root' }]),
    ['root'],
  );

  it('surfaces global errors and errors from the active tree', () => {
    expect(isPromptErrorVisible({ sessionId: undefined }, related)).toBe(true);
    expect(isPromptErrorVisible({ sessionId: 'root' }, related)).toBe(true);
    expect(isPromptErrorVisible({ sessionId: 'child' }, related)).toBe(true);
  });

  it('hides errors from unrelated sessions and absent errors', () => {
    expect(isPromptErrorVisible({ sessionId: 'unrelated' }, related)).toBe(false);
    expect(isPromptErrorVisible(undefined, related)).toBe(false);
  });
});
