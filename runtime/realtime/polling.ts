export const MAX_POLL_DELAY_MS = 30_000;

export function shouldPoll(streamConnected: boolean, busy: boolean) {
  return !streamConnected || busy;
}

export function nextPollDelay({
  streamConnected,
  constrained,
  failures,
  max = MAX_POLL_DELAY_MS,
}: {
  streamConnected: boolean;
  constrained: boolean;
  failures: number;
  max?: number;
}) {
  const baseMs = streamConnected
    ? (constrained ? 15_000 : 10_000)
    : (constrained ? 8_000 : 5_000);
  return Math.min(baseMs * (2 ** failures), max);
}
