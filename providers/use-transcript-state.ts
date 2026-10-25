import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

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
import { hydrateTranscriptCache, persistTranscriptCache } from '@/providers/transcript-cache';
import {
  getSessionMessages as svcGetSessionMessages,
  MAX_MESSAGE_PAGE_LIMIT,
  TRANSCRIPT_PAGE_LIMIT,
} from '@/providers/services/session-service';

// One newest-window read when a session opens (or history is rewritten).
// Older history is fetched in full batches of the same size, one per explicit
// scroll-to-top, so reaching the first message never triggers a page loop.
// The native message endpoint rejects pages larger than 200.
export const INITIAL_TRANSCRIPT_LIMIT = MAX_MESSAGE_PAGE_LIMIT;
export const OLDER_TRANSCRIPT_LIMIT = MAX_MESSAGE_PAGE_LIMIT;

type MessageWindow = { nextBefore?: string; hasMore: boolean };

// Owns the paginated transcript for every session: the loaded messages are held
// by the provider, while this hook owns the pagination cursors, and accumulates
// completed model calls and V2 plan records so usage and todos survive paging
// without requiring a full-history read.
export function useTranscriptState({
  client,
  isCurrentClient,
  currentSessionId,
  connectionScope,
  activeProjectPath,
  messagesBySession,
  setMessagesBySession,
  setIsRefreshingMessages,
}: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  currentSessionId?: string;
  connectionScope: string;
  activeProjectPath?: string;
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
  // Transcript reads can overlap: a cold window, a prompt-send refresh, a
  // history page, and event-driven tails may all be in flight together. A
  // window rewrite starts a new generation so older responses cannot replace
  // it, while tail request ids let a late page fill gaps without adopting an
  // older window over a newer one.
  const readStateRef = useRef<Record<string, { generation: number; tailRequest: number; tailApplied: number }>>({});
  useLayoutEffect(() => {
    messagesBySessionRef.current = messagesBySession;
    messageWindowsRef.current = messageWindows;
    loadingOlderBySessionRef.current = loadingOlderBySession;
  });

  const readStateFor = useCallback((sessionId: string) => {
    let state = readStateRef.current[sessionId];
    if (!state) {
      state = { generation: 0, tailRequest: 0, tailApplied: 0 };
      readStateRef.current[sessionId] = state;
    }
    return state;
  }, []);

  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const persist = useCallback((sessionId: string, records: SessionMessageRecord[]) => {
    if (!activeProjectPath) return;
    const existing = persistTimers.current[sessionId];
    if (existing) clearTimeout(existing);
    persistTimers.current[sessionId] = setTimeout(() => {
      delete persistTimers.current[sessionId];
      void persistTranscriptCache(connectionScope, activeProjectPath, sessionId, records);
    }, 1200);
  }, [activeProjectPath, connectionScope]);
  useEffect(() => () => {
    for (const timer of Object.values(persistTimers.current)) clearTimeout(timer);
    persistTimers.current = {};
  }, []);

  const hydratedCacheRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!currentSessionId || !activeProjectPath || (messagesBySessionRef.current[currentSessionId]?.length ?? 0) > 0) {
      return;
    }
    const key = `${connectionScope}\u0000${activeProjectPath}\u0000${currentSessionId}`;
    if (hydratedCacheRef.current.has(key)) return;
    hydratedCacheRef.current.add(key);
    const requestedSession = currentSessionId;
    void hydrateTranscriptCache(connectionScope, activeProjectPath, requestedSession, (records) => {
      // A live refresh may have painted first; never let the cache overwrite a
      // fresher window or a session the user has already left.
      if (currentSessionId !== requestedSession || (messagesBySessionRef.current[requestedSession]?.length ?? 0) > 0) return;
      messagesBySessionRef.current = { ...messagesBySessionRef.current, [requestedSession]: records };
      setMessagesBySession((current) => (current[requestedSession]?.length ? current : { ...current, [requestedSession]: records }));
      recordUsageAndTodos(requestedSession, records);
    }, () => isCurrentClient(client) && currentSessionId === requestedSession);
  }, [activeProjectPath, client, connectionScope, currentSessionId, isCurrentClient, recordUsageAndTodos, setMessagesBySession]);

  const beginHydration = useCallback((sessionId: string) => {
    const request = (hydrationRequestRef.current[sessionId] ?? 0) + 1;
    hydrationRequestRef.current[sessionId] = request;
    setHydratingSessionIds((current) => (
      current[sessionId] ? current : { ...current, [sessionId]: true }
    ));
    return () => {
      if (hydrationRequestRef.current[sessionId] !== request) {
        return;
      }
      delete hydrationRequestRef.current[sessionId];
      setHydratingSessionIds((current) => (
        current[sessionId] ? { ...current, [sessionId]: false } : current
      ));
    };
  }, []);

  const refreshMessages = useCallback(
    async (sessionId: string, silent = false, options?: { mode?: TranscriptRefreshMode }) => {
      const held = messagesBySessionRef.current[sessionId] ?? [];
      // Records can already be held without a paging cursor when the transcript
      // cache hydrates before the first network read, or when a refresh is the
      // first pass after a window reset. A tail refresh records that window
      // below, keeping held records when the newest page overlaps them.
      const windowMissing = messageWindowsRef.current[sessionId] === undefined;
      const shouldHydrate = !silent || held.length === 0;
      const finishHydration = shouldHydrate ? beginHydration(sessionId) : undefined;
      if (!silent) {
        setIsRefreshingMessages(true);
      }
      try {
        // Default to a cold load when nothing is held, otherwise merge the
        // newest page into what we have. A requested mode overrides the default.
        const mode: TranscriptRefreshMode = options?.mode ?? (held.length === 0 ? 'initial' : 'tail');

        // A window rewrite (cold open, repair, compaction, revert) starts a new
        // generation. Responses that started before it can no longer replace
        // the rebuilt window, even when they resolve later.
        const readState = readStateFor(sessionId);
        const rewrite = mode !== 'tail' || held.length === 0;
        if (rewrite) {
          readState.generation += 1;
          readState.tailApplied = 0;
        }
        const generation = readState.generation;
        const tailRequest = rewrite ? 0 : ++readState.tailRequest;
        const isCurrentGeneration = () => readStateRef.current[sessionId]?.generation === generation;

        // Opening or rewriting history is one bounded newest-window read. It
        // never pages backward; older history arrives through loadOlderMessages
        // only when the user scrolls to the top.
        if (rewrite) {
          // Bypass read coalescing: an in-flight page could have been read
          // before the compaction/revert this rewrite is reconciling.
          const page = await svcGetSessionMessages(client, sessionId, { limit: INITIAL_TRANSCRIPT_LIMIT, fresh: true });
          if (!isCurrentClient(client) || !isCurrentGeneration()) {
            return page.records;
          }
          setMessagesBySession((current) => ({ ...current, [sessionId]: page.records }));
          setMessageWindows((current) => ({
            ...current,
            [sessionId]: { nextBefore: page.nextBefore, hasMore: page.hasMore },
          }));
          recordUsageAndTodos(sessionId, page.records);
          persist(sessionId, page.records);
          return page.records;
        }

        // Reconcile is one newest-page read. It must never scan or refresh the
        // whole transcript, and it must never trim records already loaded above.
        const page = await svcGetSessionMessages(client, sessionId, { limit: TRANSCRIPT_PAGE_LIMIT });
        if (!isCurrentClient(client) || !isCurrentGeneration()) {
          return page.records;
        }

        const staleTail = tailRequest < readState.tailApplied;
        if (page.records.length === 0) {
          if (windowMissing && !staleTail) {
            setMessageWindows((current) => (
              current[sessionId]
                ? current
                : { ...current, [sessionId]: { nextBefore: page.nextBefore, hasMore: page.hasMore } }
            ));
          }
          if (!staleTail) {
            readState.tailApplied = Math.max(readState.tailApplied, tailRequest);
          }
          return held;
        }

        const currentHeld = messagesBySessionRef.current[sessionId] ?? held;
        if (staleTail) {
          // Older responses may still hold records the newer window dropped.
          // Fill gaps in place, but never adopt their window or move the paging
          // cursor backward, and never roll streamed content back.
          setMessagesBySession((current) => {
            const previous = current[sessionId] ?? held;
            const next = mergeSessionMessageWindow(previous, page.records, {
              applyUpdates: false,
              adoptUnknownWindow: false,
            });
            return next === previous ? current : { ...current, [sessionId]: next };
          });
          recordUsageAndTodos(sessionId, page.records);
          return page.records;
        }

        readState.tailApplied = Math.max(readState.tailApplied, tailRequest);
        const knownIds = new Set(currentHeld.map((record) => record.info.id));
        if (!page.records.some((record) => knownIds.has(record.info.id))) {
          // A burst larger than one page landed. Adopt the fetched page and
          // restart history paging from its oldest record instead of
          // downloading bridging pages.
          setMessagesBySession((current) => ({ ...current, [sessionId]: page.records }));
          setMessageWindows((current) => ({
            ...current,
            [sessionId]: { nextBefore: page.nextBefore, hasMore: page.hasMore },
          }));
          recordUsageAndTodos(sessionId, page.records);
          persist(sessionId, page.records);
          return page.records;
        }

        const merged = mergeSessionMessageWindow(currentHeld, page.records);
        setMessagesBySession((current) => {
          const previous = current[sessionId] ?? held;
          const next = mergeSessionMessageWindow(previous, page.records);
          if (next === previous) {
            return current;
          }
          return { ...current, [sessionId]: next };
        });
        if (windowMissing) {
          // The newest page overlaps the held records, so it is contiguous with
          // them. Keep the held history and resume paging from this page's
          // cursor instead of leaving the window unset.
          setMessageWindows((current) => (
            current[sessionId]
              ? current
              : { ...current, [sessionId]: { nextBefore: page.nextBefore, hasMore: page.hasMore } }
          ));
        }
        recordUsageAndTodos(sessionId, page.records);
        persist(sessionId, merged);
        return page.records;
      } finally {
        if (!silent) {
          setIsRefreshingMessages(false);
        }
        finishHydration?.();
      }
    },
    [beginHydration, client, isCurrentClient, persist, readStateFor, recordUsageAndTodos, setIsRefreshingMessages, setMessagesBySession],
  );

  const loadOlderMessages = useCallback(
    async (sessionId: string) => {
      const held = messagesBySessionRef.current[sessionId] ?? [];
      if (loadingOlderBySessionRef.current[sessionId]) {
        return;
      }

      setLoadingOlderBySession((current) => ({ ...current, [sessionId]: true }));
      try {
        const meta = messageWindowsRef.current[sessionId];
        if (!meta) {
          // No cursor can be trusted for this window (for example records
          // restored from cache before the first network read). Repair the
          // newest window once and return; the next scroll pages from the
          // refreshed cursor. One explicit scroll never chains two reads.
          await refreshMessages(sessionId, true, { mode: 'initial' });
          return;
        }
        if (!meta.hasMore || !meta.nextBefore) {
          return;
        }
        const generation = readStateFor(sessionId).generation;
        const page = await svcGetSessionMessages(client, sessionId, { limit: OLDER_TRANSCRIPT_LIMIT, before: meta.nextBefore });
        // A rewrite (compaction, revert, repair) invalidates this cursor; the
        // next scroll repairs the window instead of prepending pre-rewrite
        // history above it.
        const currentMeta = messageWindowsRef.current[sessionId];
        if (!isCurrentClient(client)
          || readStateRef.current[sessionId]?.generation !== generation
          || !currentMeta
          || currentMeta.nextBefore !== meta.nextBefore) {
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
    [client, isCurrentClient, readStateFor, recordUsageAndTodos, refreshMessages, setMessagesBySession],
  );

  const reset = useCallback(() => {
    setMessageWindows({});
    setLoadingOlderBySession({});
    setHydratingSessionIds({});
    setUsageStepsBySession({});
    setTodoRecordsBySession({});
    hydrationRequestRef.current = {};
    readStateRef.current = {};
  }, []);

  // Drop pagination, usage, and plan state for sessions that are no longer kept
  // in memory, mirroring the provider's transcript-cache pruning.
  const prune = useCallback((keepIds: Set<string>, limit: number) => {
    setMessageWindows((current) => pruneByKeepIds(current, keepIds, limit));
    setUsageStepsBySession((current) => pruneByKeepIds(current, keepIds, limit));
    setTodoRecordsBySession((current) => pruneByKeepIds(current, keepIds, limit));
    readStateRef.current = pruneByKeepIds(readStateRef.current, keepIds, limit);
  }, []);

  return {
    messageWindows,
    loadingOlderBySession,
    hydratingSessionIds,
    beginHydration,
    usageStepsBySession,
    todoRecordsBySession,
    refreshMessages,
    loadOlderMessages,
    reset,
    prune,
  };
}
