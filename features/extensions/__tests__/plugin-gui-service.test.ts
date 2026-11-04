import { describe, expect, it, vi } from 'vitest';

import { readPluginGui } from '@/features/extensions/services/plugin-gui-service';

const h = vi.hoisted(() => ({ request: undefined as unknown }));

vi.mock('@/shared/protocol/opencode/client/fetch', () => ({
  createPrefixFetch: () => h.request,
  getRequestHeaders: (settings: { password: string }) =>
    settings.password ? { Authorization: 'Basic abc', 'X-Gateway': 'token' } : undefined,
}));
vi.mock('@/shared/protocol/opencode/v2/shared', () => ({
  resolveV2Base: () => ({ base: { origin: 'http://server', pathPrefix: '' }, pathPrefix: '' }),
}));

const settings = { serverUrl: 'http://server', username: '', password: 'secret', directory: '' };

describe('plugin GUI service', () => {
  it('authenticates the raw bundle request and scopes it to the active project', async () => {
    h.request = vi.fn(async () =>
      new Response(JSON.stringify({ data: { code: 'module.exports={setup(){}}', revision: 'r1', options: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await readPluginGui({ ...settings, directory: '/repo' }, 'flowgraph');

    const [url, init] = (h.request as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://server/api/plugin/gui?id=flowgraph&location%5Bdirectory%5D=%2Frepo');
    expect(init.headers).toEqual({
      Authorization: 'Basic abc',
      'X-Gateway': 'token',
      accept: 'application/json',
    });
  });

  it('surfaces the server status when the bundle is rejected', async () => {
    h.request = vi.fn(async () => new Response('', { status: 401 }));

    await expect(readPluginGui(settings, 'flowgraph')).rejects.toThrow('Could not read the plugin GUI (401).');
  });
});
