import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import {
  hasTodoWritePart,
  mergeSessionMessageWindow,
  prependSessionMessageHistory,
  type SessionMessageRecord,
} from '@/lib/opencode/format';
import { addUsageSteps, type SessionUsageStep } from '@/lib/opencode/usage';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { TranscriptRefreshMode } from '@/providers/opencode-provider-types';
import { pruneByKeepIds } from '@/providers/opencode-provider-utils';
import {
  getSessionMessages as svcGetSessionMessages,
  TRANSCRIPT_PAGE_LIMIT,
} from '@/providers/services/session-service';

// Bounds the in-memory transcript window: the newest live tail plus the older
// pages the user pulls in by scrolling up. Dropping the oldest records keeps
// the window contiguous and the working set small.
const MESSAGE_WINDOW_CAP = 100;

type MessageWindow = { nextBefore?: string; hasMore: boolean };

// Owns the paginated transcript window for every session: the loaded messages
// are held by the provider, while this hook owns the pagination cursors, and
// accumulates completed model calls and V2 plan records so a bounded window
// retains observed call usage and todos without requiring unbounded history reads.
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
    async (sessionId: string, silent = false, options?: { mode?: TranscriptRefreshMode }) => {
      if (!silent) {
        setIsRefreshingMessages(true);
      }
      try {
        const held = messagesBySessionRef.current[sessionId] ?? [];
        // Default to a cold load when nothing is held, otherwise merge the
        // newest page into what we have. A requested mode overrides the default.
        const mode: TranscriptRefreshMode = options?.mode ?? (held.length === 0 ? 'initial' : 'tail');

        // initial, replace, and a cold tail all fetch exactly one newest page.
        // History only grows through loadOlderMessages on an explicit scroll.
        const page = await svcGetSessionMessages(client, sessionId, { limit: TRANSCRIPT_PAGE_LIMIT });
        if (!isCurrentClient(client)) {
          return page.records;
        }

        // initial and replace adopt the fetched page as the window. Only replace
        // discards a held window on purpose (compaction/revert); an explicit
        // initial on an already-held window is treated the same.
        if (mode !== 'tail' || held.length === 0) {
          setMessagesBySession((current) => ({ ...current, [sessionId]: page.records }));
          setMessageWindows((current) => ({
            ...current,
            [sessionId]: { nextBefore: page.nextBefore, hasMore: page.hasMore },
          }));
          recordUsageAndTodos(sessionId, page.records);
          return page.records;
        }

        if (page.records.length === 0) {
          return held;
        }

        const knownIds = new Set(held.map((record) => record.info.id));
        if (!page.records.some((record) => knownIds.has(record.info.id))) {
          // A burst larger than one page landed; adopt the contiguous newest
          // page and restart history paging from its oldest record instead of
          // downloading bridging pages.
          const nextRecords = page.records.length > MESSAGE_WINDOW_CAP ? page.records.slice(page.records.length - MESSAGE_WINDOW_CAP) : page.records;
          setMessagesBySession((current) => ({ ...current, [sessionId]: nextRecords }));
          setMessageWindows((current) => ({
            ...current,
            [sessionId]: { nextBefore: page.nextBefore, hasMore: page.hasMore },
          }));
          recordUsageAndTodos(sessionId, page.records);
          return page.records;
        }

        setMessagesBySession((current) => {
          const previous = current[sessionId] ?? held;
          const merged = mergeSessionMessageWindow(previous, page.records);
          const bounded = merged.length > MESSAGE_WINDOW_CAP ? merged.slice(merged.length - MESSAGE_WINDOW_CAP) : merged;
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
    setUsageStepsBySession({});
    setTodoRecordsBySession({});
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
    usageStepsBySession,
    todoRecordsBySession,
    refreshMessages,
    loadOlderMessages,
    reset,
    prune,
  };
}

export { MESSAGE_WINDOW_CAP };
