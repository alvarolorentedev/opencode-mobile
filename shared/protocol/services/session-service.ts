import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { listPendingPermissions, listPendingQuestions } from '@/shared/protocol/opencode/client/interactions';
import { createSessionAdapter, LATEST_MESSAGE_LIMIT, type PromptInput, type ResolvedProjectLocation, type SessionMessagePage } from '@/shared/protocol/opencode/contracts/session-adapter';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { coalesceRead } from '@/shared/protocol/opencode/in-flight';
import type { Project, Session, SessionStatus } from '@/shared/protocol/opencode/types';
import { toSessionView } from '@/shared/protocol/opencode/v2-mappers';

export { LATEST_MESSAGE_LIMIT, MAX_MESSAGE_PAGE_LIMIT, TRANSCRIPT_PAGE_LIMIT } from '@/shared/protocol/opencode/contracts/session-adapter';
export type { ResolvedProjectLocation, SessionMessagePage } from '@/shared/protocol/opencode/contracts/session-adapter';

export function submitLegacyPrompt(client: ScopedOpencodeClient, input: PromptInput) {
  return createSessionAdapter(client).submitPrompt(input);
}

export function getSessionInbox(client: ScopedOpencodeClient, sessionId: string) {
  return coalesceRead(client, `inbox:${sessionId}`, () => client.promptInbox!.list(sessionId));
}
export function getSessionNotices(client: ScopedOpencodeClient, sessionId: string) {
  if (!client.promptInbox?.listNotices) return Promise.resolve([]);
  return coalesceRead(client, `inbox-notices:${sessionId}`, () => client.promptInbox!.listNotices(sessionId));
}
export function resolveProjectLocation(client: ScopedOpencodeClient): Promise<ResolvedProjectLocation> {
  return createSessionAdapter(client).resolveProjectLocation();
}
export function isKnownProjectLocation(client: ScopedOpencodeClient): Promise<boolean> {
  return createSessionAdapter(client).isKnownProjectLocation();
}
export function isAvailableProjectDirectory(client: ScopedOpencodeClient, knownProjects: Project[]): Promise<boolean> {
  return createSessionAdapter(client).isAvailableProjectDirectory(knownProjects);
}
export function getActiveSessionStatuses(client: ScopedOpencodeClient) {
  return createSessionAdapter(client).activeStatuses();
}
export function listSessions(client: ScopedOpencodeClient) {
  return createSessionAdapter(client).list();
}
export const listActiveSessions = listSessions;

export async function listV2RunningSessionIds(client: ScopedOpencodeClient) {
  const active = await client.api!.session.active();
  if (!active || typeof active !== 'object' || Array.isArray(active)) throw new Error('Active sessions are unavailable.');
  return Object.keys(active).filter((id) => active[id]?.type === 'running');
}

export async function getV2SessionSummary(client: ScopedOpencodeClient, sessionID: string, signal?: AbortSignal) {
  return toSessionView(await client.api!.session.get({ sessionID }, { signal }));
}

export async function findSessionForNavigation(client: ScopedOpencodeClient, sessionID: string, signal: AbortSignal) {
  if (client.api) return getV2SessionSummary(client, sessionID, signal);
  return (await listSessions(client)).sessions.find((session) => session.id === sessionID);
}

export type SessionSettlementState = 'running' | 'retrying' | 'blocked' | 'failed' | 'aborted' | 'finished' | 'unknown';
export type SessionSettlement = { state: SessionSettlementState; message?: string };

// A response created slightly before the recorded request can still be this
// turn's answer when the server clock trails the device clock by a little.
const RESPONSE_CLOCK_TOLERANCE_MS = 2_000;

