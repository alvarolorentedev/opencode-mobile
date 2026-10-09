import { describe, it, expect, vi } from 'vitest';

import { modelToV1, projectToV1, sessionToV1 } from '@/lib/opencode/v2-mappers';
import { mapSavedPermission, messageToV1 } from '@/lib/opencode/v2/mappers';
import { buildV2Client } from '@/lib/opencode/v2-client';

const h = vi.hoisted(() => ({ api: undefined as unknown }));
vi.mock('@opencode/client', () => ({ OpenCode: { make: () => h.api } }));
vi.mock('@/lib/opencode/client', () => ({
  getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }),
  getRequestHeaders: () => ({}),
  createPrefixFetch: () => () => {},
}));

describe('v2 response mappers', () => {
  it('preserves session usage fields', () => {
    const session = sessionToV1({
      id: 'ses_1',
      projectID: 'project-1',
      title: 'Chat',
      agent: 'build',
      model: { id: 'sonnet', providerID: 'anthropic' },
      cost: 0.42,
      tokens: { input: 1200, output: 240, reasoning: 10, cache: { read: 800, write: 100 } },
      time: { created: 1, updated: 2 },
    } as never);
    expect(session.model).toEqual({ id: 'sonnet', providerID: 'anthropic' });
    expect(session.agent).toBe('build');
    expect(session.cost).toBe(0.42);
    expect(session.tokens).toEqual({ input: 1200, output: 240, reasoning: 10, cache: { read: 800, write: 100 } });
    expect(session.title).toBe('Chat');
    expect(session.time).toEqual({ created: 1, updated: 2 });

    const minimalSession = sessionToV1({ id: 'ses_2', projectID: 'project-1', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, updated: 0 } } as never);
    expect(minimalSession.title).toBe('');
    expect(minimalSession.model).toBeUndefined();
  });

  it('maps an assistant retry into a retry transcript part', () => {
    const mapped = messageToV1({
      id: 'msg_1',
      type: 'assistant',
      sessionID: 'ses_1',
      time: { created: 1 },
      content: [],
      retry: { attempt: 3, at: 99, error: { type: 'SessionError', message: 'The provider response ended unexpectedly.' } },
    } as never, 'ses_1');
    const retryPart = mapped?.parts.find((part) => part.type === 'retry');
    expect(retryPart).toMatchObject({
      attempt: 3,
      error: { name: 'SessionError', data: { message: 'The provider response ended unexpectedly.' } },
    });
  });

  it('maps a saved permission rule', () => {
    expect(mapSavedPermission({ id: 'rule-1', action: 'edit', resource: 'src/**', time: { created: 42 } })).toEqual({
      id: 'rule-1',
      action: 'edit',
      resource: 'src/**',
      createdAt: 42,
    });
    expect(mapSavedPermission({ id: 'rule-2', action: 'bash', resource: 'git *' })).toEqual({
      id: 'rule-2',
      action: 'bash',
      resource: 'git *',
    });
  });

  it('maps projects', () => {    expect(projectToV1({ id: 'project-1', canonical: '/workspace/demo', vcs: 'git', time: { created: 1, updated: 2 }, sandboxes: [] } as never)).toEqual({
      id: 'project-1',
      worktree: '/workspace/demo',
      vcs: 'git',
      time: { created: 1, initialized: 2 },
    });
  });

  it('maps model capabilities, limits, cost tiers, and reasoning signal', () => {
    function model(overrides: Record<string, unknown> = {}) {
      return {
        id: 'anthropic/sonnet',
        modelID: 'sonnet',
        providerID: 'anthropic',
        name: 'Sonnet',
        capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
        variants: [],
        time: { released: 0 },
        cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
        status: 'active',
        enabled: true,
        limit: { context: 200000, output: 8192 },
        ...overrides,
      };
    }

    const mapped = modelToV1(model({
      cost: [
        { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
        { tier: { type: 'context', size: 200000 }, input: 6, output: 22.5, cache: { read: 0.6, write: 7.5 } },
      ],
      variants: [{ id: 'high', settings: { reasoningEffort: 'high' } }],
    }) as never);
    expect(mapped.id).toBe('anthropic/sonnet');
    expect((mapped.capabilities as never as { reasoning: boolean }).reasoning).toBe(true);
    expect((mapped.capabilities as never as { attachment: boolean }).attachment).toBe(true);
    expect((mapped.capabilities as never as { toolcall: boolean }).toolcall).toBe(true);
    expect((mapped.capabilities as never as { input: unknown }).input).toEqual({ text: true, audio: false, image: true, video: false, pdf: false });
    expect(mapped.limit).toEqual({ context: 200000, output: 8192 });
    expect(mapped.cost).toEqual({
      input: 3,
      output: 15,
      cache: { read: 0.3, write: 3.75 },
      tiers: [{ input: 6, output: 22.5, cache: { read: 0.6, write: 7.5 }, tier: { type: 'context', size: 200000 } }],
    });
    expect(mapped.status).toBe('active');

    expect((modelToV1(model() as never).capabilities as never as { reasoning: boolean }).reasoning).toBe(false);
    expect((modelToV1(model({ variants: [{ id: 'fast', settings: { reasoning: false } }] }) as never).capabilities as never as { reasoning: boolean }).reasoning).toBe(false);
    expect((modelToV1(model({ cost: [], variants: [] }) as never).cost as never as { input: number }).input).toBe(0);
    expect((modelToV1(model({ cost: [{ tier: { type: 'context', size: 1000 }, input: 1, output: 2, cache: { read: 0, write: 0 } }] }) as never).cost as never as { input: number }).input).toBe(1);
    expect((modelToV1(model({ compatibility: { reasoningField: 'reasoning_content' } }) as never).capabilities as never as { reasoning: boolean }).reasoning).toBe(true);
  });
});

