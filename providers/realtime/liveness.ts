export function isStreamStale({
  now,
  lastEnvelopeAt,
  busy,
  idleLimit,
  busyLimit,
}: {
  now: number;
  lastEnvelopeAt: number;
  busy: boolean;
  idleLimit: number;
  busyLimit: number;
}) {
  const limit = busy ? busyLimit : idleLimit;
  return now - lastEnvelopeAt >= limit;
}

export function shouldCycleForeground({
  status,
  backgroundedFor,
  foregroundThreshold,
}: {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  backgroundedFor: number;
  foregroundThreshold: number;
}) {
  return status !== 'connected' || backgroundedFor >= foregroundThreshold;
}