// Pure decision table shared by the live read below and unit tests, so copy and
// clearing rules cannot drift from the observed inputs.
export function classifySessionSettlement(input: {
  status?: SessionStatus;
  queued: boolean;
  blocked: boolean;
  // Newest assistant record and the submit time it must follow. When the
  // caller ties the read to a request, an idle session whose request has no
  // response yet is still starting, not finished.
  latestAssistant?: { created: number; error?: { name: string; data?: { message?: string }; message?: string } };
  notBefore?: number;
}): SessionSettlement {
  if (input.status && input.status.type !== 'idle') {
    return { state: input.status.type === 'retry' ? 'retrying' : 'running' };
  }
  if (input.queued) return { state: 'running' };
  if (input.blocked) return { state: 'blocked' };
  if (input.notBefore !== undefined
    && (!input.latestAssistant || input.latestAssistant.created < input.notBefore - RESPONSE_CLOCK_TOLERANCE_MS)) {
    return { state: 'unknown' };
  }
  const error = input.latestAssistant?.error;
  if (!error) return { state: 'finished' };
  if (error.name === 'MessageAbortedError') return { state: 'aborted' };
  return { state: 'failed', message: error.data?.message || error.message };
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
 *
 * `notBefore` is the pending record's request time. With it, an idle session
 * only settles once an assistant response exists for that request; otherwise
 * a prompt that has been accepted but has not started yet (or was never
 * delivered) would notify as finished.
 */
export async function readSessionSettlement(
  client: ScopedOpencodeClient,
  sessionID: string,
  knownStatus?: SessionStatus,
  notBefore?: number,
): Promise<SessionSettlement> {
  try {
    const status = knownStatus ?? (await listSessions(client)).statuses[sessionID];
    const [inbox, permissions, questions, page] = await Promise.all([
      client.promptInbox ? client.promptInbox.list(sessionID).catch(() => []) : Promise.resolve([]),
      listPendingPermissions(client),
      listPendingQuestions(client),
      getSessionMessages(client, sessionID, { limit: LATEST_MESSAGE_LIMIT }),
    ]);
    const latest = page.records.filter((record) => record.info.role === 'assistant').at(-1);
    return classifySessionSettlement({
      status,
      queued: Boolean(inbox?.length),
      blocked: Boolean(permissions?.some((request) => request.sessionID === sessionID)
        || questions?.some((question) => question.sessionID === sessionID)),
      latestAssistant: latest?.info.role === 'assistant'
        ? { created: latest.info.time.created, error: latest.info.error }
        : undefined,
      notBefore,
    });
  } catch {
    return { state: 'unknown' };
  }
}

export function getSessionMessages(client: ScopedOpencodeClient, sessionId: string, options: { limit?: number; before?: string; fresh?: boolean } = {}): Promise<SessionMessagePage> {
  return createSessionAdapter(client).messages(sessionId, options);
}
export function getSessionDiff(client: ScopedOpencodeClient, sessionId: string, messageId?: string, messages?: SessionMessageRecord[]) {
  return createSessionAdapter(client).diff(sessionId, messageId, messages);
}
export function getSessionTodos(client: ScopedOpencodeClient, sessionId: string) {
  return createSessionAdapter(client).todos(sessionId);
}
export function createSession(client: ScopedOpencodeClient, title?: string): Promise<Session> {
  return createSessionAdapter(client).create(title);
}
export function deleteSession(client: ScopedOpencodeClient, sessionId: string) {
  return createSessionAdapter(client).remove(sessionId);
}
export function updateSessionTitle(client: ScopedOpencodeClient, sessionId: string, title: string) {
  return createSessionAdapter(client).updateTitle(sessionId, title);
}
export function forkSession(client: ScopedOpencodeClient, sessionId: string, messageId?: string): Promise<Session> {
  return createSessionAdapter(client).fork(sessionId, messageId);
}
export function revertSession(client: ScopedOpencodeClient, sessionId: string, messageId: string, partId?: string) {
  return createSessionAdapter(client).revert(sessionId, messageId, partId);
}
export function unrevertSession(client: ScopedOpencodeClient, sessionId: string) {
  return createSessionAdapter(client).unrevert(sessionId);
}
export function interruptSession(client: ScopedOpencodeClient, sessionID: string) {
  return createSessionAdapter(client).interrupt(sessionID);
}
export function waitForSessionIdle(client: ScopedOpencodeClient, sessionID: string) {
  return createSessionAdapter(client).waitForIdle(sessionID);
}
export function listCommands(client: ScopedOpencodeClient) {
  return createSessionAdapter(client).commands();
}
export function executeCommand(client: ScopedOpencodeClient, sessionId: string, command: string, args: string, options?: import('@/shared/protocol/opencode/prompt-inbox').CommandOptions) {
  return createSessionAdapter(client).executeCommand(sessionId, command, args, options);
}
export function executeShell(client: ScopedOpencodeClient, sessionId: string, command: string) {
  return createSessionAdapter(client).executeShell(sessionId, command);
}
export function compactSession(client: ScopedOpencodeClient, sessionId: string) {
  return createSessionAdapter(client).compact(sessionId);
}
export function generateSessionText(client: ScopedOpencodeClient, sessionId: string, prompt: string) {
  return createSessionAdapter(client).generate(sessionId, prompt);
}

export function listServerProjects(client: ScopedOpencodeClient) { return createSessionAdapter(client).catalogProjects(); }
export function listArchivedServerProjects(client: ScopedOpencodeClient) { return createSessionAdapter(client).catalogProjects({ archived: true }); }
export function readCatalogLocation(client: ScopedOpencodeClient) { return createSessionAdapter(client).catalogLocation(); }
export function combineProjectCatalog(client: ScopedOpencodeClient, projects: Project[], location: Awaited<ReturnType<typeof readCatalogLocation>>) {
  return createSessionAdapter(client).combineCatalog(projects, location);
}
