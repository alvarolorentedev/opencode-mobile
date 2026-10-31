import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { listPendingPermissions, listPendingQuestions } from '@/shared/protocol/opencode/client/interactions';
import { createSessionAdapter, LATEST_MESSAGE_LIMIT, type PromptInput, type ResolvedProjectLocation, type SessionMessagePage } from '@/shared/protocol/opencode/contracts/session-adapter';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { coalesceRead } from '@/shared/protocol/opencode/in-flight';
import type { Project, Session, SessionStatus } from '@/shared/protocol/opencode/types';

export { LATEST_MESSAGE_LIMIT, MAX_MESSAGE_PAGE_LIMIT, TRANSCRIPT_PAGE_LIMIT } from '@/shared/protocol/opencode/contracts/session-adapter';
export type { ResolvedProjectLocation, SessionMessagePage } from '@/shared/protocol/opencode/contracts/session-adapter';

export function submitLegacyPrompt(client: ScopedOpencodeClient, input: PromptInput) {
  return createSessionAdapter(client).submitPrompt(input);
}

export function getSessionInbox(client: ScopedOpencodeClient, sessionId: string) {
  return coalesceRead(client, `inbox:${sessionId}`, () => client.promptInbox!.list(sessionId));
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
      getSessionMessages(client, sessionID, { limit: LATEST_MESSAGE_LIMIT }),
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
export function executeCommand(client: ScopedOpencodeClient, sessionId: string, command: string, args: string, options?: { agent?: string; model?: string; variant?: string; messageId?: string }) {
  return createSessionAdapter(client).executeCommand(sessionId, command, args, options);
}
export function executeShell(client: ScopedOpencodeClient, sessionId: string, command: string) {
  return createSessionAdapter(client).executeShell(sessionId, command);
}

export function listServerProjects(client: ScopedOpencodeClient) { return createSessionAdapter(client).catalogProjects(); }
export function readCatalogLocation(client: ScopedOpencodeClient) { return createSessionAdapter(client).catalogLocation(); }
export function combineProjectCatalog(client: ScopedOpencodeClient, projects: Project[], location: Awaited<ReturnType<typeof readCatalogLocation>>) {
  return createSessionAdapter(client).combineCatalog(projects, location);
}
