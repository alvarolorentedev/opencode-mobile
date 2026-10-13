import type { PendingPermissionRequest, PendingQuestionRequest } from '@/lib/opencode/client';
import { toTranscriptEntry, type SessionMessageRecord } from '@/lib/opencode/format';
import type { Session, SessionStatus, Todo } from '@/lib/opencode/types';
import { buildSessionLink } from '@/lib/session-link';
import { collectDescendantSessionIds } from '@/providers/opencode-provider-utils';
import { WIDGET_MAX_EXCERPT, WIDGET_SNAPSHOT_MAX_TITLE, type WidgetSessionEntry, type WidgetAttention, type WidgetPlan } from '@/providers/widget-snapshot';

export const widgetText = (value: string, limit = WIDGET_MAX_EXCERPT) => value.replace(/\s+/g, ' ').trim().slice(0, limit);
export function recentWidgetSessions(sessions: Session[]) {
  return sessions.filter((session) => session.directory && !session.parentID && !session.time.archived)
    .sort((a, b) => b.time.updated - a.time.updated || a.id.localeCompare(b.id)).slice(0, 3);
}
export function widgetSession(session: Session, scope: string, untitled: string, status: SessionStatus = { type: 'idle' }): WidgetSessionEntry {
  return { id: session.id, title: widgetText(session.title || untitled, WIDGET_SNAPSHOT_MAX_TITLE) || untitled,
    status: status.type, link: buildSessionLink({ sessionId: session.id, projectPath: session.directory || '', connectionScope: scope }) };
}
export function widgetReply(records: SessionMessageRecord[], attachmentLabel: string) {
  for (const record of [...records].reverse()) {
    if (record.info.role !== 'assistant') continue;
    const entry = toTranscriptEntry(record);
    const preview = widgetText(entry.text) || (entry.details.some((item) => item.kind === 'file') ? attachmentLabel : '');
    if (preview) return { preview, replyAt: entry.createdAt };
  }
  return {};
}
export function widgetAttention({ sessions, permissions, questions, scope, untitled, now, showPreviews, currentSessionId }: {
  sessions: Session[]; permissions: PendingPermissionRequest[]; questions: PendingQuestionRequest[];
  scope: string; untitled: string; now: number; showPreviews: boolean; currentSessionId?: string;
}): WidgetAttention {
  const roots = sessions.filter((session) => session.directory && !session.time.archived && (!session.parentID || !sessions.some((parent) => parent.id === session.parentID)));
  const globalRoot = roots.find((session) => session.id === currentSessionId) ?? roots[0];
  const rows = roots.flatMap((session) => {
    const ids = collectDescendantSessionIds(sessions, [session.id]);
    const belongs = (id: string) => ids.has(id) || (id === 'global' && session === globalRoot);
    const p = permissions.filter((request) => belongs(request.sessionID));
    const q = questions.filter((request) => belongs(request.sessionID));
    if (!p.length && !q.length) return [];
    const excerpt = p[0] ? `${p[0].permission}${p[0].patterns[0] ? `: ${p[0].patterns[0]}` : ''}`
      : q[0]?.questions[0]?.question || q[0]?.title || '';
    return [{ ...widgetSession(session, scope, untitled), permissions: p.length, questions: q.length,
      ...(showPreviews && excerpt ? { excerpt: widgetText(excerpt) } : {}), recency: session.time.updated }];
  }).sort((a, b) => b.recency - a.recency || a.id.localeCompare(b.id));
  return { updatedAt: now, total: rows.length, rows: rows.slice(0, 3).map(({ recency: _recency, ...row }) => row) };
}
export function widgetPlan(session: Session, todos: Todo[], scope: string, untitled: string, now: number, showPreviews: boolean): WidgetPlan {
  const indexed = todos.map((todo, index) => ({ index: index + 1, status: todo.status,
    ...(showPreviews ? { content: widgetText(todo.content) } : {}) }));
  const remaining = indexed.filter((todo) => todo.status !== 'completed' && todo.status !== 'cancelled');
  const start = remaining.findIndex((todo) => todo.status === 'in_progress');
  const steps = remaining.length ? remaining.slice(Math.max(start, 0), Math.max(start, 0) + 3) : indexed.slice(-3);
  return { updatedAt: now, session: widgetSession(session, scope, untitled),
    completed: todos.filter((todo) => todo.status === 'completed').length, total: todos.length, steps };
}
