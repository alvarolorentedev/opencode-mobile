import type { SessionInfo } from '@opencode/client';

import { compareLabels } from '@/lib/compare-labels';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { toFileDiffs } from '@/lib/opencode/diff';
import { listPendingPermissions, listPendingQuestions } from '@/lib/opencode/client/interactions';
import type { NativeOpencodeApi } from '@/lib/opencode/client/types';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import { coalesceRead } from '@/lib/opencode/in-flight';
import { toProjectView, toSessionView } from '@/lib/opencode/v2-mappers';
import { toMessageRecord } from '@/lib/opencode/v2/mappers';
import type { SessionStatus } from '@/lib/opencode/types';
import * as v1 from '@/lib/opencode/compat/v1/session';

export function getSessionInbox(client: ScopedOpencodeClient, sessionId: string) {
  return coalesceRead(client, `inbox:${sessionId}`, () => client.promptInbox!.list(sessionId));
}
export async function loadWorkspaceCatalog(client: ScopedOpencodeClient) {
  if (client.compatibility) return v1.loadWorkspaceCatalog(client.compatibility);
  const [location, projects] = await Promise.all([client.api!.location.get(), client.api!.project.list()]);
  if (!location?.project?.id || !location.directory || !Array.isArray(projects)) throw new Error('MalformedResponse: OpenCode did not return its workspace catalog.');
  const current = projects.find((project) => project.id === location.project.id);
  const serverProjects = projects.map(toProjectView).sort((left, right) => compareLabels(left.worktree, right.worktree));
  return { currentProjectPath: location.directory, serverRootPath: location.directory, serverProjects: current ? serverProjects : [...serverProjects, { id: location.project.id, worktree: location.project.canonical, time: { created: 0 } }] };
}
export async function resolveWorkspace(client: ScopedOpencodeClient) {
  if (client.compatibility) return v1.resolveWorkspace(client.compatibility);
  const location = await client.api!.location.get({ location: { directory: client.__opencode.directory } });
  return { id: location.project.id, worktree: location.project.canonical, time: { created: 0 } };
}

// V2 lists sessions through a cursor. Reading only the first page silently
// hides every older chat in a workspace, so the workspace list, the
// connection-wide snapshot and the notification monitor all follow it. V1
// returns the complete array in one response.
const MAX_SESSION_PAGES = 10;

