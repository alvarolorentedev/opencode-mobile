import { useCallback, useState } from 'react';

import { getErrorMessage } from '@/shared/utilities/error-message';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { TranscriptRefreshMode } from '@/shared/contracts/domain';

type RefreshMessages = (
  sessionId: string,
  silent?: boolean,
  options?: { mode?: TranscriptRefreshMode },
) => Promise<SessionMessageRecord[]>;

type ReadErrorsState = {
  client: object;
  errors: Record<string, string>;
};

const EMPTY_ERRORS: Record<string, string> = {};

// A cold transcript read can fail while the server still reports a connected
// status (for example one request times out). Keep that failure separate from a
// genuinely empty session so the chat can offer a retry instead of starter
// prompts. Errors are tagged with the client instance so a reconnect or server
// switch never shows a stale session's failure.
export function useTranscriptReadErrors({
  client,
  isCurrentClient,
  refreshMessages,
}: {
  client: object;
  isCurrentClient: (candidate: object) => boolean;
  refreshMessages: RefreshMessages;
}) {
  const [state, setState] = useState<ReadErrorsState>(() => ({ client, errors: {} }));
  const errors = state.client === client ? state.errors : EMPTY_ERRORS;

  const readMessages = useCallback<RefreshMessages>(async (sessionId, silent = false, options) => {
    try {
      const records = await refreshMessages(sessionId, silent, options);
      setState((current) => {
        if (current.client !== client || !(sessionId in current.errors)) return current;
        const next = { ...current.errors };
        delete next[sessionId];
        return { client, errors: next };
      });
      return records;
    } catch (error) {
      if (!silent && isCurrentClient(client)) {
        const message = getErrorMessage(error).trim();
        setState((current) => {
          const currentErrors = current.client === client ? current.errors : {};
          if (current.client === client && currentErrors[sessionId] === message) return current;
          return { client, errors: { ...currentErrors, [sessionId]: message } };
        });
      }
      throw error;
    }
  }, [client, isCurrentClient, refreshMessages]);

  return { errors, readMessages };
}
