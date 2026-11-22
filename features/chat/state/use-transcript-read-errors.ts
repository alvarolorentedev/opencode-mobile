import { useCallback, useEffect, useRef } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import { getErrorMessage } from '@/shared/utilities/error-message';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { TranscriptReadOptions } from '@/shared/contracts/domain';

type RefreshMessages = (
  sessionId: string,
  silent?: boolean,
  options?: TranscriptReadOptions,
) => Promise<SessionMessageRecord[]>;

const EMPTY_ERRORS: Record<string, string> = {};

// A cold transcript read can fail while the server still reports a connected
// status (for example one request times out). Keep that failure separate from a
// genuinely empty session so the chat can offer a retry instead of starter
// prompts. Errors are keyed by workspace scope; a reconnect or server switch
// starts with an empty map.
export function useTranscriptReadErrors({
  scopeKey,
  client,
  isCurrentClient,
  refreshMessages,
}: {
  scopeKey: string;
  client: object;
  isCurrentClient: (candidate: object) => boolean;
  refreshMessages: RefreshMessages;
}) {
  const { store } = useAppCore();
  const errors = useAppStore((state) => state.chat[scopeKey]?.readErrors ?? EMPTY_ERRORS);
  const clientRef = useRef(client);
  useEffect(() => {
    if (clientRef.current === client) return;
    clientRef.current = client;
    store.getState().setChat(scopeKey, { readErrors: {} });
  }, [client, scopeKey, store]);

  const readMessages = useCallback<RefreshMessages>(async (sessionId, silent = false, options) => {
    try {
      const records = await refreshMessages(sessionId, silent, options);
      store.getState().setChat(scopeKey, (current) => {
        if (!(sessionId in current.readErrors)) return current;
        const next = { ...current.readErrors };
        delete next[sessionId];
        return { readErrors: next };
      });
      return records;
    } catch (error) {
      if (!silent && isCurrentClient(client)) {
        const message = getErrorMessage(error).trim();
        store.getState().setChat(scopeKey, (current) => (
          current.readErrors[sessionId] === message ? current : { readErrors: { ...current.readErrors, [sessionId]: message } }
        ));
      }
      throw error;
    }
  }, [client, isCurrentClient, refreshMessages, scopeKey, store]);

  return { errors, readMessages };
}
