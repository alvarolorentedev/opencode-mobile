import type { QueryClient } from '@tanstack/react-query';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

export type QueryIdentity = { connectionId: string; connectionScope: string; authRevision: number };
export function connectionQueryKey(identity: QueryIdentity, contract: string) {
  return ['opencode', identity.connectionId, identity.connectionScope, identity.authRevision, contract] as const;
}
export function projectQueryKey(identity: QueryIdentity, client: ScopedOpencodeClient, resource: string, ...parameters: unknown[]) {
  return [...connectionQueryKey(identity, client.__opencode.contract), 'project', client.__opencode.directory ?? '', resource, ...parameters] as const;
}

export function replaceQueryPartition(cache: QueryClient, previous: QueryIdentity, next: QueryIdentity, preserve: boolean) {
  const old = cache.getQueryCache().findAll({ predicate: ({ queryKey: key }) => key[0] === 'opencode'
    && key[1] === previous.connectionId && key[2] === previous.connectionScope && key[3] === previous.authRevision });
  if (preserve) for (const query of old) {
    const key = [...query.queryKey]; key[2] = next.connectionScope; key[3] = next.authRevision;
    if (query.state.data !== undefined && cache.getQueryData(key) === undefined) {
      cache.setQueryData(key, query.state.data, { updatedAt: query.state.dataUpdatedAt });
    }
  }
  for (const query of old) {
    void cache.cancelQueries({ queryKey: query.queryKey, exact: true });
    cache.removeQueries({ queryKey: query.queryKey, exact: true });
  }
}
