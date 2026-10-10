import type { OpencodeClient, PermissionRuleset } from '@opencode-ai/sdk/v2/client';

import type { GlobalSession, Project } from '@/lib/opencode/types';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import { requireData } from '@/providers/services/require-data';
import { coalesceRead } from '@/lib/opencode/in-flight';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';

export function getSessionInbox(client: ScopedOpencodeClient, sessionId: string) {
  return coalesceRead(client, `inbox:${sessionId}`, () => client.promptInbox!.list(sessionId));
}

export async function loadWorkspaceCatalog(catalogClient: OpencodeClient) {
  const [pathResponse, projectsResponse, currentProjectResponse] = await Promise.all([
    catalogClient.path.get(),
    catalogClient.project.list(),
    catalogClient.project.current(),
  ]);

  const discoveredProjects = requireData(projectsResponse.data, 'project list request');
  const currentProject = requireData(currentProjectResponse.data, 'current project request');
  const path = requireData(pathResponse.data, 'path request');
  const dedupedProjects = new Map<string, Project>();

  if (currentProject?.worktree) {
    dedupedProjects.set(currentProject.worktree, currentProject);
  }

  discoveredProjects.forEach((project) => {
    dedupedProjects.set(project.worktree, project);
  });

  const nextProjects = [...dedupedProjects.values()].sort(
    (left, right) => (right.time.initialized || right.time.created) - (left.time.initialized || left.time.created),
  );

  return {
    currentProjectPath: currentProject?.worktree,
    serverRootPath: path.directory,
    serverProjects: nextProjects,
  };
}

export async function resolveWorkspace(client: OpencodeClient) {
  return requireData((await client.project.current()).data, 'current project request');
}

export async function listSessions(client: OpencodeClient) {
  return coalesceRead(client, 'sessions', () => fetchSessions(client));
}

async function fetchSessions(client: OpencodeClient) {
  const [sessionsResponse, statusesResponse] = await Promise.all([client.session.list(), client.session.status()]);

  const nextSessions = [...requireData(sessionsResponse.data, 'session list request')]
    .sort((left, right) => right.time.updated - left.time.updated);
  return { sessions: nextSessions.filter((session) => !session.time.archived), statuses: requireData(statusesResponse.data, 'session status request') };
}

// Cross-workspace session snapshot for the Chat Library "Active" group. Uses an
// unscoped client (empty directory) so both contracts return sessions and
// statuses for every project on the active connection, not just the active one.
export async function listActiveSessions(client: OpencodeClient) {
  return listSessions(client);
}

export async function listArchivedSessions(client: OpencodeClient) {
  const MAX_ARCHIVED_PAGES = 10;
  const sessions: GlobalSession[] = [];
  let cursor: number | undefined;
  let pages = 0;
  do {
    const response = await client.experimental.session.list({ archived: true, cursor, limit: 100 });
    sessions.push(...requireData(response.data, 'archived session list request'));
    const next = response.response?.headers.get('x-next-cursor');
    cursor = next ? Number(next) : undefined;
    pages += 1;
  } while (cursor !== undefined && pages < MAX_ARCHIVED_PAGES);
  // archived=true includes active sessions on V1; filter after pagination.
  return sessions.filter((session) => Boolean(session.time.archived));
}

export const INITIAL_MESSAGE_LIMIT = 20;
export const HISTORY_PAGE_LIMIT = 20;

export type SessionMessagePage = {
  records: SessionMessageRecord[];
  hasMore: boolean;
  nextBefore?: string;
};

// A single backwards page of transcript. The server returns the newest page
// first and pages toward older records through an opaque cursor (V1 exposes it
// as `x-next-cursor`; the V2 adapter maps its cursor onto the same header).
// Callers request the newest page with no `before`, then page back with the
// returned `nextBefore` while scrolling up.
export async function getSessionMessages(
  client: OpencodeClient,
  sessionId: string,
  options: { limit?: number; before?: string } = {},
): Promise<SessionMessagePage> {
  const limit = options.limit ?? HISTORY_PAGE_LIMIT;
  const before = options.before;
  return coalesceRead(client, `messages:${sessionId}:${before ?? 'newest'}:${limit}`, () =>
    fetchSessionMessagePage(client, sessionId, limit, before));
}

