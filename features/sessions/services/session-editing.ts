import type { QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { QueryIdentity } from '@/shared/server-data/keys';
import type { TranscriptReadOptions } from '@/shared/contracts/transcript-read';
import {
  deleteSession as deleteRemoteSession,
  interruptSession,
  revertSession as revertRemoteSession,
  unrevertSession as unrevertRemoteSession,
  updateSessionTitle,
  waitForSessionIdle,
} from '@/shared/protocol/services/session-service';

import { approvalsAccess } from './approvals';
import { forgetSessionCreation } from './session-creation';
import { sessionCatalogAccess } from './session-catalog-access';

type SessionEditContext = {
  cache: QueryClient;
  identity: QueryIdentity;
  client: ScopedOpencodeClient;
  isCurrent: () => boolean;
  clearSession: (sessionId: string) => void;
  runRename: (key: string, rename: () => Promise<void>) => Promise<void>;
  refreshSessions: () => Promise<unknown>;
  refreshSessionDiff: (sessionId: string, silent: boolean) => Promise<unknown>;
  refreshMessages: (sessionId: string, silent: boolean, options?: TranscriptReadOptions) => Promise<unknown>;
  refreshActiveSessions: () => Promise<unknown>;
};

function without<T>(entries: Record<string, T>, id: string) {
  if (!(id in entries)) return entries;
  const next = { ...entries };
  delete next[id];
  return next;
}

export function sessionEditCommands({
  cache, identity, client, isCurrent, clearSession, runRename, refreshSessions, refreshSessionDiff,
  refreshMessages, refreshActiveSessions,
}: SessionEditContext) {
  const catalog = sessionCatalogAccess(cache, identity, client);
  const approvals = approvalsAccess(cache, identity, client);
  const check = () => { if (!isCurrent()) throw new Error('This server is no longer available.'); };

  async function deleteSession(sessionId: string) {
    check();
    await deleteRemoteSession(client, sessionId);
    if (!isCurrent()) return;
    clearSession(sessionId);
    approvals.setPermissions((current) => without(current, sessionId));
    approvals.setQuestions((current) => without(current, sessionId));
    forgetSessionCreation(cache, identity, client, sessionId);
    catalog.setSessions((current) => current.filter(({ id }) => id !== sessionId));
    catalog.setSessionStatuses((current) => without(current, sessionId));
    void refreshActiveSessions().catch(() => undefined);
  }

  async function renameSession(sessionId: string, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error('Enter a session title.');
    check();
    // Serializing edits keeps a failed response from rolling back a newer
    // accepted title. Only the project's own list is echoed while it runs.
    const key = [...catalog.projectKey, 'rename', sessionId];
    await runRename(JSON.stringify(key), async () => {
      check();
      const previousTitle = catalog.readSessions().find(({ id }) => id === sessionId)?.title;
      catalog.setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, title: nextTitle } : session));
      try {
        await updateSessionTitle(client, sessionId, nextTitle);
      } catch (error) {
        if (isCurrent() && previousTitle !== undefined) {
          catalog.setSessions((current) => current.map((session) => session.id === sessionId && session.title === nextTitle
            ? { ...session, title: previousTitle } : session));
        }
        throw error;
      }
    });
  }

  async function refreshAfterRevert(sessionId: string) {
    if (!isCurrent()) return;
    await Promise.all([refreshSessions(), refreshMessages(sessionId, true, { mode: 'replace' }), refreshSessionDiff(sessionId, true)]);
  }

  async function revertSession(sessionId: string, messageId: string) {
    check();
    // Stop first, then let OpenCode finish settling before the rewind.
    await interruptSession(client, sessionId);
    check();
    await waitForSessionIdle(client, sessionId);
    check();
    await revertRemoteSession(client, sessionId, messageId);
    await refreshAfterRevert(sessionId);
  }

  async function unrevertSession(sessionId: string) {
    check();
    await unrevertRemoteSession(client, sessionId);
    await refreshAfterRevert(sessionId);
  }

  return { deleteSession, renameSession, revertSession, unrevertSession };
}
