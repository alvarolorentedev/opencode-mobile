import type { QueryClient } from '@tanstack/react-query';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { QueryIdentity } from '@/shared/server-data/keys';

import type { LiveTranscriptBuffer } from '../model/live-transcript';
import { overlayTranscriptMap, overlayTranscriptSession } from '../model/live-transcript-view';
import { liveTranscriptPartition, transcriptPrefix } from './queries';
import { transcriptAccess, transcriptRecords, type TranscriptData } from './transcript-queries';

export function cachedTranscriptView(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient) {
  const prefix = transcriptPrefix(identity, client);
  const partition = liveTranscriptPartition(identity, client);
  const access = transcriptAccess(cache, identity, client);
  return {
    prefix,
    session(id: string, buffer: LiveTranscriptBuffer | undefined) {
      return overlayTranscriptSession(buffer?.partition === partition ? buffer : undefined, id, access.read(id));
    },
    read(current?: string, voice?: string) {
      const queries = cache.getQueryCache().findAll({ queryKey: prefix }).filter(({ state, queryKey }) => state.data && queryKey.length === prefix.length + 1);
      const selected = queries.filter(({ queryKey }) => queryKey.at(-1) === current || queryKey.at(-1) === voice);
      const recent = queries.filter((query) => !selected.includes(query)).sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt).slice(0, 3);
      return Object.fromEntries([...selected, ...recent].map(({ queryKey, state }) =>
        [String(queryKey.at(-1)), transcriptRecords(state.data as TranscriptData)]));
    },
    display(buffer: LiveTranscriptBuffer | undefined, held: Record<string, SessionMessageRecord[]>) {
      return overlayTranscriptMap(buffer, partition, held);
    },
  };
}
