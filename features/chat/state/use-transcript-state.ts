import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import { mergeSessionMessageWindow, prependSessionMessageHistory, type SessionMessageRecord } from '@/shared/presentation/format';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { TranscriptReadOptions, TranscriptRefreshMode } from '@/shared/contracts/domain';
import { pruneByKeepIds } from '@/shared/utilities/prune';
import { hydrateTranscriptCache, persistTranscriptCache } from '@/features/chat/services/transcript-cache';
import { recordSessionUsageAndTodos } from '@/features/chat/model/session-ledger';
import { useLiveTranscript } from '@/features/chat/state/use-live-transcript';
import { useTranscriptMetadata } from '@/features/chat/state/use-transcript-metadata';
import { coalesceRead } from '@/shared/protocol/opencode/in-flight';
import { isV2Client } from '@/shared/protocol/opencode/contracts/contract';
import { toMessageRecord } from '@/shared/protocol/opencode/v2/mappers';
import { getSessionMessage as svcGetSessionMessage, getSessionMessages as svcGetSessionMessages, MAX_MESSAGE_PAGE_LIMIT, TRANSCRIPT_PAGE_LIMIT } from '@/shared/protocol/services/session-service';

// One newest-window read when a session opens (or history is rewritten).
// Older history is fetched in full batches of the same size, one per explicit
// scroll-to-top, so reaching the first message never triggers a page loop.
// The native message endpoint rejects pages larger than 200.
export const INITIAL_TRANSCRIPT_LIMIT = MAX_MESSAGE_PAGE_LIMIT;
export const OLDER_TRANSCRIPT_LIMIT = MAX_MESSAGE_PAGE_LIMIT;

type MessagesBySession = Record<string, SessionMessageRecord[]>;
type TranscriptFlags = Record<string, boolean>;
const EMPTY_FLAGS: TranscriptFlags = {};

function replaceMessageRecord(previous: SessionMessageRecord[], record: SessionMessageRecord) {
  const index = previous.findIndex((item) => item.info.id === record.info.id);
  if (index >= 0) {
    const next = previous.slice();
    next[index] = record;
    return next;
  }
  const tail = previous[previous.length - 1];
  return !tail || record.info.time.created >= tail.info.time.created ? [...previous, record] : previous;
}

