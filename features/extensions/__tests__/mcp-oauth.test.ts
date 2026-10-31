import { describe, expect, it, vi } from 'vitest';
import { buildMcpOAuth } from '@/shared/protocol/opencode/v2/mcp';
import { createIntegrationOAuth } from '@/shared/protocol/opencode/v2/capabilities';
vi.mock('@/shared/contracts/server-url', () => ({ getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }) }));

function fixture(mode: 'auto' | 'code' = 'auto') {
  const oauth = {
    connect: vi.fn(async () => ({ data: { attemptID: 'a', url: 'https://login.test', mode } })),
    complete: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    status: vi.fn(async () => ({ data: { status: 'complete' } })),
  };
  const api = {
    mcp: { list: vi.fn(async () => ({ data: [{ name: 'tools', integrationID: 'integration-tools' }] })) },
    integration: { get: vi.fn(async () => ({ data: { id: 'integration-tools', methods: [{ type: 'key' }, { type: 'oauth', id: 'browser', label: 'Sign in', form: [{ type: 'boolean', key: 'device', title: 'Device', default: true }] }] } })), oauth },
  };
  const ctx = { api, directory: '/repo' } as never;
  return { api, oauth, ctx };
}

describe('native MCP authorization', () => {
  it.each(['auto', 'code'] as const)('uses the exposed integration and preserves %s mode and form answers', async (mode) => {
    const { api, oauth, ctx } = fixture(mode);
    const actions = buildMcpOAuth(ctx);
    expect(await actions.methods('tools')).toMatchObject([{ label: 'Sign in', prompts: [{ key: 'device', defaultValue: true }] }]);
    expect(await actions.start('tools', 0, { device: true })).toMatchObject({ method: mode });
    expect(api.integration.get).toHaveBeenCalledWith({ location: { directory: '/repo' }, integrationID: 'integration-tools' });
    expect(oauth.connect).toHaveBeenCalledWith({ location: { directory: '/repo' }, integrationID: 'integration-tools', methodID: 'browser', answer: { device: true } });
    if (mode === 'auto') await actions.wait('tools'); else await actions.complete('tools', '123');
    await expect(actions.wait('tools')).rejects.toThrow('Start sign-in again');
  });
  it('requires an integration ID rather than guessing it from the MCP name', async () => {
    const { api, ctx } = fixture();
    api.mcp.list.mockResolvedValue({ data: [{ name: 'tools' }] } as never);
    await expect(buildMcpOAuth(ctx).start('tools')).rejects.toThrow('does not expose authentication');
    expect(api.integration.get).not.toHaveBeenCalled();
  });
  it('cancels an attempt that arrives after cancellation or connection cleanup', async () => {
    const { oauth, ctx } = fixture();
    let finish!: (value: unknown) => void;
    oauth.connect.mockImplementation(() => new Promise((resolve) => { finish = resolve as never; }));
    const actions = createIntegrationOAuth(ctx);
    const start = actions.start('tools', 'integration-tools', 'browser');
    await actions.cancel('tools');
    finish({ data: { attemptID: 'late', url: 'https://login.test', mode: 'auto' } });
    await expect(start).rejects.toThrow('cancelled');
    expect(oauth.cancel).toHaveBeenCalledWith({ location: { directory: '/repo' }, integrationID: 'integration-tools', attemptID: 'late' });
  });
  it('ignores completion of a cancelled in-flight status read', async () => {
    const { oauth, ctx } = fixture();
    let finish!: (value: unknown) => void;
    oauth.status.mockImplementation(() => new Promise((resolve) => { finish = resolve as never; }));
    const actions = createIntegrationOAuth(ctx);
    await actions.start('tools', 'integration-tools', 'browser');
    const wait = actions.wait('tools');
    await actions.cancel('tools'); finish({ data: { status: 'complete' } });
    await expect(wait).rejects.toThrow('cancelled');
  });
});
