import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { SessionUsageStep } from '@/shared/presentation/usage';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { connectionQueryKey, projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export type TranscriptMetadata = {
  usageStepsBySession: Record<string, SessionUsageStep[]>;
  todoRecordsBySession: Record<string, SessionMessageRecord[]>;
};

export function transcriptMetadataKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return projectQueryKey(identity, client, 'transcript-metadata');
}

export function todosKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return [...connectionQueryKey(identity, client.__opencode.contract), 'todos'] as const;
}
