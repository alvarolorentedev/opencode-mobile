import { createIntegrationOAuth } from '@/shared/protocol/opencode/v2/capabilities';
import { formToPrompts, type V2Context } from '@/shared/protocol/opencode/v2/shared';
import type { ProviderAuthMethod, ProviderAuthValues } from '@/shared/protocol/opencode/types';
export function buildMcpOAuth(ctx: V2Context) {
  const oauth = createIntegrationOAuth(ctx);
  const location = ctx.directory ? { location: { directory: ctx.directory } } : {};
  const integration = async (name: string) => {
    const server = (await ctx.api.mcp.list(location)).data.find((item) => item.name === name);
    if (!server?.integrationID) throw new Error('This MCP server does not expose authentication.');
    return (await ctx.api.integration.get({ ...location, integrationID: server.integrationID })).data;
  };
  return {
    ...oauth,
    methods: async (name: string): Promise<ProviderAuthMethod[]> => (await integration(name)).methods.filter((method) => method.type === 'oauth').map((method) => ({ type: 'oauth', label: method.label, prompts: formToPrompts(method.form) })),
    start: async (name: string, methodIndex = 0, values?: ProviderAuthValues) => {
      const entry = await integration(name);
      const method = entry.methods.filter((method) => method.type === 'oauth')[methodIndex];
      if (!method) throw new Error('This MCP server does not offer OAuth.');
      return oauth.start(name, entry.id, method.id, values);
    },
  };
}
