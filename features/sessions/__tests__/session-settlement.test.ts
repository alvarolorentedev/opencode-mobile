import { describe, expect, it } from 'vitest';
import { classifySessionSettlement } from '@/shared/protocol/services/session-service';

describe('session settlement classification', () => {
  it('keeps running work active and never treats a blocker as completion', () => {
    expect(classifySessionSettlement({ status: { type: 'busy' }, queued: false, blocked: false }).state).toBe('running');
    expect(classifySessionSettlement({ status: { type: 'retry' } as any, queued: false, blocked: false }).state).toBe('retrying');
    expect(classifySessionSettlement({ status: { type: 'idle' }, queued: true, blocked: false }).state).toBe('running');
    expect(classifySessionSettlement({ status: { type: 'idle' }, queued: false, blocked: true }).state).toBe('blocked');
  });

  it('distinguishes finished, failed, and aborted terminal states', () => {
    expect(classifySessionSettlement({ status: { type: 'idle' }, queued: false, blocked: false }).state).toBe('finished');
    expect(classifySessionSettlement({
      status: { type: 'idle' }, queued: false, blocked: false,
      latestAssistant: { created: 10, error: { name: 'APIError', data: { message: 'boom' } } },
    })).toEqual({ state: 'failed', message: 'boom' });
    expect(classifySessionSettlement({
      status: { type: 'idle' }, queued: false, blocked: false,
      latestAssistant: { created: 10, error: { name: 'MessageAbortedError' } },
    }).state).toBe('aborted');
  });

  it('keeps a request without a response unknown instead of finished', () => {
    expect(classifySessionSettlement({ status: { type: 'idle' }, queued: false, blocked: false, notBefore: 10_000 }).state)
      .toBe('unknown');
    expect(classifySessionSettlement({
      status: { type: 'idle' }, queued: false, blocked: false, notBefore: 10_000,
      latestAssistant: { created: 5_000 },
    }).state).toBe('unknown');
    // An error from a previous turn cannot label the new request as failed.
    expect(classifySessionSettlement({
      status: { type: 'idle' }, queued: false, blocked: false, notBefore: 10_000,
      latestAssistant: { created: 5_000, error: { name: 'APIError', data: { message: 'old failure' } } },
    }).state).toBe('unknown');
  });

  it('accepts a response for the request, allowing small clock skew', () => {
    expect(classifySessionSettlement({
      status: { type: 'idle' }, queued: false, blocked: false, notBefore: 10_000,
      latestAssistant: { created: 10_000 },
    }).state).toBe('finished');
    expect(classifySessionSettlement({
      status: { type: 'idle' }, queued: false, blocked: false, notBefore: 10_000,
      latestAssistant: { created: 9_000 },
    }).state).toBe('finished');
  });
});
