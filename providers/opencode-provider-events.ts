import type { OpencodeEvent } from '@/lib/opencode/events';
import { dispatchCompatibilityEvent } from '@/lib/opencode/compat/v1/events';
import { getEventSessionStatus } from '@/lib/opencode/events';
import { formToQuestion, mapPermission } from '@/lib/opencode/v2/mappers';
import { stringField } from '@/lib/opencode/v2/fields';
import type { V2Form, V2Permission } from '@/lib/opencode/v2/shared';
import type { Dispatch, SetStateAction } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest } from '@/lib/opencode/client';
import type { FileDiff, SessionStatus, Todo } from '@/lib/opencode/types';

export type SessionRefreshOptions = {
  messages?: boolean;
  fullMessages?: boolean;
  diff?: boolean;
  todos?: boolean;
  sessions?: boolean;
  delayMs?: number;
};

export type ProviderEventActions = {
  refreshSessions: (silent?: boolean) => Promise<unknown>;
  refreshArchivedSessions: () => Promise<unknown>;
  scheduleSessionRefresh: (sessionId: string, options?: SessionRefreshOptions) => void;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshServerFeatures: () => Promise<unknown>;
  refreshChatCapabilities: () => Promise<unknown>;
  refreshProjectCatalog: (silent?: boolean) => Promise<unknown>;
  refreshTerminals: () => Promise<unknown>;
  refreshWorktrees: () => Promise<unknown>;
  refreshMcpServers: () => Promise<unknown>;
  refreshDiagnostics: () => Promise<unknown>;
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  setPromptError: Dispatch<SetStateAction<{ message: string; occurredAt: number; sessionId?: string } | undefined>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>;
  setMcpAuthPrompt: Dispatch<SetStateAction<{ mcpName: string; url: string } | undefined>>;
  selectedDiffMessageBySessionRef: { current: Record<string, string | undefined> };
};

export function handleProviderEvent(event: OpencodeEvent, actions: ProviderEventActions): void {
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
  if (/^session\.(created|renamed|moved|forked|deleted|permissions|viewed|agent\.selected|model\.selected|metadata\.updated|instructions\.updated)$/.test(type)) {
    void actions.refreshSessions(true).catch(() => undefined);
    return;
  }
  if (/^session\.(compaction\.|revert\.)/.test(type)) {
    if (sessionID) actions.scheduleSessionRefresh(sessionID, { sessions: true, messages: true, fullMessages: true, diff: true, todos: true });
    return;
  }
  if (/^session\.(step\.|text\.|reasoning\.|tool\.|message\.|inbox\.|synthetic|skill\.|usage\.)/.test(type)) {
    if (sessionID) actions.scheduleSessionRefresh(sessionID, { messages: true });
    return;
  }
  if (type === 'permission.asked') {
    const request = mapPermission(data as V2Permission);
    actions.setPendingPermissionsBySession((current) => ({ ...current, [request.sessionID]: [...(current[request.sessionID] ?? []).filter((item) => item.id !== request.id), request] }));
    void actions.refreshSessions(true).catch(() => undefined);
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
    void actions.refreshSessions(true).catch(() => undefined);
    return;
  }
  if (type === 'form.replied' || type === 'form.cancelled') {
    // Global MCP forms may omit a session id on settlement.
    actions.setPendingQuestionsBySession((current) => Object.fromEntries(Object.entries(current).map(([id, questions]) => [id, questions.filter((item) => item.id !== data.id)])));
    return;
  }
  if (/^(server\.connected|config\.|provider\.|model\.|agent\.|skill\.|command\.|integration\.|credential\.|models-dev\.|reference\.|plugin\.)/.test(type)) {
    void actions.refreshChatCapabilities().catch(() => undefined);
  }
  if (type.startsWith('project.')) void actions.refreshProjectCatalog(true).catch(() => undefined);
  if (type === 'filesystem.changed' || type.startsWith('vcs.')) void actions.refreshServerFeatures().catch(() => undefined);
  if (type.startsWith('pty.')) void actions.refreshTerminals().catch(() => undefined);
  if (type.startsWith('worktree.')) { void actions.refreshWorktrees().catch(() => undefined); void actions.refreshProjectCatalog(true).catch(() => undefined); }
  if (type.startsWith('mcp.')) void actions.refreshMcpServers().catch(() => undefined);
  if (type.startsWith('lsp.')) void actions.refreshDiagnostics().catch(() => undefined);
}
