import type { OpencodeEvent } from '@/lib/opencode/events';
import { dispatchCompatibilityEvent } from '@/lib/opencode/compat/v1/events';
import { getEventSessionStatus } from '@/lib/opencode/events';
import { formToQuestion, mapPermission } from '@/lib/opencode/v2/mappers';
import { stringField } from '@/lib/opencode/v2/fields';
import type { V2Form, V2Permission } from '@/lib/opencode/v2/shared';
import type { Dispatch, SetStateAction } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest } from '@/lib/opencode/client';
import type { FileDiff, Session, SessionStatus, Todo } from '@/lib/opencode/types';
import type { TranscriptRefreshMode } from '@/providers/opencode-provider-types';

export type SessionRefreshOptions = {
  messages?: boolean;
  // Overrides how a scheduled message refresh treats the held window. Only
  // server-side history rewrites (compaction/revert) pass 'replace'.
  messageMode?: TranscriptRefreshMode;
  diff?: boolean;
  todos?: boolean;
  sessions?: boolean;
  delayMs?: number;
};

export type ProviderEventActions = {
  refreshSessions: (silent?: boolean) => Promise<unknown>;
  refreshArchivedSessions: () => Promise<unknown>;
  scheduleSessionRefresh: (sessionId: string, options?: SessionRefreshOptions) => void;
  // Event-driven refreshes are coalesced when the provider supplies these;
  // direct user actions keep using the immediate variants.
  scheduleSessionsRefresh?: () => void;
  scheduleServerFeaturesRefresh?: () => void;
  scheduleChatCapabilitiesRefresh?: () => void;
  scheduleProjectCatalogRefresh?: () => void;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshServerFeatures: () => Promise<unknown>;
  refreshChatCapabilities: () => Promise<unknown>;
  refreshProjectCatalog: (silent?: boolean) => Promise<unknown>;
  refreshTerminals: () => Promise<unknown>;
  refreshWorktrees: () => Promise<unknown>;
  refreshMcpServers: () => Promise<unknown>;
  refreshDiagnostics: () => Promise<unknown>;
  // Session ids whose transcript the user can currently see (active chat and
  // conversation mode). Part-level events refresh only these, so background
  // sessions are not re-downloaded on every streaming update.
  focusSessionIds?: Set<string>;
  setSessions?: Dispatch<SetStateAction<Session[]>>;
  removeCatalogSession?: (sessionId: string) => void;
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  explicitSessionSelectionRef?: { current: string | undefined };
  setPromptError: Dispatch<SetStateAction<{ message: string; occurredAt: number; sessionId?: string } | undefined>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>;
  setMcpAuthPrompt: Dispatch<SetStateAction<{ mcpName: string; url: string } | undefined>>;
  selectedDiffMessageBySessionRef: { current: Record<string, string | undefined> };
};

export function handleProviderEvent(event: OpencodeEvent, actions: ProviderEventActions): void {
  const scheduleSessions = actions.scheduleSessionsRefresh ?? (() => { void actions.refreshSessions(true).catch(() => undefined); });
  const scheduleCapabilities = actions.scheduleChatCapabilitiesRefresh ?? (() => { void actions.refreshChatCapabilities().catch(() => undefined); });
  const scheduleFeatures = actions.scheduleServerFeaturesRefresh ?? (() => { void actions.refreshServerFeatures().catch(() => undefined); });
  const scheduleCatalog = actions.scheduleProjectCatalogRefresh ?? (() => { void actions.refreshProjectCatalog(true).catch(() => undefined); });
  if (event.type === 'compatibility') { dispatchCompatibilityEvent(event.payload, actions); return; }
  const data = 'data' in event ? event.data as Record<string, unknown> : {};
  const sessionID = stringField(data.sessionID);
  const type: string = event.type;
  const status = getEventSessionStatus(event);
  if (status) {
    actions.setSessionStatuses((current) => ({ ...current, [status.sessionID]: status.status }));
    actions.scheduleSessionRefresh(status.sessionID, { sessions: true, messages: true, diff: true, todos: true, delayMs: status.status.type === 'idle' ? 50 : undefined });
    if (status.status.type === 'idle') { void actions.refreshPendingInteractions().catch(() => undefined); void actions.refreshServerFeatures().catch(() => undefined); }
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
      if (actions.explicitSessionSelectionRef?.current === sessionID) {
        actions.explicitSessionSelectionRef.current = undefined;
      }
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
    if (sessionID) actions.scheduleSessionRefresh(sessionID, { messages: true });
    return;
  }
  if (/^session\.(step\.|text\.|reasoning\.|tool\.|message\.|synthetic|skill\.|usage\.)/.test(type)) {
    // Streaming updates only re-read the transcript the user can actually see.
    // Background sessions refresh on status transitions and completion instead
    // of once per part.
    if (sessionID && (!actions.focusSessionIds || actions.focusSessionIds.has(sessionID))) {
      actions.scheduleSessionRefresh(sessionID, { messages: true });
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
  if (/^(server\.connected|config\.|provider\.|model\.|agent\.|skill\.|command\.|integration\.|credential\.|models-dev\.|reference\.|plugin\.)/.test(type)) {
    scheduleCapabilities();
  }
  if (type.startsWith('project.')) scheduleCatalog();
  if (type === 'filesystem.changed' || type.startsWith('vcs.')) scheduleFeatures();
  if (type.startsWith('pty.')) void actions.refreshTerminals().catch(() => undefined);
  if (type.startsWith('worktree.')) { void actions.refreshWorktrees().catch(() => undefined); void actions.refreshProjectCatalog(true).catch(() => undefined); }
  if (type.startsWith('mcp.')) void actions.refreshMcpServers().catch(() => undefined);
  if (type.startsWith('lsp.')) void actions.refreshDiagnostics().catch(() => undefined);
}
