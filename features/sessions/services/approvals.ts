import type { QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { pendingInteractionsKey, type PendingInteractionsData } from './queries';

type Update<T> = T | ((current: T) => T);
export const EMPTY_APPROVALS: PendingInteractionsData = { permissions: {}, questions: {} };

function apply<T>(value: Update<T>, previous: T): T {
  return typeof value === 'function' ? (value as (current: T) => T)(previous) : value;
}

export function approvalsAccess(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient) {
  const queryKey = pendingInteractionsKey(identity, client);
  const read = () => cache.getQueryData<PendingInteractionsData>(queryKey) ?? EMPTY_APPROVALS;
  return {
    queryKey,
    read,
    setPermissions(value: Update<PendingInteractionsData['permissions']>) {
      cache.setQueryData<PendingInteractionsData>(queryKey, (current = EMPTY_APPROVALS) => ({
        ...current, permissions: apply(value, current.permissions),
      }));
    },
    setQuestions(value: Update<PendingInteractionsData['questions']>) {
      cache.setQueryData<PendingInteractionsData>(queryKey, (current = EMPTY_APPROVALS) => ({
        ...current, questions: apply(value, current.questions),
      }));
    },
  };
}
