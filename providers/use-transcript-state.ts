import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import {
  hasTodoWritePart,
  mergeSessionMessageWindow,
  prependSessionMessageHistory,
  type SessionMessageRecord,
} from '@/lib/opencode/format';
import { addUsageSteps, type SessionUsageStep } from '@/lib/opencode/usage';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import {
  getSessionMessages as svcGetSessionMessages,
  HISTORY_PAGE_LIMIT,
  INITIAL_MESSAGE_LIMIT,
} from '@/providers/services/session-service';

// Bounds the in-memory transcript window: the newest live tail plus the older
// pages the user pulls in by scrolling up. Dropping the oldest records keeps
// the window contiguous and the working set small.
const MESSAGE_WINDOW_CAP = 200;
// How many pages a tail sync may page back to bridge a burst of new messages
// before it gives up and adopts the fetched tail authoritatively.
const MAX_TAIL_BRIDGE_PAGES = 5;

type MessageWindow = { nextBefore?: string; hasMore: boolean };

// Owns the paginated transcript window for every session: the loaded messages
// are held by the provider, while this hook owns the pagination cursors, and
// accumulates completed model calls and V2 plan records so a bounded window
// still yields exact session usage and todos.
export function useTranscriptState({
  client,
  isCurrentClient,
  messagesBySession,
  setMessagesBySession,
  setIsRefreshingMessages,
}: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  setMessagesBySession: Dispatch<SetStateAction<Record<string, SessionMessageRecord[]>>>;
  setIsRefreshingMessages: Dispatch<SetStateAction<boolean>>;
}) {
  const [messageWindows, setMessageWindows] = useState<Record<string, MessageWindow>>({});
  const [loadingOlderBySession, setLoadingOlderBySession] = useState<Record<string, boolean>>({});
  const [usageStepsBySession, setUsageStepsBySession] = useState<Record<string, SessionUsageStep[]>>({});
  const [todoRecordsBySession, setTodoRecordsBySession] = useState<Record<string, SessionMessageRecord[]>>({});

  const messagesBySessionRef = useRef(messagesBySession);
  const messageWindowsRef = useRef(messageWindows);
  const loadingOlderBySessionRef = useRef(loadingOlderBySession);
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

  const refreshMessages = useCallback(
    async (sessionId: string, silent = false, options?: { full?: boolean }) => {
      if (!silent) {
        setIsRefreshingMessages(true);
      }
      try {
        const held = messagesBySessionRef.current[sessionId] ?? [];
        const isInitialLoad = options?.full === true || held.length === 0;

        if (isInitialLoad) {
          // Cold load: fetch only the newest page. Older history is requested
          // lazily as the user scrolls up.
          const page = await svcGetSessionMessages(client, sessionId, { limit: INITIAL_MESSAGE_LIMIT });
          if (!isCurrentClient(client)) {
            return page.records;
          }
          setMessagesBySession((current) => ({ ...current, [sessionId]: page.records }));
          setMessageWindows((current) => ({
            ...current,
            [sessionId]: { nextBefore: page.nextBefore, hasMore: page.hasMore },
          }));
          recordUsageAndTodos(sessionId, page.records);
          return page.records;
        }

        // Tail sync: fetch the newest page, then bridge backwards until it
        // overlaps already-held records (or the bridge cap is reached) so a
        // burst of new messages cannot leave a gap.
        const knownIds = new Set(held.map((record) => record.info.id));
        const olderPages: SessionMessageRecord[][] = [];
        let before: string | undefined;
        let resolved = false;
        let oldestNextBefore: string | undefined;
        let oldestHasMore = false;

        for (let pageIndex = 0; pageIndex < MAX_TAIL_BRIDGE_PAGES; pageIndex += 1) {
          const page = await svcGetSessionMessages(client, sessionId, { limit: HISTORY_PAGE_LIMIT, before });
          if (!isCurrentClient(client)) {
            return held;
          }
          if (page.records.length === 0) {
            resolved = true;
            break;
          }
          olderPages.unshift(page.records);
          oldestNextBefore = page.nextBefore;
          oldestHasMore = page.hasMore;
          const overlaps = page.records.some((record) => knownIds.has(record.info.id));
          if (overlaps || !page.hasMore || page.records.length < HISTORY_PAGE_LIMIT) {
            resolved = true;
            break;
          }
          before = page.nextBefore;
        }

        const fetched = olderPages.flat();
        if (fetched.length === 0) {
          return held;
        }

        if (!resolved) {
          // A gap larger than the bridge window: adopt the fetched tail and
          // restart history paging from its oldest page.
          const nextRecords = fetched.length > MESSAGE_WINDOW_CAP ? fetched.slice(fetched.length - MESSAGE_WINDOW_CAP) : fetched;
          setMessagesBySession((current) => ({ ...current, [sessionId]: nextRecords }));
          setMessageWindows((current) => ({ ...current, [sessionId]: { nextBefore: oldestNextBefore, hasMore: oldestHasMore } }));
          recordUsageAndTodos(sessionId, fetched);
          return fetched;
        }

        setMessagesBySession((current) => {
          const previous = current[sessionId] ?? held;
          const merged = mergeSessionMessageWindow(previous, fetched);
          const bounded = merged.length > MESSAGE_WINDOW_CAP ? merged.slice(merged.length - MESSAGE_WINDOW_CAP) : merged;
          if (bounded === previous) {
            return current;
          }
          return { ...current, [sessionId]: bounded };
        });
        recordUsageAndTodos(sessionId, fetched);
        return fetched;
      } finally {
        if (!silent) {
          setIsRefreshingMessages(false);
        }
      }
    },
    [client, isCurrentClient, recordUsageAndTodos, setIsRefreshingMessages, setMessagesBySession],
  );

  const loadOlderMessages = useCallback(
    async (sessionId: string) => {
      const meta = messageWindowsRef.current[sessionId];
      const held = messagesBySessionRef.current[sessionId] ?? [];
      if (!meta?.hasMore || loadingOlderBySessionRef.current[sessionId] || held.length >= MESSAGE_WINDOW_CAP) {
        return;
      }

      setLoadingOlderBySession((current) => ({ ...current, [sessionId]: true }));
      try {
        const page = await svcGetSessionMessages(client, sessionId, { limit: HISTORY_PAGE_LIMIT, before: meta.nextBefore });
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
    setUsageStepsBySession({});
    setTodoRecordsBySession({});
  }, []);

  // Drop pagination, usage, and plan state for sessions that are no longer kept
  // in memory, mirroring the provider's transcript-cache pruning.
  const prune = useCallback((keepIds: Set<string>, limit: number) => {
    const pruneMap = <T,>(current: Record<string, T>): Record<string, T> => {
      const keys = Object.keys(current);
      if (keys.length <= limit) {
        return current;
      }
      const next: Record<string, T> = {};
      for (const key of keys) {
        if (keepIds.has(key)) next[key] = current[key];
      }
      return next;
    };
    setMessageWindows((current) => pruneMap(current));
    setUsageStepsBySession((current) => pruneMap(current));
    setTodoRecordsBySession((current) => pruneMap(current));
  }, []);

  return {
    messageWindows,
    loadingOlderBySession,
    usageStepsBySession,
    todoRecordsBySession,
    refreshMessages,
    loadOlderMessages,
    reset,
    prune,
  };
}

export { MESSAGE_WINDOW_CAP };
