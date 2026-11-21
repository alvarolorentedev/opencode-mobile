import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import { useQueryIdentity } from '@/shared/server-data/client';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionMessageRecord } from '@/shared/presentation/format';

import { messagesKey, type MessagesBySession } from '../services/queries';

const EMPTY: MessagesBySession = {};

export function useMessageCatalog(client: ScopedOpencodeClient) {
  const identity = useQueryIdentity();
  const queryClient = useQueryClient();
  const key = messagesKey(identity, client);
  const query = useQuery<MessagesBySession>({ queryKey: key, queryFn: skipToken });
  const messagesBySession = query.data ?? EMPTY;

  const messagesBySessionRef = useRef(messagesBySession);
  useLayoutEffect(() => { messagesBySessionRef.current = messagesBySession; });

  const setMessagesBySession = useCallback<Dispatch<SetStateAction<MessagesBySession>>>((value) => {
    queryClient.setQueryData<MessagesBySession>(key, (current) => {
      const previous = current ?? EMPTY;
      return typeof value === 'function' ? value(previous) : value;
    });
  }, [key, queryClient]);

  return { messagesBySession, messagesBySessionRef, setMessagesBySession };
}

export type MessageCatalog = ReturnType<typeof useMessageCatalog>;
export type { SessionMessageRecord };
