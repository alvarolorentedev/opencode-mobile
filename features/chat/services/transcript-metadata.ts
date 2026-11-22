import type { QueryClient } from '@tanstack/react-query';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { QueryIdentity } from '@/shared/server-data/keys';
import { transcriptMetadataKey, type TranscriptMetadata } from '@/shared/server-data/session-plans';

export const EMPTY_METADATA: TranscriptMetadata = { usageStepsBySession: {}, todoRecordsBySession: {} };

export function createTranscriptMetadata(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient) {
  const key = transcriptMetadataKey(identity, client);
  const setter = <K extends keyof TranscriptMetadata>(field: K) => (change: TranscriptMetadata[K] | ((current: TranscriptMetadata[K]) => TranscriptMetadata[K])) => {
    cache.setQueryData<TranscriptMetadata>(key, (current = EMPTY_METADATA) => {
      const value = typeof change === 'function' ? change(current[field]) : change;
      return value === current[field] ? current : { ...current, [field]: value };
    });
  };
  return { key, setUsageStepsBySession: setter('usageStepsBySession'), setTodoRecordsBySession: setter('todoRecordsBySession') };
}
