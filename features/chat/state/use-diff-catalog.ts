import { useMemo } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { FileDiff, Todo } from '@/shared/protocol/opencode/types';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { createDiffCatalog, EMPTY_DIFFS, EMPTY_TODOS, EMPTY_VCS } from '../services/diff-catalog';

export function useDiffCatalog(identity: QueryIdentity, client: ScopedOpencodeClient) {
  const cache = useQueryClient();
  const writer = useMemo(() => createDiffCatalog(cache, identity, client), [cache, client, identity]);
  const diffs = useQuery<Record<string, FileDiff[]>>({ queryKey: writer.diffs, queryFn: skipToken });
  const todos = useQuery<Record<string, Todo[]>>({ queryKey: writer.todos, queryFn: skipToken });
  const vcs = useQuery<Record<'uncommitted' | 'branch', FileDiff[]>>({ queryKey: writer.vcs, queryFn: skipToken });
  return {
    diffsBySession: diffs.data ?? EMPTY_DIFFS,
    todosBySession: todos.data ?? EMPTY_TODOS,
    vcsDiffsByScope: vcs.data ?? EMPTY_VCS,
    setDiffsBySession: writer.setDiffsBySession,
    setTodosBySession: writer.setTodosBySession,
    setVcsDiffsByScope: writer.setVcsDiffsByScope,
  };
}

type DiffCatalog = ReturnType<typeof useDiffCatalog>;
