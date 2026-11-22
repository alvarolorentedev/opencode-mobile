import type { QueryIdentity } from '@/shared/server-data/keys';
import { useMemo } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import { approvalsAccess, EMPTY_APPROVALS } from '../services/approvals';
import type { PendingInteractionsData } from '../services/queries';

export function useApprovalsCatalog(identity: QueryIdentity, client: ScopedOpencodeClient) {
  const cache = useQueryClient();
  const approvals = useMemo(() => approvalsAccess(cache, identity, client), [cache, client, identity]);
  const query = useQuery<PendingInteractionsData>({ queryKey: approvals.queryKey, queryFn: skipToken });
  const { permissions, questions } = query.data ?? EMPTY_APPROVALS;
  return {
    pendingPermissionsBySession: permissions,
    pendingQuestionsBySession: questions,
    setPendingPermissionsBySession: approvals.setPermissions,
    setPendingQuestionsBySession: approvals.setQuestions,
  };
}

export type ApprovalsCatalog = ReturnType<typeof useApprovalsCatalog>;
