import { SSE_STALENESS_MS, SSE_FOREGROUND_CYCLE_MS, WATCHDOG_TICK_MS } from '@/providers/realtime-timing';
import { AppState } from 'react-native';
import { subscribeEvents } from '@/lib/opencode/events';
import { classifyConnectionFailure, isAuthConnectionFailure } from '@/lib/opencode/client/errors';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OpencodeEvent } from '@/lib/opencode/events';
import type { ConnectionFailureKind, ScopedOpencodeClient } from '@/lib/opencode/client';
import type { TranscriptRefreshMode } from '@/providers/opencode-provider-types';

type RealtimeActions = {
  subscribe?: typeof subscribeEvents;
  onEvent: (event: OpencodeEvent) => void;
  onGlobalEvent?: (event: OpencodeEvent) => void;
  refreshNativeSurfaces?: (full?: boolean) => Promise<unknown>;
  onFatalError?: (kind: ConnectionFailureKind) => void;
  refreshSessions: (silent: boolean) => Promise<unknown>;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshMessages: (sessionId: string, silent: boolean, options?: { mode?: TranscriptRefreshMode }) => Promise<unknown>;
  refreshSessionDiff: (sessionId: string, silent: boolean) => Promise<unknown>;
  refreshSessionTodos: (sessionId: string) => Promise<unknown>;
};

export function shouldPoll(streamConnected: boolean, busy: boolean) {
  return !streamConnected || busy;
}

// A socket can die without an error (network switch, sleep). After this window
// without any envelope the subscription is re-established so a dead stream
// cannot masquerade as connected and strand blocking requests. E2E builds
// shorten the window so a stalled transport is recoverable inside a test.
export { SSE_STALENESS_MS, SSE_FOREGROUND_CYCLE_MS } from '@/providers/realtime-timing';

