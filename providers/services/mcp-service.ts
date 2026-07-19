import type { McpLocalConfig, McpRemoteConfig, OpencodeClient } from '@opencode-ai/sdk/v2/client';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) throw new Error(`OpenCode ${operation} returned no data.`);
  return data;
}

export async function getMcpStatus(client: OpencodeClient) {
  return requireData((await client.mcp.status()).data, 'MCP status request');
}

export async function addMcpServer(client: OpencodeClient, name: string, config: McpLocalConfig | McpRemoteConfig) {
  await client.mcp.add({ name, config });
  return updateMcpConfig(client, (mcp) => { mcp[name] = config; });
}

export async function connectMcpServer(client: OpencodeClient, name: string) {
  return requireData((await client.mcp.connect({ name })).data, 'MCP connect request');
}

export async function disconnectMcpServer(client: OpencodeClient, name: string) {
  return requireData((await client.mcp.disconnect({ name })).data, 'MCP disconnect request');
}

export async function startMcpOAuth(client: OpencodeClient, name: string) {
  return requireData((await client.mcp.auth.start({ name })).data, 'MCP OAuth start request');
}

export async function completeMcpOAuth(client: OpencodeClient, name: string, code: string) {
  return requireData((await client.mcp.auth.callback({ name, code })).data, 'MCP OAuth callback request');
}

export async function removeMcpOAuth(client: OpencodeClient, name: string) {
  return requireData((await client.mcp.auth.remove({ name })).data, 'MCP OAuth removal request');
}

async function updateMcpConfig(client: OpencodeClient, update: (mcp: NonNullable<Awaited<ReturnType<typeof getConfig>>['mcp']>) => void) {
  const config = await getConfig(client);
  const mcp = { ...config.mcp };
  update(mcp);
  return requireData((await client.config.update({ config: { ...config, mcp } })).data, 'MCP config update');
}

async function getConfig(client: OpencodeClient) {
  return requireData((await client.config.get()).data, 'config request');
}

export function setMcpServerEnabled(client: OpencodeClient, name: string, enabled: boolean) {
  return updateMcpConfig(client, (mcp) => {
    const config = mcp[name];
    if (!config) throw new Error(`MCP server "${name}" is not configured.`);
    mcp[name] = { ...config, enabled };
  });
}
