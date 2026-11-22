import { clearPendingTaskFinishedNotification, listPendingTaskFinishedNotifications, notifyTaskFinished, pendingNotificationKey } from '@/features/notifications/runtime';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import { readSessionSettlement } from '@/shared/protocol/services/session-service';

type PromptSettlementInput = {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  activeProjectPath?: string;
  connectionScope: string;
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
};

export async function reconcilePromptSettlement(
  { client, isCurrentClient, activeProjectPath, connectionScope, sessions, sessionStatuses }: PromptSettlementInput,
  { busyNotifications, isSending, clock, signal }: {
    busyNotifications: Set<string>;
    isSending: (sessionId: string) => boolean;
    clock: () => number;
    signal: AbortSignal;
  },
) {
  const stale = () => signal.aborted || !isCurrentClient(client);
  if (stale()) return;
  const pendingEntries = await listPendingTaskFinishedNotifications(connectionScope);
  if (stale() || pendingEntries.length === 0) {
    return;
  }

  for (const pending of pendingEntries) {
    if (stale()) return;
    const { sessionId } = pending;
    const key = pendingNotificationKey(pending.connectionScope, sessionId);
    // A record for another project cannot be confirmed from this project's
    // session list; keep it for the background monitor or a later return to
    // that project instead of dropping a completion silently.
    if (pending.projectPath !== activeProjectPath) {
      continue;
    }
    const status = sessionStatuses[sessionId];
    // Latch once the session has actually started working so an early
    // completion notifies without waiting out the debounce below.
    if (status && status.type !== 'idle') {
      busyNotifications.add(key);
      continue;
    }

    const session = sessions.find((item) => item.id === sessionId);
    // A deleted or not-yet-loaded session is not proof of completion. The
    // background monitor drops genuinely deleted records.
    if (!session) {
      continue;
    }

    const oldEnough = clock() - pending.requestedAt >= 5000;
    const latched = busyNotifications.has(key);
    if ((!latched && !oldEnough) || isSending(sessionId)) {
      continue;
    }

    // Confirm against the server before notifying. When this app session
    // already observed the task running, the known idle status is enough to
    // skip the extra status read; otherwise (for example a cold start from a
    // persisted record) the settlement read verifies the server instead of
    // trusting a cached idle status.
    const settlement = await readSessionSettlement(client, sessionId, latched ? status : undefined, pending.requestedAt);
    if (stale()) {
      return;
    }
    if (settlement.state === 'running' || settlement.state === 'retrying'
      || settlement.state === 'blocked' || settlement.state === 'unknown') {
      continue;
    }
    if (settlement.state === 'aborted') {
      busyNotifications.delete(key);
      await clearPendingTaskFinishedNotification(connectionScope, sessionId, pending.requestedAt);
      continue;
    }

    const cleared = await clearPendingTaskFinishedNotification(connectionScope, sessionId, pending.requestedAt);
    if (stale()) {
      return;
    }

    busyNotifications.delete(key);
    if (cleared) {
      await notifyTaskFinished({
        sessionId,
        sessionTitle: session.title,
        projectPath: pending.projectPath,
        connectionScope,
        outcome: settlement.state === 'failed' ? 'failed' : 'finished',
      });
    }
  }
}
