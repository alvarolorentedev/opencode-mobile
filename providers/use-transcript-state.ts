import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import {
  hasTodoWritePart,
  mergeSessionMessageWindow,
  prependSessionMessageHistory,
  toTranscriptEntry,
  type SessionMessageRecord,
} from '@/lib/opencode/format';
import { isTranscriptDisplayMessage, type TranscriptVerbosity } from '@/lib/opencode/transcript';
import { addUsageSteps, type SessionUsageStep } from '@/lib/opencode/usage';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { TranscriptRefreshMode } from '@/providers/opencode-provider-types';
import { pruneByKeepIds } from '@/providers/opencode-provider-utils';
import {
  getSessionMessages as svcGetSessionMessages,
  TRANSCRIPT_PAGE_LIMIT,
} from '@/providers/services/session-service';

// Hard ceiling on the in-memory transcript window. Retention keeps at least
// DISPLAYED_MESSAGE_TARGET visible entries inside this bound.
export const MAX_TRANSCRIPT_RECORDS = 300;
// The initial pull must show at least this many entries at the current
// verbosity, even when a long tool-only turn fills the newest page.
export const DISPLAYED_MESSAGE_TARGET = 10;
// Older pages fetched while scanning a tool-heavy tail. Larger than the scroll
// page so the scan needs fewer round trips.
const BACKFILL_PAGE_LIMIT = 50;
const MAX_BACKFILL_PAGES = 4;

type MessageWindow = { nextBefore?: string; hasMore: boolean };

function countDisplayed(records: SessionMessageRecord[], verbosity: TranscriptVerbosity) {
  let count = 0;
  for (const record of records) {
    if (isTranscriptDisplayMessage(toTranscriptEntry(record), verbosity)) {
      count += 1;
    }
  }
  return count;
}

// Drop the oldest records at the hard ceiling, discarding non-display records
// first so conversation entries survive even after a very long tool-only run.
function boundWindow(records: SessionMessageRecord[], verbosity: TranscriptVerbosity) {
  let overflow = records.length - MAX_TRANSCRIPT_RECORDS;
  if (overflow <= 0) {
    return records;
  }

  const remove = new Set<number>();
  for (let index = 0; index < records.length && overflow > 0; index += 1) {
    if (!isTranscriptDisplayMessage(toTranscriptEntry(records[index]), verbosity)) {
      remove.add(index);
      overflow -= 1;
    }
  }
  for (let index = 0; index < records.length && overflow > 0; index += 1) {
    if (!remove.has(index)) {
      remove.add(index);
      overflow -= 1;
    }
  }

  return records.filter((_record, index) => !remove.has(index));
}

