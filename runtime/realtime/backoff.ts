export const RETRY_RESET_MS = 1_000;
export const MAX_RETRY_MS = 15_000;

export function jitterRetryDelay(attemptDelay: number, random: () => number = Math.random) {
  // Full jitter above the first second avoids a synchronized retry burst after
  // a cell-wide outage while keeping the first recovery attempt fast.
  if (attemptDelay <= RETRY_RESET_MS) return attemptDelay;
  return Math.round(attemptDelay * (0.8 + random() * 0.4));
}

export function nextRetryDelay(currentDelay: number, max = MAX_RETRY_MS) {
  return Math.min(currentDelay * 2, max);
}
