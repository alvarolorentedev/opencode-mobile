import { useMemo } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { SessionMessageRecord } from '@/shared/presentation/format';

import { overlayTranscriptMap } from '../model/live-transcript-view';

export function useLiveTranscriptView(scopeKey: string, partition: string | undefined, canonical: Record<string, SessionMessageRecord[]>, observed = true) {
  const { store } = useAppCore();
  const paintRevision = useAppStore((state) => observed ? state.transcriptUi[scopeKey]?.paintRevision ?? 0 : 0);
  return useMemo(() => {
    if (!observed) return canonical;
    const buffer = store.getState().transcriptLive.get(scopeKey);
    return overlayTranscriptMap(buffer, partition, canonical);
  // A paint revision publishes mutations to the live buffer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical, observed, paintRevision, partition, scopeKey, store]);
}
