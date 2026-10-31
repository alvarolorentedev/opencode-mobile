import type { Todo } from '@/shared/protocol/opencode/types';
import type { SessionMessageRecord } from '@/shared/presentation/format/types';

// OpenCode 2.x dropped the server-owned session todo endpoint. Its plan/task
// list is carried by the `todowrite` tool input instead, so derive it from the
// transcript. Messages arrive chronologically, so the last write wins.
const TODO_TOOL_NAMES = new Set(['todowrite', 'todo', 'todo_write']);

// A transcript window is paginated, so the provider accumulates only the
// records that can carry a plan instead of retaining every loaded message.
export function hasTodoWritePart(record: SessionMessageRecord) {
  return record.parts.some((part) => part.type === 'tool' && TODO_TOOL_NAMES.has(part.tool));
}

export function deriveTodosFromMessages(messages: SessionMessageRecord[]): Todo[] {
  let todos: Todo[] = [];

  for (const record of messages) {
    for (const part of record.parts) {
      if (part.type !== 'tool' || !TODO_TOOL_NAMES.has(part.tool)) {
        continue;
      }

      const input = part.state.input as Record<string, unknown> | undefined;
      const raw = input && typeof input === 'object' ? input.todos : undefined;
      if (!Array.isArray(raw)) {
        continue;
      }

      todos = raw.flatMap((item) => {
        if (!item || typeof item !== 'object') {
          return [];
        }
        const value = item as Record<string, unknown>;
        const content = typeof value.content === 'string' ? value.content : '';
        if (!content) {
          return [];
        }
        return [{
          content,
          status: typeof value.status === 'string' ? value.status : 'pending',
          priority: typeof value.priority === 'string' ? value.priority : 'medium',
        }];
      });
    }
  }

  return todos;
}
