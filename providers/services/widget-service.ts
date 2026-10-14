import { buildClient, type ScopedOpencodeClient, type OpencodeConnectionSettings, type ServerContract } from '@/lib/opencode/client';
import { listPendingPermissions, listPendingQuestions } from '@/lib/opencode/client/interactions';
import { coalesceRead } from '@/lib/opencode/in-flight';
import { getSessionMessages, listActiveSessions } from '@/providers/services/session-service';
import { recentWidgetSessions } from '@/providers/widget-content';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@/lib/opencode/client';

export type WidgetInteractions = { permissions: PendingPermissionRequest[]; questions: PendingQuestionRequest[] };

// Failed surface reads stay undefined, so a transient error cannot look like
// all questions were answered or all replies disappeared.
export function readWidgetData(client: ScopedOpencodeClient, settings: OpencodeConnectionSettings, contract: ServerContract,
  options: { probeAllDirectories?: boolean; watchedDirectories?: Set<string>; watchedSessionIds?: Set<string>; previousInteractions?: Record<string, WidgetInteractions> } = {}) {
  return coalesceRead(client, 'widget-data', async () => {
    const { sessions, statuses } = await listActiveSessions(client);
    const eligible = sessions.filter((session) => session.directory && !session.time.archived);
    const activeDirectories = new Set(eligible.filter((session) => options.watchedSessionIds?.has(session.id)
      || (statuses[session.id]?.type !== 'idle' && !!statuses[session.id])).map((session) => session.directory!));
    const directories = new Set(eligible.map((session) => session.directory!));
    const probeDirectories = new Set([...directories].filter((directory) => options.probeAllDirectories !== false || activeDirectories.has(directory) || options.watchedDirectories?.has(directory)));
    const clients = new Map([...new Set([...probeDirectories, ...recentWidgetSessions(eligible).map((session) => session.directory!)])]
      .map((directory) => [directory, buildClient({ ...settings, directory }, contract)]));
    const [messages, interactions] = await Promise.allSettled([
      Promise.all(recentWidgetSessions(eligible).map(async (session) => {
        const page = await getSessionMessages(clients.get(session.directory!)!, session.id, { limit: 20 });
        return [session.id, page.records] as const;
      })),
      Promise.all([...clients.entries()].filter(([directory]) => probeDirectories.has(directory)).map(async ([directory, scoped]) => {
        const [permissions, questions] = await Promise.all([listPendingPermissions(scoped), listPendingQuestions(scoped)]);
        if (!permissions || !questions) throw new Error('Pending widget interactions are unavailable.');
        return [directory, { permissions, questions }] as const;
      })),
    ]);
    const interactionsByDirectory = Object.fromEntries([...directories].flatMap((directory) => options.previousInteractions?.[directory] ? [[directory, options.previousInteractions[directory]]] : []));
    if (interactions.status === 'fulfilled') Object.assign(interactionsByDirectory, Object.fromEntries(interactions.value));
    return { sessions: eligible, statuses, interactionsByDirectory,
      messages: messages.status === 'fulfilled' ? Object.fromEntries(messages.value) : undefined,
      interactions: interactions.status === 'fulfilled' ? {
        permissions: [...new Map(Object.values(interactionsByDirectory).flatMap((entry) => entry.permissions).map((request) => [request.id, request])).values()],
        questions: [...new Map(Object.values(interactionsByDirectory).flatMap((entry) => entry.questions).map((request) => [request.id, request])).values()],
      } : undefined };
  });
}
