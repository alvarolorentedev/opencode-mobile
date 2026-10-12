import { describe, expect, it } from 'vitest';
import { classifySessionSettlement } from '@/providers/services/session-service';

describe('session settlement classification', () => {
  it('keeps running work active and never treats a blocker as completion', () => {
    expect(classifySessionSettlement({ status: { type: 'busy' }, queued: false, blocked: false }).state).toBe('running');
    expect(classifySessionSettlement({ status: { type: 'retry' } as any, queued: false, blocked: false }).state).toBe('retrying');
    expect(classifySessionSettlement({ status: { type: 'idle' }, queued: true, blocked: false }).state).toBe('running');
    expect(classifySessionSettlement({ status: { type: 'idle' }, queued: false, blocked: true }).state).toBe('blocked');
  });

  it('distinguishes finished, failed, and aborted terminal states', () => {
    expect(classifySessionSettlement({ status: { type: 'idle' }, queued: false, blocked: false }).state).toBe('finished');
    expect(classifySessionSettlement({ status: { type: 'idle' }, queued: false, blocked: false, error: { name: 'APIError', data: { message: 'boom' } } }))
      .toEqual({ state: 'failed', message: 'boom' });
    expect(classifySessionSettlement({ status: { type: 'idle' }, queued: false, blocked: false, error: { name: 'MessageAbortedError' } }).state).toBe('aborted');
  });
});