// Owns the paginated transcript window for every session: the loaded messages
// are held by the provider, while this hook owns the pagination cursors, and
// accumulates completed model calls and V2 plan records so a bounded window
// retains observed call usage and todos without requiring unbounded history reads.
export function useTranscriptState({
  client,
  isCurrentClient,
  currentSessionId,
  transcriptVerbosity,
  messagesBySession,
  setMessagesBySession,
  setIsRefreshingMessages,
}: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  currentSessionId?: string;
  transcriptVerbosity: TranscriptVerbosity;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  setMessagesBySession: Dispatch<SetStateAction<Record<string, SessionMessageRecord[]>>>;
  setIsRefreshingMessages: Dispatch<SetStateAction<boolean>>;
}) {
  const [messageWindows, setMessageWindows] = useState<Record<string, MessageWindow>>({});
  const [loadingOlderBySession, setLoadingOlderBySession] = useState<Record<string, boolean>>({});
  const [hydratingSessionIds, setHydratingSessionIds] = useState<Record<string, boolean>>({});
  const [usageStepsBySession, setUsageStepsBySession] = useState<Record<string, SessionUsageStep[]>>({});
  const [todoRecordsBySession, setTodoRecordsBySession] = useState<Record<string, SessionMessageRecord[]>>({});

  const messagesBySessionRef = useRef(messagesBySession);
  const messageWindowsRef = useRef(messageWindows);
  const loadingOlderBySessionRef = useRef(loadingOlderBySession);
  const hydrationRequestRef = useRef<Record<string, number>>({});
  useLayoutEffect(() => {
    messagesBySessionRef.current = messagesBySession;
    messageWindowsRef.current = messageWindows;
    loadingOlderBySessionRef.current = loadingOlderBySession;
  });

  const recordUsageAndTodos = useCallback((sessionId: string, records: SessionMessageRecord[]) => {
    if (records.length === 0) {
      return;
    }

    setUsageStepsBySession((current) => {
      const steps = new Map((current[sessionId] ?? []).map((step) => [step.key, step] as const));
      if (!addUsageSteps(steps, records)) {
        return current;
      }
      return { ...current, [sessionId]: [...steps.values()] };
    });

    const todoRecords = records.filter(hasTodoWritePart);
    if (todoRecords.length > 0) {
      setTodoRecordsBySession((current) => {
        const existing = current[sessionId] ?? [];
        const merged = mergeSessionMessageWindow(existing, todoRecords);
        if (merged === existing) return current;
        // Older pages arrive after the newest page; plan writes must still be chronological.
        return { ...current, [sessionId]: merged.sort((left, right) => left.info.time.created - right.info.time.created) };
      });
    }
  }, []);

  // A cold window starts from the newest page and pages backward until the
  // display target is met. Normal sessions stop after the first page.
  const loadDisplayedWindow = useCallback(
    async (sessionId: string, first: { records: SessionMessageRecord[]; nextBefore?: string; hasMore: boolean }) => {
      let records = first.records;
      let nextBefore = first.nextBefore;
      let hasMore = first.hasMore;
      let displayed = countDisplayed(records, transcriptVerbosity);
      let pages = 0;

      while (displayed < DISPLAYED_MESSAGE_TARGET && hasMore && pages < MAX_BACKFILL_PAGES) {
        const older = await svcGetSessionMessages(client, sessionId, { limit: BACKFILL_PAGE_LIMIT, before: nextBefore });
        if (!isCurrentClient(client)) {
          return undefined;
        }
        pages += 1;
        if (older.records.length === 0) {
          hasMore = false;
          break;
        }
        records = [...older.records, ...records];
        displayed += countDisplayed(older.records, transcriptVerbosity);
        nextBefore = older.nextBefore;
        hasMore = older.hasMore;
        if (!older.nextBefore) break;
      }

      return { records: boundWindow(records, transcriptVerbosity), nextBefore, hasMore };
    },
    [client, isCurrentClient, transcriptVerbosity],
  );

  // Backfill an already-held window (verbosity changes can hide entries that
  // were counted before).
  const backfillDisplayed = useCallback(
    async (sessionId: string) => {
      const held = messagesBySessionRef.current[sessionId] ?? [];
      const meta = messageWindowsRef.current[sessionId];
      if (held.length === 0 || !meta?.hasMore) {
        return;
      }

      let displayed = countDisplayed(held, transcriptVerbosity);
      if (displayed >= DISPLAYED_MESSAGE_TARGET) {
        return;
      }

      let nextBefore = meta.nextBefore;
      let hasMore: boolean = meta.hasMore;
      let pages = 0;
      const fetched: SessionMessageRecord[][] = [];
      while (displayed < DISPLAYED_MESSAGE_TARGET && hasMore && pages < MAX_BACKFILL_PAGES) {
        const older = await svcGetSessionMessages(client, sessionId, { limit: BACKFILL_PAGE_LIMIT, before: nextBefore });
        if (!isCurrentClient(client)) {
          return;
        }
        pages += 1;
        if (older.records.length === 0) {
          hasMore = false;
          break;
        }
        fetched.unshift(older.records);
        displayed += countDisplayed(older.records, transcriptVerbosity);
        nextBefore = older.nextBefore;
        hasMore = older.hasMore;
        if (!older.nextBefore) break;
      }

      if (fetched.length === 0) {
        return;
      }

      const flat = fetched.flat();
      setMessagesBySession((current) => {
        const previous = current[sessionId] ?? held;
        const prepended = prependSessionMessageHistory(previous, flat);
        if (prepended === previous) {
          return current;
        }
        return { ...current, [sessionId]: prepended };
      });
      setMessageWindows((current) => ({
        ...current,
        [sessionId]: { nextBefore, hasMore },
      }));
      recordUsageAndTodos(sessionId, flat);
    },
    [client, isCurrentClient, recordUsageAndTodos, transcriptVerbosity, setMessagesBySession],
  );

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }
    void backfillDisplayed(currentSessionId).catch(() => undefined);
  }, [backfillDisplayed, currentSessionId]);

  const refreshMessages = useCallback(
    async (sessionId: string, silent = false, options?: { mode?: TranscriptRefreshMode }) => {
      const held = messagesBySessionRef.current[sessionId] ?? [];
      const shouldHydrate = !silent || held.length === 0;
      let hydrationRequest: number | undefined;
      if (shouldHydrate) {
        hydrationRequest = (hydrationRequestRef.current[sessionId] ?? 0) + 1;
        hydrationRequestRef.current[sessionId] = hydrationRequest;
        setHydratingSessionIds((current) => (
          current[sessionId] ? current : { ...current, [sessionId]: true }
        ));
      }
      if (!silent) {
        setIsRefreshingMessages(true);
      }
      try {
        // Default to a cold load when nothing is held, otherwise merge the
        // newest page into what we have. A requested mode overrides the default.
        const mode: TranscriptRefreshMode = options?.mode ?? (held.length === 0 ? 'initial' : 'tail');

        // initial, replace, and a cold tail all fetch exactly one newest page.
        // History only grows through loadOlderMessages on an explicit scroll.
        const page = await svcGetSessionMessages(client, sessionId, { limit: TRANSCRIPT_PAGE_LIMIT });
        if (!isCurrentClient(client)) {
          return page.records;
        }

        // initial and replace adopt a fresh window. Only replace discards a held
        // window on purpose (compaction/revert); an explicit initial on an
        // already-held window is treated the same. A fresh window backfills to
        // the displayed target so a tool-heavy tail cannot leave it blank.
        if (mode !== 'tail' || held.length === 0) {
          const loaded = await loadDisplayedWindow(sessionId, page);
          if (!loaded) {
            return page.records;
          }
          setMessagesBySession((current) => ({ ...current, [sessionId]: loaded.records }));
          setMessageWindows((current) => ({
            ...current,
            [sessionId]: { nextBefore: loaded.nextBefore, hasMore: loaded.hasMore },
          }));
          recordUsageAndTodos(sessionId, loaded.records);
          return loaded.records;
        }

        if (page.records.length === 0) {
          return held;
        }

        const knownIds = new Set(held.map((record) => record.info.id));
        if (!page.records.some((record) => knownIds.has(record.info.id))) {
          // A burst larger than one page landed; adopt the contiguous newest
          // page (backfilled to the displayed target) and restart history
          // paging from its oldest record instead of downloading bridging pages.
          const loaded = await loadDisplayedWindow(sessionId, page);
          if (!loaded) {
            return page.records;
          }
          setMessagesBySession((current) => ({ ...current, [sessionId]: loaded.records }));
          setMessageWindows((current) => ({
            ...current,
            [sessionId]: { nextBefore: loaded.nextBefore, hasMore: loaded.hasMore },
          }));
          recordUsageAndTodos(sessionId, loaded.records);
          return loaded.records;
        }

        setMessagesBySession((current) => {
          const previous = current[sessionId] ?? held;
          const merged = mergeSessionMessageWindow(previous, page.records);
          const bounded = boundWindow(merged, transcriptVerbosity);
          if (bounded === previous) {
            return current;
          }
          return { ...current, [sessionId]: bounded };
        });
        recordUsageAndTodos(sessionId, page.records);
        return page.records;
      } finally {
        if (!silent) {
          setIsRefreshingMessages(false);
        }
        if (hydrationRequest !== undefined && hydrationRequestRef.current[sessionId] === hydrationRequest) {
          delete hydrationRequestRef.current[sessionId];
          setHydratingSessionIds((current) => (
            current[sessionId] ? { ...current, [sessionId]: false } : current
          ));
        }
      }
    },
    [client, isCurrentClient, loadDisplayedWindow, recordUsageAndTodos, setIsRefreshingMessages, setMessagesBySession, transcriptVerbosity],
  );

  const loadOlderMessages = useCallback(
    async (sessionId: string) => {
      const meta = messageWindowsRef.current[sessionId];
      const held = messagesBySessionRef.current[sessionId] ?? [];
      if (!meta?.hasMore || loadingOlderBySessionRef.current[sessionId] || held.length >= MAX_TRANSCRIPT_RECORDS) {
        return;
      }

      setLoadingOlderBySession((current) => ({ ...current, [sessionId]: true }));
      try {
        const page = await svcGetSessionMessages(client, sessionId, { limit: TRANSCRIPT_PAGE_LIMIT, before: meta.nextBefore });
        if (!isCurrentClient(client)) {
          return;
        }
        setMessagesBySession((current) => {
          const previous = current[sessionId] ?? held;
          const prepended = prependSessionMessageHistory(previous, page.records);
          if (prepended === previous) {
            return current;
          }
          return { ...current, [sessionId]: prepended };
        });
        setMessageWindows((current) => ({
          ...current,
          [sessionId]: { nextBefore: page.nextBefore, hasMore: page.hasMore },
        }));
        recordUsageAndTodos(sessionId, page.records);
      } finally {
        setLoadingOlderBySession((current) => ({ ...current, [sessionId]: false }));
      }
    },
    [client, isCurrentClient, recordUsageAndTodos, setMessagesBySession],
  );

  const reset = useCallback(() => {
    setMessageWindows({});
    setLoadingOlderBySession({});
    setHydratingSessionIds({});
    setUsageStepsBySession({});
    setTodoRecordsBySession({});
    hydrationRequestRef.current = {};
  }, []);

  // Drop pagination, usage, and plan state for sessions that are no longer kept
  // in memory, mirroring the provider's transcript-cache pruning.
  const prune = useCallback((keepIds: Set<string>, limit: number) => {
    setMessageWindows((current) => pruneByKeepIds(current, keepIds, limit));
    setUsageStepsBySession((current) => pruneByKeepIds(current, keepIds, limit));
    setTodoRecordsBySession((current) => pruneByKeepIds(current, keepIds, limit));
  }, []);

  return {
    messageWindows,
    loadingOlderBySession,
    hydratingSessionIds,
    usageStepsBySession,
    todoRecordsBySession,
    refreshMessages,
    loadOlderMessages,
    reset,
    prune,
  };
}
