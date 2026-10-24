import { describe, expect, it } from 'vitest';

import { jitterRetryDelay, MAX_RETRY_MS, nextRetryDelay, RETRY_RESET_MS } from '@/providers/realtime/backoff';
import { isStreamStale, shouldCycleForeground } from '@/providers/realtime/liveness';
import { nextPollDelay, shouldPoll } from '@/providers/realtime/polling';
import { collectReconcileSessionIds } from '@/providers/realtime/reconcile';

describe('realtime backoff', () => {
  it('keeps the first recovery attempt fixed and jitters later attempts', () => {
    expect(jitterRetryDelay(RETRY_RESET_MS, () => 0)).toBe(RETRY_RESET_MS);
    expect(jitterRetryDelay(2_000, () => 0)).toBe(1_600);
    expect(jitterRetryDelay(2_000, () => 1)).toBe(2_400);
  });

  it('doubles the retry delay up to the cap', () => {
    expect(nextRetryDelay(1_000)).toBe(2_000);
    expect(nextRetryDelay(8_000)).toBe(15_000);
    expect(nextRetryDelay(MAX_RETRY_MS)).toBe(MAX_RETRY_MS);
  });
});

describe('realtime liveness', () => {
  it('uses the busy window while work is active', () => {
    expect(isStreamStale({ now: 44_999, lastEnvelopeAt: 0, busy: true, idleLimit: 60_000, busyLimit: 45_000 })).toBe(false);
    expect(isStreamStale({ now: 45_000, lastEnvelopeAt: 0, busy: true, idleLimit: 60_000, busyLimit: 45_000 })).toBe(true);
  });

  it('cycles an unhealthy stream or one backgrounded past the threshold', () => {
    expect(shouldCycleForeground({ status: 'connected', backgroundedFor: 1_000, foregroundThreshold: 5_000 })).toBe(false);
    expect(shouldCycleForeground({ status: 'connected', backgroundedFor: 5_000, foregroundThreshold: 5_000 })).toBe(true);
    expect(shouldCycleForeground({ status: 'error', backgroundedFor: 0, foregroundThreshold: 5_000 })).toBe(true);
  });
});

describe('realtime polling', () => {
  it('polls whenever the stream is down or work is active', () => {
    expect(shouldPoll(true, false)).toBe(false);
    expect(shouldPoll(true, true)).toBe(true);
    expect(shouldPoll(false, false)).toBe(true);
  });

  it('uses the stream/constrained cadence and backs off after failures', () => {
    expect(nextPollDelay({ streamConnected: true, constrained: false, failures: 0 })).toBe(10_000);
    expect(nextPollDelay({ streamConnected: true, constrained: true, failures: 0 })).toBe(15_000);
    expect(nextPollDelay({ streamConnected: false, constrained: false, failures: 0 })).toBe(5_000);
    expect(nextPollDelay({ streamConnected: false, constrained: true, failures: 0 })).toBe(8_000);
    expect(nextPollDelay({ streamConnected: false, constrained: false, failures: 1 })).toBe(10_000);
    expect(nextPollDelay({ streamConnected: false, constrained: false, failures: 3 })).toBe(30_000);
  });
});

describe('reconcile session set', () => {
  it('deduplicates pending, current, and conversation sessions', () => {
    expect([...collectReconcileSessionIds({
      pendingSessionIds: ['pending', 'current', ''],
      currentSessionId: 'current',
      conversationSessionId: 'conversation',
    })]).toEqual(['pending', 'current', 'conversation']);
  });
});
