import { infiniteQueryOptions, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { prependSessionMessageHistory, type SessionMessageRecord } from '@/shared/presentation/format';
import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { getSessionMessages, MAX_MESSAGE_PAGE_LIMIT, type SessionMessagePage } from '@/shared/protocol/services/session-service';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { transcriptKey, transcriptPrefix } from './queries';

const TRANSCRIPT_GC_TIME = 45 * 60 * 1000;
const EMPTY_RECORDS: SessionMessageRecord[] = [];

export type TranscriptPage = SessionMessagePage & { restored?: true };
export type TranscriptData = InfiniteData<TranscriptPage, string | null>;

export function transcriptQueryOptions(identity: QueryIdentity, client: ScopedOpencodeClient, sessionId: string) {
  return infiniteQueryOptions({
    queryKey: transcriptKey(identity, client, sessionId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }): Promise<TranscriptPage> =>
      getSessionMessages(withReadSignal(client, signal), sessionId, {
        limit: MAX_MESSAGE_PAGE_LIMIT, before: pageParam ?? undefined,
      }),
    getNextPageParam: (page) => page.hasMore && !page.restored ? page.nextBefore : undefined,
    gcTime: TRANSCRIPT_GC_TIME,
  });
}

const flattened = new WeakMap<InfiniteData<TranscriptPage>, SessionMessageRecord[]>();

export function transcriptRecords(data: InfiniteData<TranscriptPage> | undefined): SessionMessageRecord[] {
  if (!data?.pages.length) return EMPTY_RECORDS;
  if (data.pages.length === 1) return data.pages[0].records;
  const held = flattened.get(data);
  if (held) return held;
  let records = data.pages[0].records;
  for (const page of data.pages.slice(1)) records = prependSessionMessageHistory(records, page.records);
  flattened.set(data, records);
  return records;
}

export function transcriptWindow(data: InfiniteData<TranscriptPage> | undefined) {
  const page = data?.pages.at(-1);
  return page && !page.restored ? { nextBefore: page.nextBefore, hasMore: page.hasMore } : undefined;
}

// Keep the original page parameters while replacing or inserting records from a
// bounded tail read. Known records anchor their pages in chronological order.
function updateRecords(data: TranscriptData, next: SessionMessageRecord[]): TranscriptData {
  if (data.pages.length === 1) return { ...data, pages: [{ ...data.pages[0], records: next }] };
  const pageByRecord = new Map<string, number>();
  for (let index = data.pages.length - 1; index >= 0; index -= 1) {
    for (const record of data.pages[index].records) pageByRecord.set(record.info.id, index);
  }
  const pages = data.pages.map((page) => ({ ...page, records: [] as SessionMessageRecord[] }));
  let pageIndex = pages.length - 1;
  for (const record of next) {
    pageIndex = pageByRecord.get(record.info.id) ?? pageIndex;
    pages[pageIndex].records.push(record);
  }
  return { ...data, pages };
}

export function transcriptAccess(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient) {
  const key = (id: string) => transcriptKey(identity, client, id);
  const read = (id: string) => cache.getQueryData<TranscriptData>(key(id));
  const register = (id: string) => cache.getQueryCache().build(cache, { queryKey: key(id), gcTime: TRANSCRIPT_GC_TIME });
  const replace = (id: string, page: TranscriptPage) => {
    register(id);
    cache.setQueryData<TranscriptData>(key(id), { pages: [page], pageParams: [null] });
  };

  return {
    read: (id: string) => transcriptRecords(read(id)),
    window: (id: string) => transcriptWindow(read(id)),
    options: (id: string) => transcriptQueryOptions(identity, client, id),
    replace,
    restore(id: string, records: SessionMessageRecord[]) {
      if (!read(id)?.pages.length && records.length) replace(id, { records, hasMore: false, restored: true });
    },
    update(id: string, change: (records: SessionMessageRecord[]) => SessionMessageRecord[], initializeFrom?: SessionMessagePage) {
      register(id);
      cache.setQueryData<TranscriptData>(key(id), (current) => {
        const previous = transcriptRecords(current);
        const next = change(previous);
        if (!current || current.pages[0]?.restored) {
          if (initializeFrom) return { pages: [{ ...initializeFrom, records: next }], pageParams: [null] };
          if (next === previous) return current;
          return { pages: [{ records: next, hasMore: false, restored: true }], pageParams: [null] };
        }
        return next === previous ? current : updateRecords(current, next);
      });
    },
    appendOlder(id: string, cursor: string, page: SessionMessagePage) {
      cache.setQueryData<TranscriptData>(key(id), (current) => {
        if (!current || transcriptWindow(current)?.nextBefore !== cursor) return current;
        return { pages: [...current.pages, page], pageParams: [...current.pageParams, cursor] };
      });
    },
    prune(keep: Set<string>, limit: number) {
      const prefix = transcriptPrefix(identity, client);
      const loaded = cache.getQueryCache().findAll({ queryKey: prefix }).filter(({ state }) => state.data !== undefined);
      if (loaded.length <= limit) return;
      for (const query of loaded) {
        if (!keep.has(String(query.queryKey[prefix.length])) && query.getObserversCount() === 0) {
          cache.removeQueries({ queryKey: query.queryKey, exact: true });
        }
      }
    },
  };
}
