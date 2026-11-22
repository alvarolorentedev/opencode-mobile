import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPendingTaskFinishedNotification, listPendingTaskFinishedNotifications, notifyTaskFinished } from '@/features/notifications/runtime';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Session } from '@/shared/protocol/opencode/types';
import { readSessionSettlement } from '@/shared/protocol/services/session-service';

import { reconcilePromptSettlement } from '../services/prompt-settlement';

vi.mock('@/features/notifications/runtime', () => ({
  clearPendingTaskFinishedNotification: vi.fn(async () => true),
  listPendingTaskFinishedNotifications: vi.fn(),
  notifyTaskFinished: vi.fn(),
  pendingNotificationKey: (scope: string, id: string) => `${scope}:${id}`,
}));
vi.mock('@/shared/protocol/services/session-service', () => ({ readSessionSettlement: vi.fn() }));

describe('prompt settlement', () => {
  const client = {} as ScopedOpencodeClient;
  const connectionScope = 'server';
  const session = { id: 'chat', title: 'Release checks' } as Session;
  const pending = {
    connectionScope, sessionId: session.id, projectPath: '/repo', requestedAt: 10_000,
    settings: { serverUrl: 'https://server.example', username: '' },
  };
  const input = { client, isCurrentClient: () => true, connectionScope, activeProjectPath: '/repo', sessions: [session] };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listPendingTaskFinishedNotifications).mockResolvedValue([pending]);
    vi.mocked(readSessionSettlement).mockResolvedValue({ state: 'finished' });
  });

  it('uses an observed busy status to confirm a fast completion', async () => {
    const operations = {
      busyNotifications: new Set<string>(), isSending: () => false,
      clock: () => 10_500, signal: new AbortController().signal,
    };
    await reconcilePromptSettlement({ ...input, sessionStatuses: { chat: { type: 'busy' } } }, operations);
    expect(readSessionSettlement).not.toHaveBeenCalled();
    const idle = { type: 'idle' } as const;
    await reconcilePromptSettlement({ ...input, sessionStatuses: { chat: idle } }, operations);
    expect(readSessionSettlement).toHaveBeenCalledWith(client, 'chat', idle, pending.requestedAt);
    expect(clearPendingTaskFinishedNotification).toHaveBeenCalledWith(connectionScope, 'chat', pending.requestedAt);
    expect(notifyTaskFinished).toHaveBeenCalledWith({
      sessionId: 'chat', sessionTitle: session.title, projectPath: '/repo', connectionScope, outcome: 'finished',
    });
  });

  it('retains the pending record when credentials change during confirmation', async () => {
    let current = true;
    vi.mocked(readSessionSettlement).mockImplementationOnce(async () => {
      current = false;
      return { state: 'finished' };
    });
    await reconcilePromptSettlement({ ...input, isCurrentClient: () => current, sessionStatuses: {} }, {
      busyNotifications: new Set<string>(), isSending: () => false,
      clock: () => 15_000, signal: new AbortController().signal,
    });
    expect(readSessionSettlement).toHaveBeenCalledWith(client, 'chat', undefined, pending.requestedAt);
    expect(clearPendingTaskFinishedNotification).not.toHaveBeenCalled();
    expect(notifyTaskFinished).not.toHaveBeenCalled();
  });
});
