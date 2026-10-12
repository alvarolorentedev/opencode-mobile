import { clearSharedPayloads, getResolvedSharedPayloadsAsync, getSharedPayloads } from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { parseIncomingShare, type SharedPayload } from '@/lib/share/parse';

// A staged share is kept only long enough for the user to preview and add it to
// a chat. It is in-memory only; nothing is written to disk or submitted.
export const SHARE_TTL_MS = 10 * 60 * 1000;

export type SharedInput = {
  pending: SharedPayload | null;
  clearShared: () => void;
};

const EMPTY: SharedInput = { pending: null, clearShared: () => undefined };

/**
 * Stages content shared into the app from the OS share sheet. Native only:
 * web cannot receive share payloads, and calling the module there throws. The
 * provider owns this so the preview route and the composer read one source.
 */
export function useShareState(): SharedInput {
  const [pending, setPending] = useState<SharedPayload | null>(null);
  const receivedAtRef = useRef(0);

  const ingest = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      if (getSharedPayloads().length === 0) return;
      const resolved = await getResolvedSharedPayloadsAsync();
      const payload = parseIncomingShare(resolved);
      if (!payload) return;
      receivedAtRef.current = Date.now();
      setPending(payload);
    } catch {
      // Malformed or unavailable share payloads are ignored rather than staged.
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- stage any share that launched or resumed the app.
    void ingest();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void ingest();
    });
    return () => subscription.remove();
  }, [ingest]);

  const clearShared = useCallback(() => {
    setPending(null);
    if (Platform.OS === 'web') return;
    try {
      clearSharedPayloads();
    } catch {
      // Nothing to clear if the native payload was already consumed.
    }
  }, []);

  useEffect(() => {
    if (!pending) return;
    const remaining = Math.max(SHARE_TTL_MS - (Date.now() - receivedAtRef.current), 0);
    const timer = setTimeout(clearShared, remaining);
    return () => clearTimeout(timer);
  }, [clearShared, pending]);

  return pending ? { pending, clearShared } : EMPTY;
}
