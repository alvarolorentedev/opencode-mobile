import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import { useQueryIdentity } from '@/shared/server-data/client';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { FileDiff, Todo } from '@/shared/protocol/opencode/types';

import { diffsKey, todosKey, vcsDiffsKey } from '../services/queries';

const EMPTY_DIFFS: Record<string, FileDiff[]> = {};
const EMPTY_TODOS: Record<string, Todo[]> = {};
const EMPTY_VCS: Record<'uncommitted' | 'branch', FileDiff[]> = { uncommitted: [], branch: [] };

// Diffs, todos and VCS diffs are server facts. The refresh actions keep their
// setter contract while Query becomes the only copy.
export function useDiffCatalog(client: ScopedOpencodeClient) {
  const identity = useQueryIdentity();
  const queryClient = useQueryClient();
  const diffsQueryKey = diffsKey(identity, client);
  const todosQueryKey = todosKey(identity, client);
  const vcsQueryKey = vcsDiffsKey(identity, client);

  const diffs = useQuery<Record<string, FileDiff[]>>({ queryKey: diffsQueryKey, queryFn: skipToken });
  const todos = useQuery<Record<string, Todo[]>>({ queryKey: todosQueryKey, queryFn: skipToken });
  const vcs = useQuery<Record<'uncommitted' | 'branch', FileDiff[]>>({ queryKey: vcsQueryKey, queryFn: skipToken });

  const setDiffsBySession = useCallback<Dispatch<SetStateAction<Record<string, FileDiff[]>>>>((value) => {
    queryClient.setQueryData<Record<string, FileDiff[]>>(diffsQueryKey, (current) => {
      const previous = current ?? EMPTY_DIFFS;
      return typeof value === 'function' ? value(previous) : value;
    });
  }, [diffsQueryKey, queryClient]);

  const setTodosBySession = useCallback<Dispatch<SetStateAction<Record<string, Todo[]>>>>((value) => {
    queryClient.setQueryData<Record<string, Todo[]>>(todosQueryKey, (current) => {
      const previous = current ?? EMPTY_TODOS;
      return typeof value === 'function' ? value(previous) : value;
    });
  }, [queryClient, todosQueryKey]);

  const setVcsDiffsByScope = useCallback<Dispatch<SetStateAction<Record<'uncommitted' | 'branch', FileDiff[]>>>>((value) => {
    queryClient.setQueryData<Record<'uncommitted' | 'branch', FileDiff[]>>(vcsQueryKey, (current) => {
      const previous = current ?? EMPTY_VCS;
      return typeof value === 'function' ? value(previous) : value;
    });
  }, [queryClient, vcsQueryKey]);

  return {
    diffsBySession: diffs.data ?? EMPTY_DIFFS,
    todosBySession: todos.data ?? EMPTY_TODOS,
    vcsDiffsByScope: vcs.data ?? EMPTY_VCS,
    setDiffsBySession,
    setTodosBySession,
    setVcsDiffsByScope,
  };
}

export type DiffCatalog = ReturnType<typeof useDiffCatalog>;