export function useOpencodeRealtime({ catalogClient, activeProjectPath, connected, busy,
  currentSessionId, conversationSessionId, pendingSessionIds = [], subscribe: subscribeStream = subscribeEvents, ...actions
}: RealtimeActions & {
  catalogClient: ScopedOpencodeClient;
  activeProjectPath?: string;
  connected: boolean;
  busy: boolean;
  pendingSessionIds?: string[];
  currentSessionId?: string;
  conversationSessionId?: string;
}) {
  const [eventStreamStatus, setEventStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const statusRef = useRef(eventStreamStatus);
  const latest = useRef({ ...actions, currentSessionId, conversationSessionId, pendingSessionIds });
  useLayoutEffect(() => {
    latest.current = { ...actions, currentSessionId, conversationSessionId, pendingSessionIds };
    statusRef.current = eventStreamStatus;
  });
  const inFlight = useRef<Promise<unknown> | undefined>(undefined);
  const pendingFull = useRef(false);
  const reconcile = useCallback(function reconcile(full = false): Promise<unknown> {
    if (inFlight.current) {
      // A reconnect's authoritative rebuild must not be swallowed by a poll
      // that was already running; queue it behind the in-flight pass.
      if (full) pendingFull.current = true;
      return inFlight.current;
    }
    const next = latest.current;
    const sessions = new Set([...next.pendingSessionIds, next.currentSessionId, next.conversationSessionId].filter((id): id is string => Boolean(id)));
    let result: Promise<unknown>;
    result = Promise.allSettled([
      next.refreshSessions(true), next.refreshPendingInteractions(),
      next.refreshNativeSurfaces?.(full),
      ...[...sessions].flatMap((id) => [next.refreshMessages(id, true), next.refreshSessionDiff(id, true), next.refreshSessionTodos(id)]),
    ]).finally(() => {
      if (inFlight.current !== result) return;
      inFlight.current = undefined;
      if (pendingFull.current) {
        pendingFull.current = false;
        void reconcile(true);
      }
    });
    inFlight.current = result;
    return result;
  }, []);

  useEffect(() => {
    inFlight.current = undefined;
    pendingFull.current = false;
    if (!connected || !activeProjectPath) {
      setEventStreamStatus('idle');
      return;
    }
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let resumeRetry: (() => void) | undefined;
    let attemptController: AbortController | undefined;
    let restart = false;
    let lastEnvelopeAt = Date.now();
    let backgroundedAt = AppState.currentState === 'active' ? 0 : Date.now();
    const wake = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      const resume = resumeRetry;
      resumeRetry = undefined;
      resume?.();
    };
    const requestRestart = () => {
      restart = true;
      attemptController?.abort();
      wake();
    };
    const subscribe = async () => {
      let retryDelay = 1000;
      while (!controller.signal.aborted) {
        setEventStreamStatus(retryDelay === 1000 ? 'connecting' : 'error');
        const attempt = new AbortController();
        attemptController = attempt;
        let streamError: unknown;
        try {
          const subscription = subscribeStream(catalogClient, attempt.signal, () => { lastEnvelopeAt = Date.now(); });
          let reconciled = false;
          for await (const envelope of subscription) {
            if (controller.signal.aborted || attempt.signal.aborted) break;
            if (!envelope) continue;
            lastEnvelopeAt = Date.now();
            setEventStreamStatus('connected');
            retryDelay = 1000;
            if (!reconciled) {
              reconciled = true;
              void reconcile(true);
            }
            latest.current.onGlobalEvent?.(envelope);
            if (envelope.location?.directory === activeProjectPath || !envelope.location?.directory) latest.current.onEvent(envelope);
          }
          if (!controller.signal.aborted && !attempt.signal.aborted && !restart) throw new Error('OpenCode event stream ended.');
        } catch (error) {
          streamError = error;
        }
        if (controller.signal.aborted) break;
        if (restart) {
          restart = false;
          retryDelay = 1000;
          continue;
        }
        const failureKind = classifyConnectionFailure(streamError ?? new Error('OpenCode event stream ended.'));
        if (isAuthConnectionFailure(failureKind)) {
          // Revoked or invalid credentials cannot heal by reconnecting. Stop the
          // loop and let the provider surface recovery; a client/settings change
          // re-runs this effect.
          setEventStreamStatus('error');
          latest.current.onFatalError?.(failureKind);
          break;
        }
        setEventStreamStatus('error');
        await new Promise<void>((resolve) => {
          resumeRetry = resolve;
          retryTimer = setTimeout(() => { retryTimer = undefined; resumeRetry = undefined; resolve(); }, retryDelay);
          if (restart || controller.signal.aborted) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
            resumeRetry = undefined;
            resolve();
          }
        });
        if (controller.signal.aborted) break;
        if (restart) {
          restart = false;
          retryDelay = 1000;
          continue;
        }
        retryDelay = Math.min(retryDelay * 2, 15000);
      }
    };
    void subscribe();
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (!backgroundedAt) backgroundedAt = Date.now();
        return;
      }
      const backgroundedFor = backgroundedAt ? Date.now() - backgroundedAt : 0;
      backgroundedAt = 0;
      // Re-assert domain data on every foreground return. The JS runtime can be
      // suspended while the stream still looks connected, so envelopes may have
      // been missed and a transcript can otherwise stay stale or empty until the
      // next event. The in-flight guard coalesces this with a restart reconcile.
      void reconcile();
      if (statusRef.current !== 'connected' || backgroundedFor >= SSE_FOREGROUND_CYCLE_MS) requestRestart();
    });
    const watchdog = setInterval(() => {
      if (AppState.currentState !== 'active' || statusRef.current !== 'connected') return;
      if (Date.now() - lastEnvelopeAt < SSE_STALENESS_MS) return;
      // One cycle per window; a subscription that never delivers an envelope is
      // retried on the next window instead of looping here.
      lastEnvelopeAt = Date.now();
      requestRestart();
    }, WATCHDOG_TICK_MS);
    return () => {
      controller.abort();
      attemptController?.abort();
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      appState.remove();
      resumeRetry?.();
    };
  }, [activeProjectPath, catalogClient, connected, reconcile, subscribeStream]);

  useEffect(() => {
    if (!connected || !activeProjectPath || !shouldPoll(eventStreamStatus === 'connected', busy)) return;
    // While SSE is healthy the loop is a safety net and runs slower; without a
    // stream it is the primary transport. Prompt completion across projects is
    // additionally covered by the post-send transcript refresh, so a slower
    // connected cadence cannot strand a finished turn.
    const intervalMs = eventStreamStatus === 'connected' ? 10000 : 5000;
    const interval = setInterval(() => { void reconcile(); }, intervalMs);
    return () => clearInterval(interval);
  }, [activeProjectPath, busy, connected, eventStreamStatus, reconcile]);

  return { eventStreamStatus };
}
