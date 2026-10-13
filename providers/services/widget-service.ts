import { buildClient, type ScopedOpencodeClient, type OpencodeConnectionSettings, type ServerContract } from '@/lib/opencode/client';
import { listPendingPermissions, listPendingQuestions } from '@/lib/opencode/client/interactions';
import { coalesceRead } from '@/lib/opencode/in-flight';
import { getSessionMessages, listActiveSessions } from '@/providers/services/session-service';
import { recentWidgetSessions } from '@/providers/widget-content';

// Failed surface reads stay undefined, so a transient error cannot look like
// all questions were answered or all replies disappeared.
export function readWidgetData(client: ScopedOpencodeClient, settings: OpencodeConnectionSettings, contract: ServerContract) {
  return coalesceRead(client, 'widget-data', async () => {
    const { sessions, statuses } = await listActiveSessions(client);
    const eligible = sessions.filter((session) => session.directory && !session.time.archived);
    const clients = new Map([...new Set(eligible.map((session) => session.directory!))]
      .map((directory) => [directory, buildClient({ ...settings, directory }, contract)]));
    const [messages, interactions] = await Promise.allSettled([
      Promise.all(recentWidgetSessions(eligible).map(async (session) => {
        const page = await getSessionMessages(clients.get(session.directory!)!, session.id, { limit: 20 });
        return [session.id, page.records] as const;
      })),
      Promise.all([...clients.values()].map(async (scoped) => {
        const [permissions, questions] = await Promise.all([listPendingPermissions(scoped), listPendingQuestions(scoped)]);
        if (!permissions || !questions) throw new Error('Pending widget interactions are unavailable.');
        return { permissions, questions };
      })),
    ]);
    return { sessions: eligible, statuses,
      messages: messages.status === 'fulfilled' ? Object.fromEntries(messages.value) : undefined,
      interactions: interactions.status === 'fulfilled' ? {
        permissions: [...new Map(interactions.value.flatMap((entry) => entry.permissions).map((request) => [request.id, request])).values()],
        questions: [...new Map(interactions.value.flatMap((entry) => entry.questions).map((request) => [request.id, request])).values()],
      } : undefined };
  });
}
