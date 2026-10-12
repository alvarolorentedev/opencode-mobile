import { listPendingPermissions, listPendingQuestions } from '@/lib/opencode/client/interactions';
import { buildClient, type OpencodeConnectionSettings, type ScopedOpencodeClient, type ServerContract } from '@/lib/opencode/client';
import type { Session } from '@/lib/opencode/types';
import type { ActivitySnapshot } from '@/providers/activity-notification-state';
import { getSessionMessages, listActiveSessions } from '@/providers/services/session-service';
import { requireData } from '@/providers/services/require-data';

export async function readActivitySnapshot(catalogClient: ScopedOpencodeClient, settings: OpencodeConnectionSettings, contract: ServerContract, watched: Set<string>): Promise<ActivitySnapshot> {
  const { sessions, statuses } = await listActiveSessions(catalogClient);
  const eligible = sessions.filter((session): session is Session & { directory: string } => Boolean(session.directory && !session.time.archived));
  const clients = new Map([...new Set(eligible.map((session) => session.directory))].map((directory) =>
    [directory, buildClient({ ...settings, directory }, contract)]));
  const blocked = new Set<string>();
  // Both reads must succeed before an idle snapshot can mean completion.
  await Promise.all([...clients.values()].map(async (client) => {
    const [permissions, questions] = await Promise.all([listPendingPermissions(client), listPendingQuestions(client)]);
    for (const request of [...requireData(permissions, 'activity permissions'), ...requireData(questions, 'activity questions')]) blocked.add(request.sessionID);
  }));
  const messages: ActivitySnapshot['messages'] = {};
  const queued = new Set<string>();
  await Promise.all(eligible.filter((session) => watched.has(session.id) || blocked.has(session.id) || (statuses[session.id] && statuses[session.id].type !== 'idle')).map(async (session) => {
    const client = clients.get(session.directory)!;
    const [page, inbox] = await Promise.all([
      getSessionMessages(client, session.id, { limit: 20 }),
      client.promptInbox?.list(session.id),
    ]);
    messages[session.id] = page.records;
    if (inbox?.length) queued.add(session.id);
  }));
  return { sessions: eligible, statuses, blocked, queued, messages };
}
