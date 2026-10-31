import type { ScopedOpencodeClient } from '@/lib/opencode/client';

export type QueryIdentity = { connectionId: string; connectionScope: string; authRevision: number };
export function connectionQueryKey(identity: QueryIdentity, contract: string) {
  return ['opencode', identity.connectionId, identity.connectionScope, identity.authRevision, contract] as const;
}
export function projectQueryKey(identity: QueryIdentity, client: ScopedOpencodeClient, resource: string, ...parameters: unknown[]) {
  return [...connectionQueryKey(identity, client.__opencode.contract), 'project', client.__opencode.directory ?? '', resource, ...parameters] as const;
}
