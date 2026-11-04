import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ConnectionFailureKind } from '@/shared/protocol/opencode/client';
import { isRetryableConnectionFailure } from '@/shared/protocol/opencode/client/errors';

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 20_000] as const;

// Connect failures are retryable while the app is foregrounded and the radio is
// online. Auth/entitlement/incompatible failures are deliberately excluded:
// replaying them only hides the action the user needs to take. After the
// bounded budget the banner asks for an explicit Retry instead of looping on a
// wrong URL forever.
export function useConnectionRetry({
  active,
  paused = false,
  status,
  kind,
  online,
  connect,
}: {
  active: boolean;
  paused?: boolean;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  kind?: ConnectionFailureKind;
  online: boolean;
  connect: () => Promise<unknown>;
}) {
  const [retryAt, setRetryAt] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(0);
  const onlineRef = useRef(online);
  const connectRef = useRef(connect);
  useLayoutEffect(() => { connectRef.current = connect; });

  useEffect(() => {
    const wasOffline = !onlineRef.current;
    onlineRef.current = online;
    if (status === 'connected' || status === 'idle') {
      attemptRef.current = 0;
      return;
    }
    // A retry moves the state to `connecting`; that must not reset the attempt
    // budget or a persistently failing URL would retry forever.
    if (status === 'connecting') return;
    if (!active || paused || !online || (kind && !isRetryableConnectionFailure(kind)) || attemptRef.current >= RETRY_DELAYS_MS.length) {
      return;
    }
    // A network restoration should not wait for the current multi-second
    // backoff slot; give the radio a brief moment and retry.
    const delay = wasOffline ? 500 : RETRY_DELAYS_MS[Math.min(attemptRef.current, RETRY_DELAYS_MS.length - 1)];
    const at = Date.now() + delay;
    const listedAttempt = attemptRef.current + 1;
    // Publish after the effect commit. Synchronous state writes in an effect
    // add a render pass without changing the external retry timer.
    const publish = setTimeout(() => {
      setRetryAt(at);
      setAttempt(listedAttempt);
    }, 0);
    const timer = setTimeout(() => {
      attemptRef.current += 1;
      setRetryAt(undefined);
      void connectRef.current().catch(() => undefined);
    }, delay);
    return () => {
      clearTimeout(publish);
      clearTimeout(timer);
    };
  }, [active, kind, online, paused, status]);

  const canRetry = status === 'error'
    && active
    && !paused
    && online
    && (!kind || isRetryableConnectionFailure(kind))
    && attempt < RETRY_DELAYS_MS.length;
  return useMemo(() => ({
    retryAt: canRetry ? retryAt : undefined,
    attempt: status === 'error' ? attempt : 0,
    maxAttempts: RETRY_DELAYS_MS.length,
  }), [canRetry, retryAt, status, attempt]);
}
