import type { QueryIdentity } from '@/shared/server-data/keys';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, type SetStateAction } from 'react';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { SessionUsageStep } from '@/shared/presentation/usage';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import { transcriptMetadataKey } from '../services/queries';

type TranscriptMetadata = {
  usageStepsBySession: Record<string, SessionUsageStep[]>;
  todoRecordsBySession: Record<string, SessionMessageRecord[]>;
};

const EMPTY_METADATA: TranscriptMetadata = { usageStepsBySession: {}, todoRecordsBySession: {} };

export function useTranscriptMetadata(identity: QueryIdentity, client: ScopedOpencodeClient) {
  const cache = useQueryClient();
  const key = useMemo(() => transcriptMetadataKey(identity, client), [client, identity]);
  const { data = EMPTY_METADATA } = useQuery<TranscriptMetadata>({ queryKey: key, queryFn: skipToken });
  const actions = useMemo(() => {
    const setter = <K extends keyof TranscriptMetadata>(field: K) => (change: SetStateAction<TranscriptMetadata[K]>) => {
      cache.setQueryData<TranscriptMetadata>(key, (current = EMPTY_METADATA) => {
        const value = typeof change === 'function' ? change(current[field]) : change;
        return value === current[field] ? current : { ...current, [field]: value };
      });
    };
    return {
      setUsageStepsBySession: setter('usageStepsBySession'),
      setTodoRecordsBySession: setter('todoRecordsBySession'),
    };
  }, [cache, key]);
  return { ...data, ...actions };
}
