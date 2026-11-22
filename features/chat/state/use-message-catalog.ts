import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import { useQueryIdentity } from '@/shared/server-data/client';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionMessageRecord } from '@/shared/presentation/format';

import { messagesKey, type MessagesBySession } from '../services/queries';

const EMPTY: MessagesBySession = {};

export function useMessageCatalog(client: ScopedOpencodeClient) {
  const { connectionId, connectionScope, authRevision } = useQueryIdentity();
  const queryClient = useQueryClient();
  const key = useMemo(() => messagesKey({ connectionId, connectionScope, authRevision }, client), [authRevision, client, connectionId, connectionScope]);
  const query = useQuery<MessagesBySession>({ queryKey: key, queryFn: skipToken });
  const messagesBySession = query.data ?? EMPTY;

  const readMessagesBySession = useCallback(() => queryClient.getQueryData<MessagesBySession>(key) ?? EMPTY, [key, queryClient]);

  const setMessagesBySession = useCallback<Dispatch<SetStateAction<MessagesBySession>>>((value) => {
    queryClient.setQueryData<MessagesBySession>(key, (current) => {
      const previous = current ?? EMPTY;
      return typeof value === 'function' ? value(previous) : value;
    });
  }, [key, queryClient]);

  return { messagesBySession, readMessagesBySession, setMessagesBySession };
}

export type MessageCatalog = ReturnType<typeof useMessageCatalog>;
export type { SessionMessageRecord };
