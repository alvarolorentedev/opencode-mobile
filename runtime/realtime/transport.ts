import { jitterRetryDelay, MAX_RETRY_MS, RETRY_RESET_MS } from '@/runtime/realtime/backoff';
import { isStreamStale, shouldCycleForeground } from '@/runtime/realtime/liveness';
import { SSE_BUSY_STALENESS_MS, SSE_CONNECT_TIMEOUT_MS, SSE_FOREGROUND_CYCLE_MS, SSE_STABLE_MS, SSE_STALENESS_MS, WATCHDOG_TICK_MS } from '@/shared/network/realtime-timing';
import { telemetry } from '@/shared/observability/client';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { classifyConnectionFailure, isAuthConnectionFailure, type ConnectionFailureKind } from '@/shared/protocol/opencode/client/errors';
import type { OpencodeEvent, subscribeEvents } from '@/shared/protocol/opencode/events';

export type StreamStatus = 'idle' | 'connecting' | 'connected' | 'error';
export type Foreground = {
  isActive: () => boolean;
  subscribe: (listener: (active: boolean) => void) => () => void;
};

export function startRealtimeTransport({
  client, subscribe, foreground, onStatus, getStatus, isBusy, reconcile, dispatch, onFatalError,
}: {
  client: ScopedOpencodeClient;
  subscribe: typeof subscribeEvents;
  foreground: Foreground;
  onStatus: (status: StreamStatus) => void;
  getStatus: () => StreamStatus;
  isBusy: () => boolean;
  reconcile: () => void;
  dispatch: (event: OpencodeEvent) => void;
  onFatalError: (kind: ConnectionFailureKind) => void;
}) {
  const controller = new AbortController();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let resumeRetry: (() => void) | undefined;
  let attemptController: AbortController | undefined;
  let restart = false;
  let lastEnvelopeAt = Date.now();
  let stableSince = 0;
  let backgroundedAt = foreground.isActive() ? 0 : Date.now();
  const wake = () => {
    clearTimeout(retryTimer);
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
  async function run() {
    let retryDelay = RETRY_RESET_MS;
    while (!controller.signal.aborted) {
      onStatus(retryDelay === RETRY_RESET_MS ? 'connecting' : 'error');
      const attempt = new AbortController();
      attemptController = attempt;
      let streamError: unknown;
      let timedOut = false;
      // A TCP/TLS handshake can stall before the first envelope after a handoff.
      connectTimer = setTimeout(() => { timedOut = true; attempt.abort(); }, SSE_CONNECT_TIMEOUT_MS);
      try {
        let reconciled = false;
        for await (const envelope of subscribe(client, attempt.signal, () => { lastEnvelopeAt = Date.now(); })) {
          if (controller.signal.aborted || attempt.signal.aborted) break;
          if (!envelope) continue;
          clearTimeout(connectTimer);
          lastEnvelopeAt = Date.now();
          onStatus('connected');
          if (!stableSince) stableSince = lastEnvelopeAt;
          if (lastEnvelopeAt - stableSince >= SSE_STABLE_MS) retryDelay = RETRY_RESET_MS;
          if (!reconciled) {
            reconciled = true;
            reconcile();
          }
          dispatch(envelope);
        }
      } catch (error) {
        streamError = error;
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
      const failureKind = classifyConnectionFailure(timedOut ? new Error('OpenCode event stream timed out.')
        : streamError ?? new Error('OpenCode event stream ended.'));
      onStatus('error');
      if (isAuthConnectionFailure(failureKind)) {
        telemetry.warn('sse.auth-failed', { failureKind });
        onFatalError(failureKind);
        break;
      }
      stableSince = 0;
      await new Promise<void>((resolve) => {
        resumeRetry = resolve;
        // Backgrounded there is nothing to recover for; foreground return
        // aborts the wait and starts a fresh attempt immediately.
        if (foreground.isActive()) retryTimer = setTimeout(wake, jitterRetryDelay(retryDelay));
      });
      if (restart) {
        restart = false;
        retryDelay = RETRY_RESET_MS;
      } else retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
    }
  }
  const unsubscribe = foreground.subscribe((active) => {
    if (!active) {
      if (!backgroundedAt) backgroundedAt = Date.now();
      // An off-screen retry only wakes the radio. Foreground return restarts
      // the stream through the cycle below.
      clearTimeout(retryTimer);
      retryTimer = undefined;
      return;
    }
    const backgroundedFor = backgroundedAt ? Date.now() - backgroundedAt : 0;
    backgroundedAt = 0;
    // Suspension can miss session creation and deletion even if the stream
    // survives. Reconcile on every foreground transition.
    reconcile();
    if (shouldCycleForeground({ status: getStatus(), backgroundedFor, foregroundThreshold: SSE_FOREGROUND_CYCLE_MS })) {
      requestRestart();
    }
  });
  const watchdog = setInterval(() => {
    if (!foreground.isActive() || getStatus() !== 'connected') return;
    if (!isStreamStale({
      now: Date.now(), lastEnvelopeAt, busy: isBusy(), idleLimit: SSE_STALENESS_MS, busyLimit: SSE_BUSY_STALENESS_MS,
    })) return;
    lastEnvelopeAt = Date.now();
    requestRestart();
  }, WATCHDOG_TICK_MS);
  void run();
  return () => {
    controller.abort();
    attemptController?.abort();
    clearTimeout(connectTimer);
    clearInterval(watchdog);
    unsubscribe();
    wake();
  };
}
