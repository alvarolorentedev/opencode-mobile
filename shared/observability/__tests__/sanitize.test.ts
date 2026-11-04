import { describe, expect, it } from 'vitest';

import { sanitizeAttributes, sanitizeError, sanitizeRecord, scrubStack, scrubText } from '@/shared/observability/sanitize';

describe('observability sanitization', () => {
  it('keeps only allowlisted structured metadata', () => {
    expect(sanitizeAttributes({
      operation: 'transcript',
      outcome: 'success',
      contract: 'v2',
      prompt: 'secret prompt',
      url: 'https://private.example.test/session/123',
      count: 3,
    })).toEqual({ operation: 'transcript', outcome: 'success', contract: 'v2', count: 3 });
  });

  it('scrubs URLs, paths, credentials and token-like values from free text', () => {
    const value = scrubText('GET https://user:pass@private.example.test/api?token=abc123 failed at /Users/alice/project/file.ts with Authorization: Bearer abcdefghijklmnop and key=super-secret-value');
    expect(value).not.toContain('private.example.test');
    expect(value).not.toContain('/Users/alice');
    expect(value).not.toContain('abc123');
    expect(value).not.toContain('abcdefghijklmnop');
    expect(value).not.toContain('super-secret-value');
  });

  it('drops unknown metadata and sanitizes malformed records', () => {
    const record = sanitizeRecord({
      v: 1,
      ts: Number.NaN,
      kind: 'span',
      name: 'not a valid name!',
      attrs: { operation: 'http', token: 'secret', durationMs: Number.POSITIVE_INFINITY },
      traceId: 'not-a-trace',
      spanId: 'not-a-span',
      durationMs: -12,
    });
    expect(record.name).toBe('unknown');
    expect(record.attrs).toEqual({ operation: 'http' });
    expect(record.traceId).toBeUndefined();
    expect(record.spanId).toBeUndefined();
    expect(record.durationMs).toBe(0);
    expect(Number.isFinite(record.ts)).toBe(true);
  });

  it('sanitizes error stacks and object errors', () => {
    const error = sanitizeError({
      name: 'TypeError',
      message: 'failed for https://private.example.test/session/1 at /home/user/app.ts',
      stack: 'Error: boom\n    at /home/user/app.ts:12:3\n    at https://private.example.test/app.js:1:2',
      code: 'auth=secret',
      prompt: 'do not include',
    });
    expect(error.message).not.toContain('private.example.test');
    expect(error.stack).not.toContain('/home/user');
    expect(error.stack).not.toContain('private.example.test');
    expect(error).not.toHaveProperty('prompt');
  });

  it('bounds stack and text values', () => {
    expect(scrubStack('x'.repeat(10000))?.length).toBeLessThanOrEqual(4000);
    expect(scrubText('x'.repeat(10000)).length).toBeLessThanOrEqual(600);
  });
});
