import { MutationObserver, type QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Session } from '@/shared/protocol/opencode/types';
import { createSession as createRemoteSession, forkSession as forkRemoteSession } from '@/shared/protocol/services/session-service';
import type { QueryIdentity } from '@/shared/server-data/keys';

import type { SessionChatConfig } from '../model/chat-config';
import { projectSessionsKey } from './queries';
import { sessionCatalogAccess } from './session-catalog-access';

const CREATE_GRACE_MS = 10_000;
const creationKey = (identity: QueryIdentity, client: ScopedOpencodeClient) => [...projectSessionsKey(identity, client), 'creation'];
type Creation = { sessionId: string; recordedAt: number };

export function recentlyCreatedSessionIds(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient, reconciled: ReadonlySet<string>, now: number) {
  const mutations = cache.getMutationCache();
  const missing = new Set<string>();
  for (const mutation of mutations.findAll({ mutationKey: creationKey(identity, client), exact: true, status: 'success' })) {
    const entry = mutation.state.data as Creation | undefined;
    if (!entry) continue;
    if (reconciled.has(entry.sessionId) || now - entry.recordedAt > CREATE_GRACE_MS) mutations.remove(mutation);
    else missing.add(entry.sessionId);
  }
  return missing;
}

export function forgetSessionCreation(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient, sessionId?: string) {
  const mutations = cache.getMutationCache();
  for (const mutation of mutations.findAll({ mutationKey: creationKey(identity, client), exact: true, status: 'success' })) {
    if (!sessionId || (mutation.state.data as Creation | undefined)?.sessionId === sessionId) mutations.remove(mutation);
  }
}

export function sessionCreationCommands({ cache, identity, client, isCurrent, clock, inheritedConfig }: {
  cache: QueryClient;
  identity: QueryIdentity;
  client: ScopedOpencodeClient;
  isCurrent: () => boolean;
  clock: () => number;
  inheritedConfig: () => SessionChatConfig;
}) {
  const catalog = sessionCatalogAccess(cache, identity, client);

  async function publishCreated(work: () => Promise<Session>, scopeError: string) {
    let created: Session | undefined;
    const mutation = new MutationObserver(cache, {
      mutationKey: creationKey(identity, client),
      retry: false,
      networkMode: 'always',
      gcTime: CREATE_GRACE_MS,
      mutationFn: async () => {
        if (!isCurrent()) throw new Error(scopeError);
        created = await work();
        if (!isCurrent()) throw new Error(scopeError);
        return { sessionId: created.id, recordedAt: clock() } satisfies Creation;
      },
    });
    const unsubscribe = mutation.subscribe(() => {});
    try { await mutation.mutate(undefined); } finally { unsubscribe(); }
    if (!created || !isCurrent()) throw new Error(scopeError);
    const session = created;
    catalog.setSessions((current) => [session, ...current.filter(({ id }) => id !== session.id)]);
    catalog.setSessionStatuses((current) => ({ ...current, [session.id]: { type: 'idle' } }));
    return session;
  }

  return {
    createSession(title?: string) {
      const error = 'The active project changed before the session was created.';
      return publishCreated(async () => {
        const created = await createRemoteSession(client, {
          ...(title?.trim() ? { title: title.trim() } : {}),
          ...inheritedConfig(),
        });
        if (!created) throw new Error('OpenCode did not return the created session.');
        if (!isCurrent()) throw new Error(error);
        return created;
      }, error);
    },
    forkSession(sessionId: string, messageId?: string) {
      return publishCreated(async () => {
        const forked = await forkRemoteSession(client, sessionId, messageId);
        if (!forked) throw new Error('OpenCode did not return the forked session.');
        return forked;
      }, 'The active project changed before the session was forked.');
    },
  };
}
