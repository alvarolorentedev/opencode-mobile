import { describe, expect, it, vi } from 'vitest';

import { buildV2Client } from '@/shared/protocol/opencode/v2-client';

const h = vi.hoisted(() => ({ api: undefined as unknown, request: undefined as unknown }));
vi.mock('@opencode/client', () => ({ OpenCode: { make: () => h.api } }));
vi.mock('@/shared/protocol/opencode/client/fetch', () => ({
  getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }),
  getRequestHeaders: () => ({}),
  createPrefixFetch: () => h.request,
}));

const settings = { serverUrl: 'http://test', directory: '/repo', username: '', password: '' } as never;

describe('v2 provider accounts', () => {
  it('maps stored credentials to accounts with method and active state', async () => {
    h.request = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: 'c1', integrationID: 'openai', label: 'Work', active: true, value: { type: 'oauth' } },
      { id: 'c2', integrationID: 'openai', label: 'Personal', active: false, value: { type: 'key' } },
    ] }), { status: 200 }));

    await expect(buildV2Client(settings).accounts!.list()).resolves.toEqual([
      { id: 'c1', providerId: 'openai', label: 'Work', method: 'oauth', active: true },
      { id: 'c2', providerId: 'openai', label: 'Personal', method: 'key', active: false },
    ]);
  });

  it('treats a missing credential endpoint as no accounts', async () => {
    h.request = vi.fn(async () => new Response('', { status: 404 }));
    await expect(buildV2Client(settings).accounts!.list()).resolves.toEqual([]);
  });
});

vi.mock('@/shared/contracts/server-url', () => ({ getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }) }));
