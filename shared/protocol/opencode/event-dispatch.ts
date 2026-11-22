import { dispatchCompatibilityEvent } from '@/shared/protocol/opencode/compat/v1/events';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import { getEventSessionStatus } from '@/shared/protocol/opencode/events';
import { stringField } from '@/shared/protocol/opencode/v2/fields';
import { formToQuestion, mapPermission } from '@/shared/protocol/opencode/v2/mappers';
import type { V2Form, V2Permission } from '@/shared/protocol/opencode/v2/shared';

import type { PendingPermissionRequest, PendingQuestionRequest } from '@/shared/protocol/opencode/client';
import type { FileDiff, Session, SessionStatus, Todo } from '@/shared/protocol/opencode/types';
import type { TranscriptRefreshMode } from '@/shared/contracts/domain';

export type SessionRefreshOptions = {
  messages?: boolean;
  // Reconcile one assistant message instead of the newest page. Live V2 turns
  // use this so the sent prompt and its attachment bytes are not re-read.
  messageId?: string;
  // Refresh only the server inbox for this session; do not read the transcript.
  inboxOnly?: boolean;
  // An inbox delivery: paint the delivered prompt from its local pending data
  // instead of downloading the stored message.
  delivered?: boolean;
  inboxID?: string;
  // Overrides how a scheduled message refresh treats the held window. Only
  // server-side history rewrites (compaction/revert) pass 'replace'.
  messageMode?: TranscriptRefreshMode;
  diff?: boolean;
  todos?: boolean;
  sessions?: boolean;
  delayMs?: number;
};

type Write<T> = (value: T | ((current: T) => T)) => void;

export type ProviderEventActions = {
  refreshSessions: () => Promise<unknown>;
  scheduleSessionRefresh: (sessionId: string, options?: SessionRefreshOptions) => void;
  scheduleSessionsRefresh?: () => void;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshTerminals: () => Promise<unknown>;
  // Applies a live V2 stream event to the open transcript. Returning true means
  // the event was consumed and no transcript read is needed.
  applyTranscriptEvent?: (event: OpencodeEvent) => boolean;
  // The assistant message a live turn is currently writing, if any.
  liveTranscriptMessageId?: (sessionId: string) => string | undefined;
  // The session whose prompt this client is submitting right now.
  sendingSessionId?: string;
  // True while a prompt this client admitted should still count as local. The
  // server can emit execution.started after the admission response, so the
  // in-flight send alone is not enough to suppress a redundant page read.
  isLocalSendRecent?: (sessionId: string) => boolean;
  // Session ids whose transcript the user can currently see (active chat and
  // conversation mode). Part-level events refresh only these, so background
  // sessions are not re-downloaded on every streaming update.
  focusSessionIds?: Set<string>;
  // Transcript actually visible on screen. Background sessions keep only their
  // status row until they are opened, so their attachment bytes are not fetched.
  transcriptSessionIds?: Set<string>;
  setSessions?: Write<Session[]>;
  removeCatalogSession?: (sessionId: string) => void;
  setSessionStatuses: Write<Record<string, SessionStatus>>;
  clearExplicitSelection?: (sessionId: string) => void;
  setPromptError: Write<{ message: string; occurredAt: number; sessionId?: string } | undefined>;
  setDiffsBySession: Write<Record<string, FileDiff[]>>;
  setTodosBySession: Write<Record<string, Todo[]>>;
  setPendingPermissionsBySession: Write<Record<string, PendingPermissionRequest[]>>;
  setPendingQuestionsBySession: Write<Record<string, PendingQuestionRequest[]>>;
  setMcpAuthPrompt: Write<{ mcpName: string; url: string } | undefined>;
  readPinnedDiffMessage: (sessionId: string) => string | undefined;
};

