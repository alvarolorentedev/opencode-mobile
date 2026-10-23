// Request-class policy for the data plane. Deadlines are deliberately
// generous enough for a usable 3G link, but finite so a stalled request cannot
// hold a screen forever. Streaming responses are governed by the SSE
// liveness watchdog instead.
export const READ_TIMEOUT_MS = 30_000;
export const WRITE_TIMEOUT_MS = 60_000;
export const RETRYABLE_RESPONSE_STATUS = new Set([502, 503, 504]);
const IDEMPOTENT_READ_RETRY_AFTER_MS = 10_000;

export function isEventStreamUrl(url: string) {
  return /\/event\/?(?:\?|$)/.test(url);
}

export function isIdempotentRead(method: string | undefined) {
  return (method ?? 'GET').toUpperCase() === 'GET' || (method ?? '').toUpperCase() === 'HEAD';
}

export function getRequestTimeout(url: string, method: string | undefined) {
  if (isEventStreamUrl(url)) return undefined;
  return isIdempotentRead(method) ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
}

// A fast transport failure can be retried once because GET/HEAD have no
// server-side effect. A request that already consumed most of the read budget
// is not retried: doubling the wait is worse for a 3G user than surfacing the
// failure and letting the caller decide.
export function shouldRetryRead(input: {
  method?: string;
  url: string;
  attempt: number;
  elapsedMs: number;
  error?: unknown;
  status?: number;
}) {
  if (input.attempt > 0 || !isIdempotentRead(input.method) || isEventStreamUrl(input.url)) return false;
  if (input.elapsedMs > IDEMPOTENT_READ_RETRY_AFTER_MS) return false;
  if (input.status !== undefined) return RETRYABLE_RESPONSE_STATUS.has(input.status);
  if (!input.error) return false;
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  // Cancellation is user intent, not a transient failure. Credential and
  // entitlement errors are actionable and must not be replayed.
  return !/abort|cancel|credential|unauthorized|forbidden|entitlement|pair this device|certificate|TLS|SSL/i.test(message);
}
