import { useCallback, useEffect, useMemo } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { SessionMessageRecord } from '@/shared/presentation/format';

import { overlayTranscriptMap } from '../model/live-transcript-view';
import { createLiveTranscript, type LiveTranscriptInput } from '../services/live-transcript-controller';

export function useLiveTranscript({ scopeKey, partition, client, isCurrentClient, messagesBySession, readCanonicalSession, recordUsageAndTodos }:
  LiveTranscriptInput & { messagesBySession: Record<string, SessionMessageRecord[]> }) {
  const { store, clock } = useAppCore();
  const actions = useMemo(() => createLiveTranscript({
    store, clock: clock ?? Date.now, scopeKey, partition, client, isCurrentClient, readCanonicalSession, recordUsageAndTodos,
  }), [client, clock, isCurrentClient, partition, readCanonicalSession, recordUsageAndTodos, scopeKey, store]);
  useEffect(() => actions.dispose, [actions]);
  const readDisplayedSession = useCallback((sessionId: string) => actions.overlay(sessionId, readCanonicalSession(sessionId)),
    [actions, readCanonicalSession]);
  const displayedMessages = useLiveTranscriptView(scopeKey, partition, messagesBySession);
  return { actions, displayedMessages, readDisplayedSession };
}

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
