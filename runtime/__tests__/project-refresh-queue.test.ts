import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProjectRefreshQueue } from '@/runtime/realtime/project-refresh-queue';
import type { SessionMessageRecord } from '@/shared/presentation/format';

function refreshActions() {
  return {
    refreshMessages: vi.fn(async (): Promise<SessionMessageRecord[]> => []),
    refreshSessionDiff: vi.fn(async () => []),
    refreshSessionTodos: vi.fn(async () => []),
    refreshSessions: vi.fn(async () => []),
  };
}

describe('project refresh queue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces an inbox delivery and a targeted update into one page before reading diffs', async () => {
    const queue = createProjectRefreshQueue();
    const actions = refreshActions();
    queue.scheduleSession('s', { inboxOnly: true, delivered: true, inboxID: 'pending' }, actions);
    queue.scheduleSession('s', { inboxOnly: true, inboxID: 'later-enqueue' }, actions);
    queue.scheduleSession('s', { messages: true, messageId: 'assistant' }, actions);
    queue.scheduleSession('s', { messages: true, messageMode: 'replace', diff: true, delayMs: 50 }, actions);
    await vi.advanceTimersByTimeAsync(49);
    expect(actions.refreshMessages).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(actions.refreshMessages).toHaveBeenCalledExactlyOnceWith('s', true, {
      mode: 'replace', delivered: true, inboxID: 'pending',
    });
    expect(actions.refreshSessionDiff).toHaveBeenCalledExactlyOnceWith('s', true, undefined, []);
  });

  it('drops the catalog timer and dependent reads when its project binding is cleared', async () => {
    const queue = createProjectRefreshQueue();
    const actions = refreshActions();
    const pending = Promise.withResolvers<SessionMessageRecord[]>();
    actions.refreshMessages.mockReturnValueOnce(pending.promise);
    queue.scheduleCatalog(actions.refreshSessions);
    queue.scheduleSession('s', { messages: true, diff: true, todos: true, delayMs: 50 }, actions);
    await vi.advanceTimersByTimeAsync(50);
    expect(actions.refreshMessages).toHaveBeenCalledOnce();

    queue.clear();
    pending.resolve([]);
    await vi.runAllTimersAsync();
    expect(actions.refreshSessions).not.toHaveBeenCalled();
    expect(actions.refreshSessionDiff).not.toHaveBeenCalled();
    expect(actions.refreshSessionTodos).not.toHaveBeenCalled();
  });
});
