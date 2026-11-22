import type { QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { connectionQueryKey, projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export function transcriptPrefix(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return projectQueryKey(identity, client, 'transcript');
}

export function transcriptKey(identity: QueryIdentity, client: ScopedOpencodeClient, sessionId: string) {
  return [...transcriptPrefix(identity, client), sessionId] as const;
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

export function forgetSessionContent(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient, sessionId: string) {
  cache.removeQueries({ queryKey: transcriptKey(identity, client, sessionId), exact: true });
  for (const queryKey of [diffsKey(identity, client), todosKey(identity, client)]) {
    cache.setQueryData<Record<string, unknown>>(queryKey, (current) => {
      if (!current || !(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }
}
