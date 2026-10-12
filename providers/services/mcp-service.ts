import type { McpLocalConfig, McpRemoteConfig, McpStatus } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { mcpConfigToV2 } from '@/lib/opencode/v2/shared';
import * as v1 from '@/lib/opencode/compat/v1/mcp';
const location = (client: ScopedOpencodeClient) => ({ location: { directory: client.__opencode.directory } });
export async function getMcpStatus(client: ScopedOpencodeClient): Promise<Record<string, McpStatus>> {
  if (client.compatibility) return v1.getMcpStatus(client.compatibility);
  return Object.fromEntries((await client.api!.mcp.list(location(client))).data.map((server) => [server.name, { ...server.status, ...(server.integrationID ? { integrationID: server.integrationID } : {}) }]));
}
export async function addMcpServer(client: ScopedOpencodeClient, name: string, config: McpLocalConfig | McpRemoteConfig) {
  if (client.compatibility) return v1.addMcpServer(client.compatibility, name, config);
  await client.api!.mcp.add({ ...location(client), server: name, config: mcpConfigToV2(config) });
}
export async function connectMcpServer(client: ScopedOpencodeClient, name: string) {
  return client.compatibility ? v1.connectMcpServer(client.compatibility, name) : client.api!.mcp.connect({ ...location(client), server: name });
}
export async function disconnectMcpServer(client: ScopedOpencodeClient, name: string) {
  return client.compatibility ? v1.disconnectMcpServer(client.compatibility, name) : client.api!.mcp.disconnect({ ...location(client), server: name });
}
export async function setMcpServerEnabled(client: ScopedOpencodeClient, name: string, enabled: boolean) {
  if (!client.compatibility) throw new Error('Persistent MCP enablement is unavailable on OpenCode 2.');
  return v1.setMcpServerEnabled(client.compatibility, name, enabled);
}