// Coordinates transcript reads and keeps usage and plan ledgers across paging.
export function useTranscriptState({
  scopeKey,
  client,
  isCurrentClient,
  currentSessionId,
  connectionScope,
  activeProjectPath,
  messagesBySession,
  readMessagesBySession,
  setMessagesBySession,
  setIsRefreshingMessages,
}: {
  scopeKey: string;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  currentSessionId?: string;
  connectionScope: string;
  activeProjectPath?: string;
  messagesBySession: MessagesBySession;
  readMessagesBySession: () => MessagesBySession;
  setMessagesBySession: Dispatch<SetStateAction<MessagesBySession>>;
  setIsRefreshingMessages: Dispatch<SetStateAction<boolean>>;
}) {
  const { store } = useAppCore();
  const loadingOlderBySession = useAppStore((state) => state.transcriptUi[scopeKey]?.loadingOlderBySession ?? EMPTY_FLAGS);
  const hydratingSessionIds = useAppStore((state) => state.transcriptUi[scopeKey]?.hydratingSessionIds ?? EMPTY_FLAGS);
  const { messageWindows, readMessageWindow, setMessageWindows, usageStepsBySession, setUsageStepsBySession, todoRecordsBySession, setTodoRecordsBySession } = useTranscriptMetadata(client);
  const hydrationRequestRef = useRef<Record<string, symbol>>({});
  const olderRequestRef = useRef<Record<string, symbol>>({});
  // Transcript reads can overlap: a cold window, a prompt-send refresh, a
  // history page, and event-driven tails may all be in flight together. A
  // window rewrite starts a new generation so older responses cannot replace
  // it, while tail request ids let a late page fill gaps without adopting an
  // older window over a newer one.
  const readStateRef = useRef<Record<string, { generation: number; tailRequest: number; tailApplied: number }>>({});

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
    olderRequestRef.current = {};
    hydrationRequestRef.current = {};
    readStateRef.current = {};
    const view = store.getState().transcriptUi[scopeKey];
    if (view) store.getState().setTranscriptUi(scopeKey, { loadingOlderBySession: EMPTY_FLAGS, hydratingSessionIds: EMPTY_FLAGS });
  }, [scopeKey, store]);

  const hydratedCacheRef = useRef<Set<string>>(new Set());

  const recordUsageAndTodos = useCallback((sessionId: string, records: SessionMessageRecord[]) => {
    recordSessionUsageAndTodos(sessionId, records, setUsageStepsBySession, setTodoRecordsBySession);
  }, [setTodoRecordsBySession, setUsageStepsBySession]);

  const { actions: live, displayedMessages, readDisplayedSession } = useLiveTranscript({
    scopeKey,
    client,
    isCurrentClient,
    messagesBySession,
    readMessagesBySession,
    recordUsageAndTodos,
  });

  useEffect(() => {
    if (!currentSessionId || !activeProjectPath || (readMessagesBySession()[currentSessionId]?.length ?? 0) > 0) {
      return;
    }
    const key = `${connectionScope}\u0000${activeProjectPath}\u0000${currentSessionId}`;
    if (hydratedCacheRef.current.has(key)) return;
    hydratedCacheRef.current.add(key);
    const requestedSession = currentSessionId;
    void hydrateTranscriptCache(connectionScope, activeProjectPath, requestedSession, (records) => {
      // A live refresh may have painted first; never let the cache overwrite a
      // fresher window or a session the user has already left.
      if (currentSessionId !== requestedSession || (readMessagesBySession()[requestedSession]?.length ?? 0) > 0) return;
      setMessagesBySession((current) => (current[requestedSession]?.length ? current : { ...current, [requestedSession]: records }));
      recordUsageAndTodos(requestedSession, records);
    }, () => isCurrentClient(client) && currentSessionId === requestedSession);
  }, [activeProjectPath, client, connectionScope, currentSessionId, isCurrentClient, readMessagesBySession, recordUsageAndTodos, setMessagesBySession]);

  const beginHydration = useCallback((sessionId: string) => {
    const request = Symbol();
    hydrationRequestRef.current[sessionId] = request;
    store.getState().setTranscriptUi(scopeKey, (current) => ({
      hydratingSessionIds: { ...current.hydratingSessionIds, [sessionId]: true },
    }));
    return () => {
      if (hydrationRequestRef.current[sessionId] !== request) {
        return;
      }
      delete hydrationRequestRef.current[sessionId];
      store.getState().setTranscriptUi(scopeKey, (current) => ({
        hydratingSessionIds: { ...current.hydratingSessionIds, [sessionId]: false },
      }));
    };
  }, [scopeKey, store]);

  const refreshMessages = useCallback(
    async (sessionId: string, silent = false, options?: TranscriptReadOptions) => {
      const held = readMessagesBySession()[sessionId] ?? [];
      const hasHeld = held.length > 0 || live.hasLocalUsers(sessionId);
      // A live V2 turn reconciles its assistant message alone. Reading the newest
      // page here would re-download the sent prompt and any attachment bytes it
      // carries on every check.
      if (options?.messageId && isV2Client(client) && hasHeld) {
        const messageId = options.messageId;
        return coalesceRead(client, `message:${sessionId}:${messageId}`, async () => {
          const generation = readStateFor(sessionId).generation;
          let message;
          try {
            message = await svcGetSessionMessage(client, sessionId, messageId);
          } catch (error) {
            const status = (error as { status?: number; cause?: { status?: number } } | undefined)?.status
              ?? (error as { cause?: { status?: number } } | undefined)?.cause?.status;
            // Older servers without a single-message read keep the live record
            // until the next full reconcile instead of failing the turn.
            if (status === 404 || status === 405) {
              if (isCurrentClient(client) && readStateRef.current[sessionId]?.generation === generation) live.deferReconcileToPage(sessionId, messageId);
              return readDisplayedSession(sessionId);
            }
            throw error;
          }
          if (!isCurrentClient(client) || readStateRef.current[sessionId]?.generation !== generation) {
            return readDisplayedSession(sessionId);
          }
          const record = toMessageRecord(message, sessionId);
          if (!record) return readDisplayedSession(sessionId);
          const previous = readMessagesBySession()[sessionId] ?? held;
          const canonical = replaceMessageRecord(previous, record);
          if (canonical !== previous) setMessagesBySession((current) => ({ ...current, [sessionId]: canonical }));
          live.clearMessage(sessionId, messageId);
          recordUsageAndTodos(sessionId, [record]);
          persist(sessionId, canonical);
          return live.overlay(sessionId, canonical);
        });
      }
      // Records can already be held without a paging cursor when the transcript
      // cache hydrates before the first network read, or when a refresh is the
      // first pass after a window reset. A tail refresh records that window
      // below, keeping held records when the newest page overlaps them.
      const windowMissing = readMessageWindow(sessionId) === undefined;
      // Hydration owns the chat skeleton. Silent event/poll refreshes must never
      // raise it, or an empty session flashes the skeleton on every background
      // read. Explicit opens and the first bootstrap read are non-silent.
      const shouldHydrate = !silent;
      const finishHydration = shouldHydrate ? beginHydration(sessionId) : undefined;
      if (!silent) {
        setIsRefreshingMessages(true);
      }
      try {
        // Default to a cold load when nothing is held, otherwise merge the
        // newest page into what we have. A requested mode overrides the default.
        const mode: TranscriptRefreshMode = options?.mode ?? (hasHeld ? 'tail' : 'initial');

        // A window rewrite (cold open, repair, compaction, revert) starts a new
        // generation. Responses that started before it can no longer replace
        // the rebuilt window, even when they resolve later.
        const readState = readStateFor(sessionId);
        const rewrite = mode !== 'tail' || !hasHeld;
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
          // A server-side rewrite invalidates the live parts of that session.
          if (mode === 'replace') live.clearSession(sessionId);
          // Bypass read coalescing: an in-flight page could have been read
          // before the compaction/revert this rewrite is reconciling.
          const page = await svcGetSessionMessages(client, sessionId, { limit: INITIAL_TRANSCRIPT_LIMIT, fresh: true });
          if (!isCurrentClient(client) || !isCurrentGeneration()) {
            return page.records;
          }
          setMessagesBySession((current) => ({ ...current, [sessionId]: page.records }));
          live.adopt(sessionId, page.records);
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
          return live.overlay(sessionId, held);
        }

        const currentHeld = readMessagesBySession()[sessionId] ?? held;
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
          live.adopt(sessionId);
          recordUsageAndTodos(sessionId, page.records);
          return page.records;
        }

        // The read-state object is mutable bookkeeping held by a ref; keeping
        // the same object is what lets an older in-flight refresh observe the
        // newer window instead of replacing it.
        readState.tailApplied = Math.max(readState.tailApplied, tailRequest);
        const knownIds = new Set(currentHeld.map((record) => record.info.id));
        if (!page.records.some((record) => knownIds.has(record.info.id))) {
          // A burst larger than one page landed. Adopt the fetched page and
          // restart history paging from its oldest record instead of
          // downloading bridging pages.
          setMessagesBySession((current) => ({ ...current, [sessionId]: page.records }));
          live.adopt(sessionId, page.records);
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
        live.adopt(sessionId, page.records);
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
    [beginHydration, client, isCurrentClient, live, persist, readDisplayedSession, readMessagesBySession, readMessageWindow, readStateFor, recordUsageAndTodos, setIsRefreshingMessages, setMessagesBySession, setMessageWindows],
  );

  const loadOlderMessages = useCallback(
    async (sessionId: string) => {
      if (olderRequestRef.current[sessionId]) return;
      const request = Symbol();
      olderRequestRef.current[sessionId] = request;
      store.getState().setTranscriptUi(scopeKey, (current) => ({ loadingOlderBySession: { ...current.loadingOlderBySession, [sessionId]: true } }));
      try {
        const meta = readMessageWindow(sessionId);
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
        const currentMeta = readMessageWindow(sessionId);
        if (!isCurrentClient(client)
          || readStateRef.current[sessionId]?.generation !== generation
          || !currentMeta
          || currentMeta.nextBefore !== meta.nextBefore) {
          return;
        }
        setMessagesBySession((current) => {
          const previous = current[sessionId] ?? [];
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
        if (olderRequestRef.current[sessionId] === request) {
          delete olderRequestRef.current[sessionId];
          store.getState().setTranscriptUi(scopeKey, (current) => ({ loadingOlderBySession: { ...current.loadingOlderBySession, [sessionId]: false } }));
        }
      }
    },
    [client, isCurrentClient, readMessageWindow, readStateFor, recordUsageAndTodos, refreshMessages, scopeKey, setMessageWindows, setMessagesBySession, store],
  );

  const reset = useCallback(() => {
    setMessageWindows({});
    store.getState().setTranscriptUi(scopeKey, { loadingOlderBySession: EMPTY_FLAGS, hydratingSessionIds: EMPTY_FLAGS });
    setUsageStepsBySession({});
    setTodoRecordsBySession({});
    hydrationRequestRef.current = {};
    olderRequestRef.current = {};
    readStateRef.current = {};
    live.reset();
  }, [live, scopeKey, setMessageWindows, setTodoRecordsBySession, setUsageStepsBySession, store]);

  // Drop pagination, usage, and plan state for sessions that are no longer kept
  // in memory, mirroring the provider's transcript-cache pruning.
  const prune = useCallback((keepIds: Set<string>, limit: number) => {
    setMessageWindows((current) => pruneByKeepIds(current, keepIds, limit));
    setUsageStepsBySession((current) => pruneByKeepIds(current, keepIds, limit));
    setTodoRecordsBySession((current) => pruneByKeepIds(current, keepIds, limit));
    readStateRef.current = pruneByKeepIds(readStateRef.current, keepIds, limit);
    live.prune(keepIds);
  }, [live, setMessageWindows, setTodoRecordsBySession, setUsageStepsBySession]);

  return {
    messagesBySession: displayedMessages,
    readDisplayedSession,
    messageWindows,
    loadingOlderBySession,
    hydratingSessionIds,
    beginHydration,
    usageStepsBySession,
    todoRecordsBySession,
    refreshMessages,
    applyTranscriptEvent: live.applyEvent,
    liveTranscriptMessageId: live.activeMessageId,
    appendUserMessage: live.appendUserMessage,
    markLocalSend: live.markLocalSend,
    isLocalSendRecent: live.isLocalSendRecent,
    loadOlderMessages,
    reset,
    prune,
  };
}