async function fetchSessionMessagePage(client: OpencodeClient, sessionId: string, limit: number, before?: string): Promise<SessionMessagePage> {
  const response = await client.session.messages({ sessionID: sessionId, limit, before });
  const records = requireData(response.data, 'session messages request') as SessionMessageRecord[];
  const header = response.response?.headers.get('x-next-cursor') ?? undefined;
  const nextBefore = header && header !== before ? header : undefined;
  return { records, hasMore: Boolean(nextBefore), nextBefore };
}

export async function getSessionDiff(client: OpencodeClient, sessionId: string, messageId?: string, messages?: SessionMessageRecord[]) {
  // Callers that already know which turn they want pass its id and skip the
  // transcript scan. Otherwise prefer the transcript already held in memory;
  // only a cold cache pays for a newest-page read.
  let targetMessageId = messageId;
  if (!targetMessageId) {
    const source = messages ?? (await getSessionMessages(client, sessionId, { limit: INITIAL_MESSAGE_LIMIT })).records;
    const latestUserMessage = source.slice().reverse().find(({ info }) => info.role === 'user');
    if (!latestUserMessage) {
      return [];
    }
    targetMessageId = latestUserMessage.info.id;
  }

  const messageID = targetMessageId;
  return coalesceRead(client, `diff:${sessionId}:${messageID}`, async () => {
    const response = await client.session.diff({ sessionID: sessionId, messageID });
    return requireData(response.data, 'message diff request');
  });
}

export async function getSessionTodos(client: OpencodeClient, sessionId: string) {
  return coalesceRead(client, `todos:${sessionId}`, async () => {
    const response = await client.session.todo({ sessionID: sessionId });
    return requireData(response.data, 'session todo request');
  });
}

export async function deleteSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.delete({ sessionID: sessionId })).data;
}

export async function updateSessionTitle(client: OpencodeClient, sessionId: string, title: string) {
  return (await client.session.update({ sessionID: sessionId, title })).data;
}

type SessionUpdate = {
  title?: string;
  metadata?: Record<string, unknown>;
  permission?: PermissionRuleset;
  time?: { archived?: number };
};

async function updateSession(client: OpencodeClient, sessionId: string, update: SessionUpdate) {
  return requireData((await client.session.update({ sessionID: sessionId, ...update })).data, 'session update request');
}

export function archiveSession(client: OpencodeClient, sessionId: string, archived = Date.now()) {
  return updateSession(client, sessionId, { time: { archived } });
}

export function restoreSession(client: OpencodeClient, sessionId: string) {
  return updateSession(client, sessionId, { time: { archived: 0 } });
}

export async function forkSession(client: OpencodeClient, sessionId: string, messageId?: string) {
  return (await client.session.fork({ sessionID: sessionId, messageID: messageId })).data;
}

export async function shareSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.share({ sessionID: sessionId })).data;
}

export async function unshareSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.unshare({ sessionID: sessionId })).data;
}

export async function revertSession(client: OpencodeClient, sessionId: string, messageId: string, partId?: string) {
  return (await client.session.revert({ sessionID: sessionId, messageID: messageId, partID: partId })).data;
}

export async function unrevertSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.unrevert({ sessionID: sessionId })).data;
}

export async function listCommands(client: OpencodeClient) {
  return requireData((await client.command.list()).data, 'command list request');
}

export async function executeCommand(
  client: OpencodeClient,
  sessionId: string,
  command: string,
  args: string,
  options?: { agent?: string; model?: string; messageId?: string },
) {
  return (await client.session.command({
    sessionID: sessionId,
    command,
    arguments: args,
    agent: options?.agent,
    model: options?.model,
    messageID: options?.messageId,
  })).data;
}