async function listV2Sessions(api: NativeOpencodeApi, directory?: string): Promise<SessionInfo[]> {
  const scope = directory ? { directory } : {};
  const records: SessionInfo[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
    const response = await api.session.list(cursor ? { ...scope, cursor } : scope);
    if (!Array.isArray(response?.data)) throw new Error('MalformedResponse: OpenCode did not return its session list.');
    // Pages can overlap at the cursor; a page that adds nothing also stops a
    // server that ignores the cursor from looping.
    const fresh = response.data.filter((session) => !seen.has(session.id));
    if (fresh.length === 0) break;
    for (const session of fresh) seen.add(session.id);
    records.push(...fresh);
    const next = response.cursor?.next;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return records;
}

export function listSessions(client: ScopedOpencodeClient) {
  return coalesceRead(client, 'sessions', async () => {
    if (client.compatibility) return v1.listSessions(client.compatibility);
    const [records, active] = await Promise.all([
      listV2Sessions(client.api!, client.__opencode.directory),
      client.api!.session.active(),
    ]);
    if (active == null) throw new Error('OpenCode did not return active sessions.');
    const sessions = records.map(toSessionView).filter((session) => !session.time.archived).sort((a, b) => b.time.updated - a.time.updated);
    const statuses: Record<string, SessionStatus> = {};
    for (const session of records) statuses[session.id] = { type: 'idle' };
    for (const id of Object.keys(active)) statuses[id] = { type: 'busy' };
    return { sessions, statuses };
  });
}
export const listActiveSessions = listSessions;
// Native retries and blocking forms are absent from the running-session set.
// Background completion must confirm these before treating an idle list as done.
export async function hasPendingSessionWork(client: ScopedOpencodeClient, sessionID: string) {
  if (!client.api) return false;
  const location = { location: { directory: client.__opencode.directory } };
  const [messages, inbox, permissions, forms] = await Promise.all([
    client.api.message.list({ sessionID, limit: 20, order: 'desc' }),
    client.api.session.inbox.list({ sessionID }),
    client.api.permission.request.list(location),
    client.api.form.list(location),
  ]);
  const latest = messages.data.find((message) => message.type === 'assistant' || message.type === 'idle' || message.type === 'user');
  return inbox.length > 0 || permissions.data.some((request) => request.sessionID === sessionID)
    || forms.data.some((form) => form.sessionID === sessionID || form.sessionID === 'global')
    || (latest?.type === 'assistant' && Boolean(latest.retry));
}

export type SessionSettlementState = 'running' | 'retrying' | 'blocked' | 'failed' | 'aborted' | 'finished' | 'unknown';
export type SessionSettlement = { state: SessionSettlementState; message?: string };

// Pure decision table shared by the live read below and unit tests, so copy and
// clearing rules cannot drift from the observed inputs.
export function classifySessionSettlement(input: {
  status?: SessionStatus;
  queued: boolean;
  blocked: boolean;
  error?: { name: string; data?: { message?: string }; message?: string };
}): SessionSettlement {
  if (input.status && input.status.type !== 'idle') {
    return { state: input.status.type === 'retry' ? 'retrying' : 'running' };
  }
  if (input.queued) return { state: 'running' };
  if (input.blocked) return { state: 'blocked' };
  if (!input.error) return { state: 'finished' };
  if (input.error.name === 'MessageAbortedError') return { state: 'aborted' };
  return { state: 'failed', message: input.error.data?.message || input.error.message };
}

/**
 * One server-verified view of whether a session still needs the user's
 * attention. The foreground completion flush and the background monitor share
 * it so their copy and clearing decisions cannot diverge. Reads are
 * contract-agnostic; v1 has no prompt inbox, so its inbox read is skipped.
 *
 * `knownStatus` lets a caller that just listed sessions avoid a second status
 * read; when omitted, the server's current status is fetched, which is what
 * makes a cold-start completion wait for confirmation instead of trusting a
 * persisted idle status.
 */
export async function readSessionSettlement(
  client: ScopedOpencodeClient,
  sessionID: string,
  knownStatus?: SessionStatus,
): Promise<SessionSettlement> {
  try {
    const status = knownStatus ?? (await listSessions(client)).statuses[sessionID];
    const [inbox, permissions, questions, page] = await Promise.all([
      client.promptInbox ? client.promptInbox.list(sessionID).catch(() => []) : Promise.resolve([]),
      listPendingPermissions(client),
      listPendingQuestions(client),
      getSessionMessages(client, sessionID, { limit: 20 }),
    ]);
    const latest = page.records.filter((record) => record.info.role === 'assistant').at(-1);
    return classifySessionSettlement({
      status,
      queued: Boolean(inbox?.length),
      blocked: Boolean(permissions?.some((request) => request.sessionID === sessionID)
        || questions?.some((question) => question.sessionID === sessionID)),
      error: latest?.info.role === 'assistant' ? latest.info.error : undefined,
    });
  } catch {
    return { state: 'unknown' };
  }
}
export async function listArchivedSessions(client: ScopedOpencodeClient) {
  if (client.compatibility) return v1.listArchivedSessions(client.compatibility);
  return [];
}
export const INITIAL_MESSAGE_LIMIT = 20;
export const HISTORY_PAGE_LIMIT = 20;
export type SessionMessagePage = { records: SessionMessageRecord[]; hasMore: boolean; nextBefore?: string };
export function getSessionMessages(client: ScopedOpencodeClient, sessionId: string, options: { limit?: number; before?: string } = {}): Promise<SessionMessagePage> {
  const { limit = HISTORY_PAGE_LIMIT, before } = options;
  return coalesceRead(client, `messages:${sessionId}:${before ?? 'newest'}:${limit}`, async () => {
    if (client.compatibility) return v1.getSessionMessages(client.compatibility, sessionId, options);
    const page = await client.api!.message.list(before ? { sessionID: sessionId, limit, cursor: before } : { sessionID: sessionId, limit, order: 'desc' });
    const records = [...page.data].reverse().map((message) => toMessageRecord(message, sessionId)).filter((record): record is SessionMessageRecord => Boolean(record));
    const nextBefore = page.cursor.next && page.cursor.next !== before ? page.cursor.next : undefined;
    return { records, hasMore: Boolean(nextBefore), nextBefore };
  });
}
export async function getSessionDiff(client: ScopedOpencodeClient, sessionId: string, messageId?: string, messages?: SessionMessageRecord[]) {
  const target = messageId ?? (messages ?? (await getSessionMessages(client, sessionId)).records).slice().reverse().find((record) => record.info.role === 'user')?.info.id;
  if (!target) return [];
  return coalesceRead(client, `diff:${sessionId}:${target}`, async () =>
    client.compatibility
      ? v1.getSessionDiff(client.compatibility, sessionId, target)
      : toFileDiffs(await client.api!.session.diff({ sessionID: sessionId, from: target })));
}
export async function getSessionTodos(client: ScopedOpencodeClient, sessionId: string) {
  return client.compatibility ? v1.getSessionTodos(client.compatibility, sessionId) : [];
}
export async function createSession(client: ScopedOpencodeClient, title?: string) {
  if (client.compatibility) return (await client.compatibility.session.create(title ? { title } : undefined)).data;
  return toSessionView(await client.api!.session.create({ ...(title ? { title } : {}), ...(client.__opencode.directory ? { location: { directory: client.__opencode.directory } } : {}) }));
}
export async function deleteSession(client: ScopedOpencodeClient, sessionId: string) {
  return client.compatibility ? v1.deleteSession(client.compatibility, sessionId) : client.api!.session.remove({ sessionID: sessionId });
}
export async function updateSessionTitle(client: ScopedOpencodeClient, sessionId: string, title: string) {
  if (client.compatibility) return v1.updateSessionTitle(client.compatibility, sessionId, title);
  await client.api!.session.update({ sessionID: sessionId, title });
  return toSessionView(await client.api!.session.get({ sessionID: sessionId }));
}
function requireCompatibility(client: ScopedOpencodeClient) {
  if (!client.compatibility) throw new Error('This operation is not supported by OpenCode 2.');
  return client.compatibility;
}
export const archiveSession = (client: ScopedOpencodeClient, sessionId: string) => v1.archiveSession(requireCompatibility(client), sessionId);
export const restoreSession = (client: ScopedOpencodeClient, sessionId: string) => v1.restoreSession(requireCompatibility(client), sessionId);
export const shareSession = (client: ScopedOpencodeClient, sessionId: string) => v1.shareSession(requireCompatibility(client), sessionId);
export const unshareSession = (client: ScopedOpencodeClient, sessionId: string) => v1.unshareSession(requireCompatibility(client), sessionId);
export async function forkSession(client: ScopedOpencodeClient, sessionId: string, messageId?: string) {
  return client.compatibility ? v1.forkSession(client.compatibility, sessionId, messageId) : toSessionView(await client.api!.session.fork({ sessionID: sessionId, ...(messageId ? { before: messageId } : {}) }));
}
export async function revertSession(client: ScopedOpencodeClient, sessionId: string, messageId: string, partId?: string) {
  if (client.compatibility) return v1.revertSession(client.compatibility, sessionId, messageId, partId);
  return client.api!.session.revert.stage({ sessionID: sessionId, messageID: messageId, ...(partId ? { partID: partId } : {}) });
}
export async function unrevertSession(client: ScopedOpencodeClient, sessionId: string) {
  return client.compatibility ? v1.unrevertSession(client.compatibility, sessionId) : client.api!.session.revert.clear({ sessionID: sessionId });
}
export async function interruptSession(client: ScopedOpencodeClient, sessionID: string) {
  return client.compatibility ? client.compatibility.session.abort({ sessionID }) : client.api!.session.interrupt({ sessionID });
}
export async function summarizeSession(client: ScopedOpencodeClient, input: { sessionID: string; providerID: string; modelID: string }) {
  return requireCompatibility(client).session.summarize(input);
}
export async function listCommands(client: ScopedOpencodeClient) {
  return client.compatibility ? v1.listCommands(client.compatibility) : (await client.api!.command.list({ location: { directory: client.__opencode.directory } })).data;
}
export async function executeCommand(client: ScopedOpencodeClient, sessionId: string, command: string, args: string, options?: { agent?: string; model?: string; messageId?: string }) {
  if (client.compatibility) return v1.executeCommand(client.compatibility, sessionId, command, args, options);
  if (options?.agent) await client.api!.session.switchAgent({ sessionID: sessionId, agent: options.agent });
  if (options?.model) { const [providerID, ...id] = options.model.split('/'); await client.api!.session.switchModel({ sessionID: sessionId, model: { providerID, id: id.join('/') } }); }
  await client.api!.session.command({ sessionID: sessionId, name: command, text: args });
}
