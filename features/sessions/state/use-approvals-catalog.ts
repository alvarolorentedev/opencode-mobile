import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import { useQueryIdentity } from '@/shared/server-data/client';
import type { PendingPermissionRequest, PendingQuestionRequest, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import { pendingInteractionsKey, type PendingInteractionsData } from '../services/queries';

const EMPTY_PERMISSIONS: Record<string, PendingPermissionRequest[]> = {};
const EMPTY_QUESTIONS: Record<string, PendingQuestionRequest[]> = {};

function apply<T>(value: SetStateAction<T>, previous: T): T {
  return typeof value === 'function' ? (value as (current: T) => T)(previous) : value;
}

// The refresh path writes this cache; the runtime selects from it. Keeping the
// setters preserves the action layer contract without a second React copy.
export function useApprovalsCatalog(client: ScopedOpencodeClient) {
  const identity = useQueryIdentity();
  const queryClient = useQueryClient();
  const key = pendingInteractionsKey(identity, client);
  const query = useQuery<PendingInteractionsData>({ queryKey: key, queryFn: skipToken });

  const setPendingPermissionsBySession = useCallback<Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>>((value) => {
    queryClient.setQueryData<PendingInteractionsData>(key, (current) => ({
      permissions: apply(value, current?.permissions ?? EMPTY_PERMISSIONS),
      questions: current?.questions ?? EMPTY_QUESTIONS,
    }));
  }, [key, queryClient]);

  const setPendingQuestionsBySession = useCallback<Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>>((value) => {
    queryClient.setQueryData<PendingInteractionsData>(key, (current) => ({
      permissions: current?.permissions ?? EMPTY_PERMISSIONS,
      questions: apply(value, current?.questions ?? EMPTY_QUESTIONS),
    }));
  }, [key, queryClient]);

  return {
    pendingPermissionsBySession: query.data?.permissions ?? EMPTY_PERMISSIONS,
    pendingQuestionsBySession: query.data?.questions ?? EMPTY_QUESTIONS,
    setPendingPermissionsBySession,
    setPendingQuestionsBySession,
  };
}

export type ApprovalsCatalog = ReturnType<typeof useApprovalsCatalog>;
