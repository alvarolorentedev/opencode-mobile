import type { QueryIdentity } from '@/shared/server-data/keys';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { TranscriptMetadata } from '@/shared/server-data/session-plans';

import { createTranscriptMetadata, EMPTY_METADATA } from '../services/transcript-metadata';

export function useTranscriptMetadata(identity: QueryIdentity, client: ScopedOpencodeClient) {
  const cache = useQueryClient();
  const { key, ...actions } = useMemo(() => createTranscriptMetadata(cache, identity, client), [cache, client, identity]);
  const { data = EMPTY_METADATA } = useQuery<TranscriptMetadata>({ queryKey: key, queryFn: skipToken });
  return { ...data, ...actions };
}
