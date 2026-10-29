// SSE with polling fallback and reconnect reconciliation.
// See docs/architecture/network-resilience.md.
import { SSE_STALENESS_MS, SSE_FOREGROUND_CYCLE_MS, WATCHDOG_TICK_MS, SSE_BUSY_STALENESS_MS, SSE_CONNECT_TIMEOUT_MS, SSE_STABLE_MS } from '@/providers/realtime-timing';
import { AppState } from 'react-native';
import { jitterRetryDelay, MAX_RETRY_MS, RETRY_RESET_MS } from '@/providers/realtime/backoff';
import { isStreamStale, shouldCycleForeground } from '@/providers/realtime/liveness';
import { nextPollDelay, shouldPoll } from '@/providers/realtime/polling';
import { createReconciler } from '@/providers/realtime/reconcile';
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
  refreshSessions: () => Promise<unknown>;
  refreshSessionStatuses?: () => Promise<unknown>;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshMessages: (sessionId: string, silent: boolean, options?: { mode?: TranscriptRefreshMode }) => Promise<unknown>;
  refreshSessionDiff: (sessionId: string, silent: boolean) => Promise<unknown>;
  refreshSessionTodos: (sessionId: string) => Promise<unknown>;
};

// Test seams keep old mocks valid while production always receives the timing
// module's values.
const CONNECT_TIMEOUT_MS = typeof SSE_CONNECT_TIMEOUT_MS === 'number' ? SSE_CONNECT_TIMEOUT_MS : 15_000;
const BUSY_STALENESS_MS = typeof SSE_BUSY_STALENESS_MS === 'number' ? SSE_BUSY_STALENESS_MS : SSE_STALENESS_MS;
const STABLE_MS = typeof SSE_STABLE_MS === 'number' ? SSE_STABLE_MS : 5_000;

export { shouldPoll } from '@/providers/realtime/polling';

