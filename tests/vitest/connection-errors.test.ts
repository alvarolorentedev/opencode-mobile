import { describe, expect, it, vi } from 'vitest';

import { getConnectionErrorMessage } from '@/lib/opencode/client/errors';

vi.mock('@/lib/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://127.0.0.1:4096' } }));

describe('connection error copy', () => {
  it('adds the API hint only for non-API URLs and the version hint only for /api URLs', () => {
    const notApi = new Error('Unsupported content type');

    const root = getConnectionErrorMessage(notApi, 'http://example.test');
    expect(root).toContain('If this address serves a web UI');
    expect(root).not.toContain('This app supports OpenCode 1.x and 2.x');

    const api = getConnectionErrorMessage(notApi, 'http://example.test/api');
    expect(api).not.toContain('If this address serves a web UI');
    expect(api).toContain('This app supports OpenCode 1.x and 2.x');
  });
});
