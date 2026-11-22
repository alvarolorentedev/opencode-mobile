import type { AppCore } from '@/runtime/core';
import type { TranscriptReadOptions } from '@/shared/contracts/transcript-read';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { getErrorMessage } from '@/shared/utilities/error-message';

type ReadMessages = (sessionId: string, silent?: boolean, options?: TranscriptReadOptions) => Promise<SessionMessageRecord[]>;

export function createTranscriptReader(store: AppCore['store'], { scopeKey, client, isCurrentClient, refreshMessages }: {
  scopeKey: string;
  client: object;
  isCurrentClient: (candidate: object) => boolean;
  refreshMessages: ReadMessages;
}) {
  // Cold failures are distinct from genuinely empty sessions. The retry prompt
  // reads this map until a successful read or a replacement client clears it.
  const readMessages: ReadMessages = async (sessionId, silent = false, options) => {
    try {
      const records = await refreshMessages(sessionId, silent, options);
      if (isCurrentClient(client)) store.getState().setChat(scopeKey, (current) => {
        if (!(sessionId in current.readErrors)) return current;
        const readErrors = { ...current.readErrors };
        delete readErrors[sessionId];
        return { readErrors };
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
  };
  return { readMessages, reset: () => store.getState().setChat(scopeKey, { readErrors: {}, isRefreshingMessages: false }) };
}
