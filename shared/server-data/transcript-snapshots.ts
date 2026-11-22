import type { QueryKey } from '@tanstack/react-query';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

import type { SessionMessageRecord } from '@/shared/presentation/format/types';

export const TRANSCRIPT_SNAPSHOT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const CATALOG_SNAPSHOT_MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 64;
const MAX_RECORDS = 24;
const MAX_SESSION_CHARS = 200_000;
const MAX_TRANSCRIPT_CHARS = 400_000;

export function isTranscriptQueryKey(key: QueryKey) {
  return key.length === 9 && key[0] === 'opencode'
    && typeof key[1] === 'string' && typeof key[2] === 'string' && typeof key[3] === 'number'
    && typeof key[4] === 'string' && key[5] === 'project' && typeof key[6] === 'string'
    && key[7] === 'transcript' && typeof key[8] === 'string' && key[8].length > 0;
}

// Scan bounded candidates before JSON serialization. This also covers file
// parts nested inside tool output, where checking only top-level URLs misses
// inline data. A rejected large record is never stringified.
function safeSnapshotValue(value: unknown, limit: number) {
  let chars = 0;
  const pending = [value];
  while (pending.length) {
    const entry = pending.pop();
    if (typeof entry === 'string') {
      chars += entry.length;
      if (chars > limit || /^(?:data|blob):/i.test(entry)) return false;
    } else if (entry && typeof entry === 'object') {
      for (const [name, child] of Object.entries(entry)) {
        chars += name.length + 4;
        if (chars > limit) return false;
        pending.push(child);
      }
    } else {
      chars += 8;
    }
    if (chars > limit) return false;
  }
  return true;
}

type Page = { records: SessionMessageRecord[] };

export function compactTranscriptSnapshot(pages: readonly Page[], limit = MAX_SESSION_CHARS, sessionId?: string) {
  const newest: SessionMessageRecord[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const page of pages) {
    if (!Array.isArray(page?.records)) break;
    for (let index = page.records.length - 1; index >= 0; index -= 1) {
      const record = page.records[index];
      const id = record?.info?.id;
      if (typeof id !== 'string' || !id
        || (record.info.role !== 'user' && record.info.role !== 'assistant')
        || !Number.isFinite(record.info.time?.created) || !Array.isArray(record.parts)
        || (sessionId && record.info.sessionID !== sessionId)) return { records: newest.reverse(), chars };
      if (seen.has(id)) continue;
      const parts = record.parts.filter((part) => part && typeof part.type === 'string' && safeSnapshotValue(part, limit));
      if (record.parts.length > 0 && parts.length === 0) return { records: newest.reverse(), chars };
      const selected = parts.length === record.parts.length ? record : { ...record, parts };
      if (!safeSnapshotValue(selected, limit - chars)) return { records: newest.reverse(), chars };
      const size = JSON.stringify(selected).length;
      if (chars + size > limit) return { records: newest.reverse(), chars };
      newest.push(selected);
      seen.add(id);
      chars += size;
      if (newest.length === MAX_RECORDS) return { records: newest.reverse(), chars };
    }
  }
  return { records: newest.reverse(), chars };
}

export function projectPersistedServerData(snapshot: PersistedClient, now = Date.now()): PersistedClient {
  const { queries } = snapshot.clientState;
  const catalogs = now - snapshot.timestamp <= CATALOG_SNAPSHOT_MAX_AGE
    ? queries.filter(({ queryKey }) => !isTranscriptQueryKey(queryKey))
    : [];
  const transcripts = queries.filter(({ queryKey, state }) =>
    isTranscriptQueryKey(queryKey) && now - state.dataUpdatedAt <= TRANSCRIPT_SNAPSHOT_MAX_AGE)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt).slice(0, MAX_SESSIONS);
  let remaining = MAX_TRANSCRIPT_CHARS;
  for (const query of transcripts) {
    if (remaining <= 0) break;
    const data = query.state.data as { pages?: Page[] } | undefined;
    if (!Array.isArray(data?.pages)) continue;
    const { records, chars } = compactTranscriptSnapshot(data.pages, Math.min(remaining, MAX_SESSION_CHARS), String(query.queryKey[8]));
    if (!records.length) continue;
    remaining -= chars;
    catalogs.push({
      ...query,
      state: { ...query.state, data: { pages: [{ records, hasMore: false, restored: true }], pageParams: [null] } },
    });
  }
  return { ...snapshot, clientState: { ...snapshot.clientState, queries: catalogs } };
}
