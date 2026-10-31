import type { Dispatch, SetStateAction } from 'react';

import { hasTodoWritePart } from '@/shared/presentation/format/todos';
import type { SessionMessageRecord } from '@/shared/presentation/format/types';
import { mergeSessionMessageWindow } from '@/shared/presentation/format/window';
import { addUsageSteps, type SessionUsageStep } from '@/shared/presentation/usage';

// Keep usage and plan ledgers replay-safe without tying the rules to React.
// The hook wraps this in useCallback; tests can exercise the same function.
export function recordSessionUsageAndTodos(
  sessionId: string,
  records: SessionMessageRecord[],
  setUsageStepsBySession: Dispatch<SetStateAction<Record<string, SessionUsageStep[]>>>,
  setTodoRecordsBySession: Dispatch<SetStateAction<Record<string, SessionMessageRecord[]>>>,
) {
  if (records.length === 0) return;

  setUsageStepsBySession((current) => {
    const steps = new Map((current[sessionId] ?? []).map((step) => [step.key, step] as const));
    if (!addUsageSteps(steps, records)) return current;
    return { ...current, [sessionId]: [...steps.values()] };
  });

  const todoRecords = records.filter(hasTodoWritePart);
  if (todoRecords.length === 0) return;
  setTodoRecordsBySession((current) => {
    const existing = current[sessionId] ?? [];
    const merged = mergeSessionMessageWindow(existing, todoRecords);
    if (merged === existing) return current;
    // Older pages arrive after the newest page; plan writes must still be chronological.
    return { ...current, [sessionId]: merged.sort((left, right) => left.info.time.created - right.info.time.created) };
  });
}
