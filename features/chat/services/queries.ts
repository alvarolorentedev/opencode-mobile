import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { connectionQueryKey, projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export type MessagesBySession = Record<string, SessionMessageRecord[]>;

// Canonical message windows are Query data. The transcript hook still calls the
// setters, so the action layer keeps one ownership boundary while the cache
// becomes the only copy.
export function messagesKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return [...connectionQueryKey(identity, client.__opencode.contract), 'messages'] as const;
}

export function diffsKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return [...connectionQueryKey(identity, client.__opencode.contract), 'diffs'] as const;
}

export function todosKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return [...connectionQueryKey(identity, client.__opencode.contract), 'todos'] as const;
}

export function vcsDiffsKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return [...connectionQueryKey(identity, client.__opencode.contract), 'vcs-diffs'] as const;
}

export function promptInboxKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return projectQueryKey(identity, client, 'prompt-inbox');
}

export function transcriptMetadataKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return projectQueryKey(identity, client, 'transcript-metadata');
}
