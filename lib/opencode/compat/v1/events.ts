import type { GlobalEvent } from '@opencode-ai/sdk/v2/client';
import type { OpencodeEvent } from '../../events';
import { toFileDiffs } from '../../diff';
import type { ProviderEventActions, SessionRefreshOptions } from '@/providers/opencode-provider-events';

// Streaming part updates only re-read a transcript the user can see. Background
// sessions refresh on status/completion events instead of once per part.
function scheduleVisibleRefresh(actions: ProviderEventActions, sessionId: string, options: SessionRefreshOptions) {
  if (!sessionId) return;
  if (actions.focusSessionIds && !actions.focusSessionIds.has(sessionId)) return;
  actions.scheduleSessionRefresh(sessionId, options);
}

export function dispatchCompatibilityEvent(event: GlobalEvent['payload'], actions: ProviderEventActions): void {
  switch (event.type) {
    case 'session.created':
    case 'session.updated':
    case 'session.deleted':
      void actions.refreshSessions(true).catch(() => undefined);
      void actions.refreshArchivedSessions().catch(() => undefined);
      return;
    case 'session.status': {
      const sessionId = event.properties.sessionID;
      actions.setSessionStatuses((current) => ({
        ...current,
        [sessionId]: event.properties.status,
      }));
      actions.scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true });
      return;
    }
    case 'session.idle': {
      const sessionId = event.properties.sessionID;
      actions.setSessionStatuses((current) => ({
        ...current,
        [sessionId]: { type: 'idle' },
      }));
      actions.scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true, delayMs: 50 });
      void actions.refreshPendingInteractions().catch(() => undefined);
      void actions.refreshServerFeatures().catch(() => undefined);
      return;
    }
    case 'session.error': {
      const sessionId = event.properties.sessionID;
      const error = event.properties.error;
      const message = error && 'data' in error && error.data && 'message' in error.data
        ? error.data.message
        : error && 'message' in error
          ? error.message
          : 'OpenCode could not complete the request.';
      actions.setPromptError({
        message: error?.name ? `${error.name}: ${message}` : String(message),
        occurredAt: Date.now(),
        sessionId,
      });
      if (sessionId) {
        actions.scheduleSessionRefresh(sessionId, { sessions: true, messages: true });
      }
      return;
    }
    case 'message.updated': {
      scheduleVisibleRefresh(actions, event.properties.sessionID, { messages: true });
      return;
    }
    case 'message.removed': {
      // Removal is destructive: rebuild the transcript rather than tail-merge.
      actions.scheduleSessionRefresh(event.properties.sessionID, { messages: true, messageMode: 'replace' });
      return;
    }
    case 'message.part.updated':
    case 'message.part.removed':
    case 'message.part.delta': {
      scheduleVisibleRefresh(actions, event.properties.sessionID, { messages: true });
      return;
    }
    case 'session.compacted': {
      actions.scheduleSessionRefresh(event.properties.sessionID, { sessions: true, messages: true, messageMode: 'replace', diff: true, todos: true });
      return;
    }
    case 'catalog.updated':
      void actions.refreshChatCapabilities().catch(() => undefined);
      return;
    case 'reference.updated':
    case 'plugin.added':
    case 'models-dev.refreshed':
    case 'integration.updated':
      void actions.refreshChatCapabilities().catch(() => undefined);
      return;
    case 'project.updated':
    case 'project.directories.updated':
      void actions.refreshProjectCatalog(true).catch(() => undefined);
      return;
    case 'file.edited':
    case 'file.watcher.updated':
    case 'vcs.branch.updated':
      void actions.refreshServerFeatures().catch(() => undefined);
      return;
    case 'pty.created':
    case 'pty.updated':
    case 'pty.exited':
    case 'pty.deleted':
      void actions.refreshTerminals().catch(() => undefined);
      return;
    case 'worktree.ready':
    case 'worktree.failed':
      void actions.refreshWorktrees().catch(() => undefined);
      void actions.refreshProjectCatalog(true).catch(() => undefined);
      return;
    case 'mcp.tools.changed':
      void actions.refreshMcpServers().catch(() => undefined);
      return;
    case 'mcp.browser.open.failed': {
      // The server could not open the MCP OAuth URL itself. Surface it so the
      // user can complete authentication instead of the tool silently hanging.
      actions.setMcpAuthPrompt({ mcpName: event.properties.mcpName, url: event.properties.url });
      void actions.refreshMcpServers().catch(() => undefined);
      return;
    }
    case 'lsp.updated':
      void actions.refreshDiagnostics().catch(() => undefined);
      return;
    case 'session.diff': {
      const sessionId = event.properties.sessionID;
      // V1 serves whole-file `before`/`after` contents, not a unified patch, so
      // normalize before the surface renders it.
      const diffs = toFileDiffs(event.properties.diff);
      // When the surface is pinned to an earlier turn, an incoming latest-turn
      // diff must not overwrite it; refresh the selected turn instead.
      if (diffs.length > 0 && !actions.selectedDiffMessageBySessionRef.current[sessionId]) {
        actions.setDiffsBySession((current) => ({
          ...current,
          [sessionId]: diffs,
        }));
      } else {
        actions.scheduleSessionRefresh(sessionId, { diff: true, delayMs: 50 });
      }
      return;
    }
    case 'todo.updated': {
      const sessionId = event.properties.sessionID;
      actions.setTodosBySession((current) => ({
        ...current,
        [sessionId]: event.properties.todos,
      }));
      return;
    }
    case 'permission.asked': {
      const request = event.properties;
      actions.setPendingPermissionsBySession((current) => ({
        ...current,
        [request.sessionID]: [
          ...(current[request.sessionID] || []).filter((item) => item.id !== request.id),
          request,
        ],
      }));
      // A subagent request carries a child session id that may have been created
      // after the last session-list refresh; refresh so the active chat can map
      // it to its root session and surface the blocker.
      void actions.refreshSessions(true).catch(() => undefined);
      return;
    }
    case 'permission.replied': {
      const { sessionID, requestID } = event.properties;
      actions.setPendingPermissionsBySession((current) => ({
        ...current,
        [sessionID]: (current[sessionID] || []).filter((item) => item.id !== requestID),
      }));
      return;
    }
    case 'question.asked': {
      const request = event.properties;
      actions.setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: [
          ...(current[request.sessionID] || []).filter((item) => item.id !== request.id),
          request,
        ],
      }));
      void actions.refreshSessions(true).catch(() => undefined);
      return;
    }
    case 'question.replied':
    case 'question.rejected': {
      const { sessionID, requestID } = event.properties;
      actions.setPendingQuestionsBySession((current) => ({
        ...current,
        [sessionID]: (current[sessionID] || []).filter((item) => item.id !== requestID),
      }));
      return;
    }
    default:
      return;
  }
}