export function useOpencodeRealtime({ catalogClient, activeProjectPath, connected, busy,
  currentSessionId, conversationSessionId, pendingSessionIds = [], subscribe: subscribeStream = subscribeEvents, online = true, constrained = false, ...actions
}: RealtimeActions & {
  catalogClient: ScopedOpencodeClient;
  activeProjectPath?: string;
  connected: boolean;
  busy: boolean;
  online?: boolean;
  constrained?: boolean;
  pendingSessionIds?: string[];
  currentSessionId?: string;
  conversationSessionId?: string;
}) {
  const [eventStreamStatus, setEventStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const statusRef = useRef(eventStreamStatus);
  const latest = useRef({ ...actions, currentSessionId, conversationSessionId, pendingSessionIds, busy, constrained });
  const pollFailedRef = useRef(false);
  useLayoutEffect(() => {
    latest.current = { ...actions, currentSessionId, conversationSessionId, pendingSessionIds, busy, constrained };
    statusRef.current = eventStreamStatus;
  });
  const reconcilerRef = useRef<ReturnType<typeof createReconciler> | null>(null);
  useEffect(() => {
    reconcilerRef.current = createReconciler({
      getSources: () => latest.current,
      onPollFailure: (failed) => { pollFailedRef.current = failed; },
    });
    return () => { reconcilerRef.current = null; };
  }, []);
  const reconcile = useCallback((full = false) => (
    reconcilerRef.current?.reconcile(full) ?? Promise.resolve()
  ), []);

  useEffect(() => {
    reconcilerRef.current?.reset();
    if (!connected || !activeProjectPath || !online) {
      setEventStreamStatus('idle');
      return;
    }
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let resumeRetry: (() => void) | undefined;
    let attemptController: AbortController | undefined;
    let restart = false;
    let lastEnvelopeAt = Date.now();
    let stableSince = 0;
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
      let retryDelay = RETRY_RESET_MS;
      while (!controller.signal.aborted) {
        setEventStreamStatus(retryDelay === RETRY_RESET_MS ? 'connecting' : 'error');
        const attempt = new AbortController();
        attemptController = attempt;
        let streamError: unknown;
        let timedOut = false;
        // A TCP/TLS handshake can stall without ever producing a stream. Bound
        // it so a 4G handoff cannot leave the app looking connected forever.
        const connectTimer = setTimeout(() => { timedOut = true; attempt.abort(); }, CONNECT_TIMEOUT_MS);
        try {
          const subscription = subscribeStream(catalogClient, attempt.signal, () => { lastEnvelopeAt = Date.now(); });
          let reconciled = false;
          for await (const envelope of subscription) {
            if (controller.signal.aborted || attempt.signal.aborted) break;
            if (!envelope) continue;
            clearTimeout(connectTimer);
            lastEnvelopeAt = Date.now();
            setEventStreamStatus('connected');
            if (!stableSince) stableSince = Date.now();
            if (Date.now() - stableSince >= STABLE_MS) retryDelay = RETRY_RESET_MS;
            if (!reconciled) {
              reconciled = true;
              void reconcile(true);
            }
            latest.current.onGlobalEvent?.(envelope);
            if (envelope.location?.directory === activeProjectPath || !envelope.location?.directory) latest.current.onEvent(envelope);
          }
          if (!controller.signal.aborted && !attempt.signal.aborted && !restart) throw new Error('OpenCode event stream ended.');
        } catch (error) {
          streamError = timedOut ? new Error('OpenCode event stream timed out.') : error;
        } finally {
          clearTimeout(connectTimer);
        }
        if (controller.signal.aborted) break;
        if (restart) {
          restart = false;
          stableSince = 0;
          retryDelay = RETRY_RESET_MS;
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
        stableSince = 0;
        await new Promise<void>((resolve) => {
          resumeRetry = resolve;
          retryTimer = setTimeout(() => { retryTimer = undefined; resumeRetry = undefined; resolve(); }, jitterRetryDelay(retryDelay));
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
          retryDelay = RETRY_RESET_MS;
          continue;
        }
        // Keep the previous delay for the next attempt; only a stable stream or
        // an explicit foreground/network restart resets it.
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
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
      // A background suspension can miss session creation/deletion, so a
      // foreground return still performs the authoritative full pass.
      void reconcile(true);
      if (shouldCycleForeground({
        status: statusRef.current,
        backgroundedFor,
        foregroundThreshold: SSE_FOREGROUND_CYCLE_MS,
      })) requestRestart();
    });
    const watchdog = setInterval(() => {
      if (AppState.currentState !== 'active' || statusRef.current !== 'connected') return;
      if (!isStreamStale({
        now: Date.now(),
        lastEnvelopeAt,
        busy: latest.current.busy,
        idleLimit: SSE_STALENESS_MS,
        busyLimit: BUSY_STALENESS_MS,
      })) return;
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
  }, [activeProjectPath, catalogClient, connected, online, reconcile, subscribeStream]);

  useEffect(() => {
    if (!connected || !activeProjectPath || !online || !shouldPoll(eventStreamStatus === 'connected', busy)) return;
    // While SSE is healthy the loop is a safety net and runs slower; without a
    // stream it is the primary transport. Repeated failed passes back off so an
    // offline or overloaded link does not receive a request every five seconds.
    const streamConnected = eventStreamStatus === 'connected';
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const tick = async () => {
      if (cancelled) return;
      await reconcile();
      if (cancelled) return;
      failures = pollFailedRef.current ? Math.min(failures + 1, 3) : 0;
      timer = setTimeout(() => { void tick(); }, nextPollDelay({ streamConnected, constrained, failures }));
    };
    timer = setTimeout(() => { void tick(); }, nextPollDelay({ streamConnected, constrained, failures }));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeProjectPath, busy, connected, constrained, eventStreamStatus, online, reconcile]);

  return { eventStreamStatus };
}
