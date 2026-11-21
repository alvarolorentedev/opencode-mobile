import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { connectionQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export type MessagesBySession = Record<string, SessionMessageRecord[]>;

// Canonical message windows are Query data. The transcript hook still calls the
// setters, so the action layer keeps one ownership boundary while the cache
// becomes the only copy.
export function messagesKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return [...connectionQueryKey(identity, client.__opencode.contract), 'messages'] as const;
}