describe('v2 provider discovery and API-key auth', () => {
  it('keeps catalog providers addable and resolves auth methods through the filtered list', async () => {
    const providers = ['openai', 'opencode-go', 'env-provider', 'disabled'].map((id) => ({
      id, name: id, activation: id === 'disabled' ? 'disabled' : 'auto', integrationID: id,
    }));
    const integrations = providers.map(({ id }) => ({
      id, name: id, connections: id === 'env-provider' ? [{ type: 'env', name: 'API_KEY' }] : [],
      methods: [{ type: 'env', names: ['API_KEY'] }, { type: 'oauth', id: 'login', label: 'Sign in' }, { type: 'key', label: 'API key' }],
    }));
    let savedKey: unknown;
    let removedCredential: unknown;
    function model(overrides: Record<string, unknown> = {}) {
      return {
        id: 'anthropic/sonnet', modelID: 'sonnet', providerID: 'anthropic', name: 'Sonnet',
        capabilities: { tools: true, input: ['text'], output: ['text'] }, variants: [], time: { released: 0 },
        cost: [{ input: 1, output: 2, cache: { read: 0, write: 0 } }], status: 'active', enabled: true,
        limit: { context: 1, output: 1 }, ...overrides,
      };
    }
    const api: any = {
      credential: { remove: async ({ credentialID }: any) => { removedCredential = credentialID; } },
      provider: { list: async () => ({ data: providers }) },
      model: { list: async () => ({ data: providers.map(({ id }) => model({ providerID: id, enabled: id === 'openai' || id === 'disabled' })) }), default: async () => ({ data: null }) },
      integration: {
        list: async () => ({ data: integrations }),
        connect: { key: async ({ integrationID, key }: any) => {
          savedKey = { integrationID, key };
          integrations.find((item) => item.id === integrationID)!.connections.push({ type: 'credential', id: 'credential-go', method: 'key' });
        } },
        oauth: { connect: async ({ methodID }: any) => {
          expect(methodID).toBe('login');
          return { data: { attemptID: 'attempt', url: 'https://example.com/login', mode: 'code' } };
        } },
      },
    };
    h.api = api;
    const client = buildV2Client({ serverUrl: 'http://test', directory: '/repo', username: '', password: '' } as never);

    expect(Array.from((await client.provider.list()).data.connected)).toEqual(['openai', 'env-provider']);

    // Real V2 servers omit unconnected providers and their models entirely.
    api.provider.list = async () => ({ data: providers.filter(({ id }) => id === 'openai') });
    integrations.push({ id: 'mcp-tools', name: 'Tools', metadata: { source: 'mcp' }, connections: [], methods: [{ type: 'oauth', id: 'mcp-login' }] });
    const catalog = (await client.provider.list()).data;
    expect(catalog.all.some((provider: any) => provider.id === 'opencode-go')).toBe(true);
    expect(catalog.all.some((provider: any) => provider.id === 'mcp-tools')).toBe(false);
    expect(Array.from((await client.provider.auth()).data['opencode-go'], (method: any) => method.type)).toEqual(['oauth', 'api']);
    await client.provider.oauth.authorize({ providerID: 'opencode-go', method: 0 });
    await client.auth.set({ providerID: 'opencode-go', auth: { type: 'api', key: 'test-go-key' } });
    expect(savedKey).toEqual({ integrationID: 'opencode-go', key: 'test-go-key' });

    api.provider.list = async () => ({ data: providers });
    expect(Array.from((await client.provider.list()).data.connected)).toEqual(['openai', 'opencode-go', 'env-provider']);
    providers.find(({ id }) => id === 'opencode-go')!.integrationID = 'openai';
    integrations.find(({ id }) => id === 'openai')!.methods = [{ type: 'oauth', id: 'console-login', label: 'Console account' }];
    expect(Array.from((await client.provider.auth()).data['opencode-go'], (method: any) => method.type)).toEqual(['oauth', 'api']);
    await client.auth.set({ providerID: 'opencode-go', auth: { type: 'api', key: 'second-go-key' } });
    expect(savedKey).toEqual({ integrationID: 'opencode-go', key: 'second-go-key' });
    await client.auth.remove({ providerID: 'opencode-go' });
    expect(removedCredential).toBe('credential-go');
  });

  it('maps V2 integration form fields into normalized auth prompts', async () => {
    h.api = {
      provider: { list: async () => ({ data: [{ id: 'openai', name: 'OpenAI', integrationID: 'openai' }] }) },
      integration: {
        list: async () => ({ data: [{
          id: 'openai', name: 'OpenAI', connections: [],
          methods: [{ id: 'browser', type: 'oauth', label: 'Sign in', form: [
            { key: 'account', type: 'string', title: 'Account', options: [{ value: 'a', label: 'A' }] },
            { key: 'device', type: 'boolean', title: 'Device', default: true },
            { key: 'limit', type: 'integer', title: 'Limit', minimum: 1, maximum: 9 },
          ] }],
        }] }),
      },
    };
    const client = buildV2Client({ serverUrl: 'http://test', directory: '/repo', username: '', password: '' } as never);
    const methods = (await client.provider.auth()).data as Record<string, Array<{ prompts?: Array<Record<string, unknown>> }>>;
    expect(methods.openai[0].prompts?.map((prompt) => prompt.type)).toEqual(['select', 'boolean', 'integer']);
    expect(methods.openai[0].prompts?.[0].options).toEqual([{ label: 'A', value: 'a' }]);
    expect(methods.openai[0].prompts?.[1].defaultValue).toBe(true);
    expect(methods.openai[0].prompts?.[2]).toMatchObject({ min: 1, max: 9 });
  });
});
