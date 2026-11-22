import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { getSessionMessages } from '@/shared/protocol/services/session-service';

import { transcriptKey } from '../services/queries';
import { transcriptAccess, transcriptQueryOptions, type TranscriptData } from '../services/transcript-queries';

vi.mock('@/shared/i18n/index', () => ({ getFormatLocale: () => 'en' }));
vi.mock('@/shared/protocol/opencode/client', () => ({ withReadSignal: (client: ScopedOpencodeClient) => client }));
vi.mock('@/shared/protocol/services/session-service', () => ({
  getSessionMessages: vi.fn(),
  MAX_MESSAGE_PAGE_LIMIT: 200,
}));

const identity = { connectionId: 'server', connectionScope: 'scope', authRevision: 2 };
const client = { __opencode: { contract: 'v2', directory: '/project' } } as ScopedOpencodeClient;
const session = 'chat';
const record = (id: string, created: number): SessionMessageRecord =>
  ({ info: { id, sessionID: session, role: 'user', time: { created } }, parts: [] }) as SessionMessageRecord;
const newest = { records: [record('first', 2), record('newest', 3)], hasMore: true, nextBefore: 'cursor' };
const older = { records: [record('oldest', 1), record('first', 2)], hasMore: true, nextBefore: 'next' };

describe('session transcript infinite queries', () => {
  it('follows the server cursor and deduplicates the boundary between pages', async () => {
    const cache = new QueryClient();
    vi.mocked(getSessionMessages).mockResolvedValueOnce(newest).mockResolvedValueOnce(older);
    const options = transcriptQueryOptions(identity, client, session);
    const observer = new InfiniteQueryObserver(cache, { ...options, enabled: false });
    await observer.refetch();
    await observer.fetchNextPage();
    const key = transcriptKey(identity, client, session);
    expect(cache.getQueryData<TranscriptData>(key)?.pageParams).toEqual([null, 'cursor']);
    expect(transcriptAccess(cache, identity, client).read(session).map(({ info }) => info.id)).toEqual(['oldest', 'first', 'newest']);
    expect(getSessionMessages).toHaveBeenLastCalledWith(client, session, { limit: 200, before: 'cursor' });
    observer.destroy();
    cache.clear();
  });

  it('preserves loaded history on a tail write and keeps projects and credentials isolated', () => {
    const cache = new QueryClient();
    const access = transcriptAccess(cache, identity, client);
    access.replace(session, newest);
    access.appendOlder(session, 'cursor', older);
    access.update(session, (records) => [...records, record('tail', 4)]);
    expect(access.read(session).map(({ info }) => info.id)).toEqual(['oldest', 'first', 'newest', 'tail']);
    expect(access.window(session)).toEqual({ hasMore: true, nextBefore: 'next' });
    expect(transcriptAccess(cache, { ...identity, authRevision: 3 }, client).read(session)).toEqual([]);
    expect(transcriptAccess(cache, identity, { ...client, __opencode: { ...client.__opencode, directory: '/other' } }).read(session)).toEqual([]);
    expect(cache.getQueryCache().find({ queryKey: transcriptKey(identity, client, session) })?.gcTime).toBe(45 * 60 * 1000);
    cache.clear();
  });

  it('rejects an older page from the window replaced while it was in flight', () => {
    const cache = new QueryClient();
    const access = transcriptAccess(cache, identity, client);
    access.replace(session, newest);
    access.replace(session, { records: [record('replacement', 4)], hasMore: true, nextBefore: 'replacement-cursor' });
    access.appendOlder(session, 'cursor', older);
    expect(access.read(session).map(({ info }) => info.id)).toEqual(['replacement']);
    expect(access.window(session)?.nextBefore).toBe('replacement-cursor');
    cache.clear();
  });
});