export function handleProviderEvent(event: OpencodeEvent, actions: ProviderEventActions): void {
  const scheduleSessions = actions.scheduleSessionsRefresh ?? (() => { void actions.refreshSessions().catch(() => undefined); });
  if (event.type === 'compatibility') { dispatchCompatibilityEvent(event.payload, actions); return; }
  const data = 'data' in event ? event.data as Record<string, unknown> : {};
  const sessionID = stringField(data.sessionID);
  const type: string = event.type;
  const status = getEventSessionStatus(event);
  if (status) {
    actions.setSessionStatuses((current) => ({ ...current, [status.sessionID]: status.status }));
    const visible = !(actions.transcriptSessionIds ?? actions.focusSessionIds)
      || (actions.transcriptSessionIds ?? actions.focusSessionIds)!.has(status.sessionID);
    const idle = status.status.type === 'idle';
    // A V2 live turn paints its assistant message from stream events. Only a
    // completed, visible turn reconciles against the server, and then only that
    // message. The exception is a turn this client did not submit (another
    // client or a queued delivery), where the new prompt still has to be fetched.
    const remoteStart = visible && !idle && event.type === 'session.execution.started'
      && actions.sendingSessionId !== status.sessionID
      && !actions.isLocalSendRecent?.(status.sessionID);
    const messageId = idle && visible ? actions.liveTranscriptMessageId?.(status.sessionID) : undefined;
    actions.scheduleSessionRefresh(status.sessionID, {
      sessions: true,
      ...(visible && (idle || remoteStart) ? { messages: true } : {}),
      ...(messageId ? { messageId } : {}),
      ...(visible ? { todos: true } : {}),
      ...(idle && visible ? { diff: true } : {}),
      delayMs: idle ? 50 : undefined,
    });
    if (idle) { void actions.refreshPendingInteractions().catch(() => undefined); }
    return;
  }
  if (type === 'command.executed') { actions.scheduleSessionRefresh(sessionID, { sessions: true, messages: true }); return; }
  if (type === 'session.deleted') {
    if (sessionID) {
      // Remove the row immediately so a deleted session cannot be reopened from
      // a favorite or stale selection before the coalesced list refresh lands.
      actions.setSessions?.((current) => current.filter((session) => session.id !== sessionID));
      actions.removeCatalogSession?.(sessionID);
      actions.setSessionStatuses((current) => {
        const next = { ...current };
        delete next[sessionID];
        return next;
      });
      actions.clearExplicitSelection?.(sessionID);
    }
    scheduleSessions();
    return;
  }
  if (/^session\.(created|renamed|moved|forked|permissions|viewed|agent\.selected|model\.selected|metadata\.updated|instructions\.updated)$/.test(type)) {
    scheduleSessions();
    return;
  }
  if (/^session\.(compaction\.|revert\.)/.test(type)) {
    if (sessionID) actions.scheduleSessionRefresh(sessionID, { sessions: true, messages: true, messageMode: 'replace', diff: true, todos: true });
    return;
  }
  if (/^session\.inbox\./.test(type)) {
    // Inbox transitions are infrequent and are how the app discovers prompts
    // queued remotely, so always re-read them, even for background sessions.
    // The transcript is not re-read: a delivery is painted from the pending
    // prompt it just admitted.
    if (sessionID) {
      const inboxID = stringField(data.inboxID);
      actions.scheduleSessionRefresh(sessionID, {
        inboxOnly: true,
        ...(type === 'session.inbox.delivered' ? { delivered: true } : {}),
        ...(inboxID ? { inboxID } : {}),
      });
    }
    return;
  }
  if (/^session\.(step\.|text\.|reasoning\.|tool\.|message\.|synthetic|skill\.|shell\.|usage\.)/.test(type)) {
    // Streaming updates only paint the transcript the user can actually see.
    // Background sessions keep a status row until they are opened. Live events
    // that cannot be applied (synthetic rows, shell records) fall back to a
    // single page read.
    const visible = actions.transcriptSessionIds ?? actions.focusSessionIds;
    if (sessionID && (!visible || visible.has(sessionID))) {
      if (!actions.applyTranscriptEvent?.(event)) actions.scheduleSessionRefresh(sessionID, { messages: true });
    }
    return;
  }
  if (type === 'permission.asked') {
    const request = mapPermission(data as V2Permission);
    actions.setPendingPermissionsBySession((current) => ({ ...current, [request.sessionID]: [...(current[request.sessionID] ?? []).filter((item) => item.id !== request.id), request] }));
    scheduleSessions();
    return;
  }
  if (type === 'permission.replied') {
    actions.setPendingPermissionsBySession((current) => ({ ...current, [sessionID]: (current[sessionID] ?? []).filter((item) => item.id !== data.requestID) }));
    return;
  }
  if (type === 'form.created') {
    const form = data.form as V2Form | undefined;
    if (!form?.id) return;
    const request = formToQuestion(form);
    actions.setPendingQuestionsBySession((current) => ({ ...current, [request.sessionID]: [...(current[request.sessionID] ?? []).filter((item) => item.id !== request.id), request] }));
    scheduleSessions();
    return;
  }
  if (type === 'form.replied' || type === 'form.cancelled') {
    // Global MCP forms may omit a session id on settlement.
    actions.setPendingQuestionsBySession((current) => Object.fromEntries(Object.entries(current).map(([id, questions]) => [id, questions.filter((item) => item.id !== data.id)])));
    return;
  }
  if (type.startsWith('pty.')) void actions.refreshTerminals().catch(() => undefined);
}
