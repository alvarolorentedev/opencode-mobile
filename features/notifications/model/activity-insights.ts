import type { SessionMessageRecord } from '@/shared/presentation/format';
import { deriveTodosFromMessages, hasTodoWritePart } from '@/shared/presentation/format/todos';
import type { ToolPart } from '@/shared/protocol/opencode/message-types';

export type WorkPhase = 'reading' | 'editing' | 'searching' | 'executing' | 'delegating';
export type ActivityProgress = { completed: number; total: number };

export function currentTurn(records: SessionMessageRecord[]) {
  const ordered = [...records].sort((a, b) => a.info.time.created - b.info.time.created);
  const latest = ordered.at(-1)?.info;
  const runId = latest?.role === 'user' ? latest.id : latest?.parentID;
  const prompt = ordered.find((record) => record.info.role === 'user' && record.info.id === runId);
  return {
    runId, startedAt: prompt?.info.time.created,
    records: runId ? ordered.filter((record) => record.info.role === 'assistant' && record.info.parentID === runId) : [],
  };
}

// A repeated part/call is an updated observation, not another running tool.
export function turnTools(records: SessionMessageRecord[]): ToolPart[] {
  const ids = new Set<string>();
  const calls = new Set<string>();
  return records.flatMap((record) => record.parts).filter((part): part is ToolPart => part.type === 'tool')
    .reverse().filter((part) => {
      if ((part.id && ids.has(part.id)) || (part.callID && calls.has(part.callID))) return false;
      if (part.id) ids.add(part.id);
      if (part.callID) calls.add(part.callID);
      return true;
    }).reverse();
}

export function toolWorkPhase(tool: string): WorkPhase | undefined {
  switch (tool.trim().toLowerCase()) {
    case 'read': case 'read_file': return 'reading';
    case 'edit': case 'write': case 'apply_patch': return 'editing';
    case 'grep': case 'glob': case 'list': return 'searching';
    case 'bash': case 'shell': return 'executing';
    case 'task': return 'delegating';
    default: return undefined;
  }
}

export function turnProgress(records: SessionMessageRecord[]): ActivityProgress | undefined {
  const latest = turnTools(records).findLast((part) => hasTodoWritePart({ parts: [part] } as SessionMessageRecord));
  if (!latest || latest.state.status !== 'completed') return undefined;
  const todos = deriveTodosFromMessages([{ parts: [latest] } as SessionMessageRecord]);
  const raw = latest.state.input.todos;
  if (!Array.isArray(raw) || !todos.length || todos.length !== raw.length) return undefined;
  // Cancelled/failed tasks remain in the denominator, never in completed.
  // Unknown statuses make the plan indeterminate rather than a fake percentage.
  if (raw.some((todo) => !['pending', 'in_progress', 'completed', 'cancelled', 'failed'].includes(todo?.status))) return undefined;
  return { completed: todos.filter((todo) => todo.status === 'completed').length, total: todos.length };
}