export type CompatibilityEvent = { type: 'compatibility'; id?: string; location?: { directory?: string }; payload: GlobalEvent['payload'] };
export function translateCompatibilityEvent(event: GlobalEvent): OpencodeEvent {
  const location = { directory: event.directory };
  const payload = event.payload;
  switch (payload.type) {
    case 'session.status': return { type: 'session.status', location, data: payload.properties };
    case 'session.idle': return { type: 'session.idle', location, data: payload.properties };
    case 'permission.asked': {
      const request = payload.properties;
      return { type: 'permission.asked', location, data: { id: request.id, sessionID: request.sessionID, action: request.permission, resources: request.patterns, save: request.always, metadata: request.metadata, ...(request.tool ? { source: { type: 'tool' as const, messageID: request.tool.messageID, id: request.tool.callID } } : {}) } };
    }
    case 'permission.replied': return { type: 'permission.replied', location, data: payload.properties };
    case 'question.rejected': return { type: 'form.cancelled', location, data: { id: payload.properties.requestID, sessionID: payload.properties.sessionID } };
    // Legacy incremental message events, question metadata, config writes and
    // diagnostics carry information absent from native events. Keep them explicit.
    default: return { type: 'compatibility', location, payload };
  }
}
export function compatibilityStatus(event: CompatibilityEvent) {
  if (event.payload.type === 'session.status') return { sessionID: event.payload.properties.sessionID, status: event.payload.properties.status };
  if (event.payload.type === 'session.idle') return { sessionID: event.payload.properties.sessionID, status: { type: 'idle' as const } };
}
