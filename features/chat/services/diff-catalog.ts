import type { QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { FileDiff, Todo } from '@/shared/protocol/opencode/types';
import type { QueryIdentity } from '@/shared/server-data/keys';
import { todosKey } from '@/shared/server-data/session-plans';

import { diffsKey, vcsDiffsKey } from './queries';

export const EMPTY_DIFFS: Record<string, FileDiff[]> = {};
export const EMPTY_TODOS: Record<string, Todo[]> = {};
export const EMPTY_VCS: Record<'uncommitted' | 'branch', FileDiff[]> = { uncommitted: [], branch: [] };

export function createDiffCatalog(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient) {
  const diffs = diffsKey(identity, client);
  const todos = todosKey(identity, client);
  const vcs = vcsDiffsKey(identity, client);
  function write<T>(key: readonly unknown[], fallback: T) {
    return (update: T | ((current: T) => T)) => {
      cache.setQueryData<T>(key, (current = fallback) => typeof update === 'function' ? (update as (value: T) => T)(current) : update);
    };
  }
  return {
    diffs, todos, vcs,
    setDiffsBySession: write(diffs, EMPTY_DIFFS),
    setTodosBySession: write(todos, EMPTY_TODOS),
    setVcsDiffsByScope: write(vcs, EMPTY_VCS),
  };
}
