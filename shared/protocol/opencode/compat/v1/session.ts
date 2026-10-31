import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

import type { Project } from '@/shared/protocol/opencode/types';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { requireData } from '@/shared/protocol/opencode/require-data';
import { coalesceRead } from '@/shared/protocol/opencode/in-flight';
import { toFileDiffs } from '@/shared/protocol/opencode/diff';

// The installed SDK's generated client declares `Project` twice, so TypeScript
// drops `current` from the inferred project API. Keep the workaround for that
// upstream typing bug at the V1 compatibility boundary.
type LegacyProjectApi = {
  list: () => Promise<{ data?: Project[] }>;
  current: () => Promise<{ data?: Project }>;
};

function projectApi(client: OpencodeClient): LegacyProjectApi {
  return client.project as unknown as LegacyProjectApi;
}

export async function catalogProjects(client: OpencodeClient) {
  return requireData((await projectApi(client).list()).data, 'project list request');
}
export async function catalogLocation(client: OpencodeClient) {
  const [path, project] = await Promise.all([client.path.get(), projectApi(client).current()]);
  const current = requireData(project.data, 'current project request');
  return { currentProjectPath: current.worktree, serverRootPath: requireData(path.data, 'path request').directory, project: current };
}
export async function resolveProjectLocation(client: OpencodeClient) {
  return requireData((await projectApi(client).current()).data, 'current project request');
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

export const TRANSCRIPT_PAGE_LIMIT = 20;

export type SessionMessagePage = {
  records: SessionMessageRecord[];
  hasMore: boolean;
  nextBefore?: string;
};

// A single backwards page of transcript. The server returns the newest page
// first and pages toward older records through an opaque cursor (V1 exposes it
// as `x-next-cursor`).
// Callers request the newest page with no `before`, then page back with the
// returned `nextBefore` while scrolling up.
export async function getSessionMessages(
  client: OpencodeClient,
  sessionId: string,
  options: { limit?: number; before?: string; fresh?: boolean } = {},
): Promise<SessionMessagePage> {
  const limit = options.limit ?? TRANSCRIPT_PAGE_LIMIT;
  const before = options.before;
  const read = () => fetchSessionMessagePage(client, sessionId, limit, before);
  if (options.fresh) return read();
  return coalesceRead(client, `messages:${sessionId}:${before ?? 'newest'}:${limit}`, read);
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
    const source = messages ?? (await getSessionMessages(client, sessionId, { limit: TRANSCRIPT_PAGE_LIMIT })).records;
    const latestUserMessage = source.slice().reverse().find(({ info }) => info.role === 'user');
    if (!latestUserMessage) {
      return [];
    }
    targetMessageId = latestUserMessage.info.id;
  }

  const messageID = targetMessageId;
  return coalesceRead(client, `diff:${sessionId}:${messageID}`, async () => {
    const response = await client.session.diff({ sessionID: sessionId, messageID });
    // V1 serves whole-file `before`/`after` contents, not a unified patch.
    return toFileDiffs(requireData(response.data, 'message diff request'));
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

export async function forkSession(client: OpencodeClient, sessionId: string, messageId?: string) {
  return (await client.session.fork({ sessionID: sessionId, messageID: messageId })).data;
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
