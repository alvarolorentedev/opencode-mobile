import { skipToken, useQuery } from '@tanstack/react-query';

import { useProjectScope } from '@/runtime/core';
import type { SessionTarget } from '@/shared/contracts/workspace';
import { deriveTodosFromMessages } from '@/shared/presentation/format';
import { transcriptMetadataKey, type TranscriptMetadata } from '@/shared/server-data/session-plans';

export function useMissionPlanProgress(target: SessionTarget, stale: boolean) {
  const { identity, client } = useProjectScope(target);
  const { data: records } = useQuery({
    queryKey: transcriptMetadataKey(identity, client), queryFn: skipToken,
    select: (metadata: TranscriptMetadata) => metadata.todoRecordsBySession[target.sessionId],
  });
  const todos = records && !stale ? deriveTodosFromMessages(records) : [];
  return todos.length ? { completed: todos.filter((todo) => todo.status === 'completed').length, total: todos.length } : undefined;
}
