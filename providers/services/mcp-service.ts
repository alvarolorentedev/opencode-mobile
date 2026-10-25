import type { McpLocalConfig, McpRemoteConfig, McpStatus } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { createServerAdapter } from '@/lib/opencode/contracts/server-adapter';

export function startLegacyMcpOAuth(client: ScopedOpencodeClient, name: string) {
  return createServerAdapter(client).mcp.startOAuth(name);
}
export function completeLegacyMcpOAuth(client: ScopedOpencodeClient, name: string, code: string) {
  return createServerAdapter(client).mcp.completeOAuth(name, code);
}
export function getMcpStatus(client: ScopedOpencodeClient): Promise<Record<string, McpStatus>> {
  return createServerAdapter(client).mcp.status();
}
export function addMcpServer(client: ScopedOpencodeClient, name: string, config: McpLocalConfig | McpRemoteConfig) {
  return createServerAdapter(client).mcp.add(name, config);
}
export function connectMcpServer(client: ScopedOpencodeClient, name: string) {
  return createServerAdapter(client).mcp.connect(name);
}
export function disconnectMcpServer(client: ScopedOpencodeClient, name: string) {
  return createServerAdapter(client).mcp.disconnect(name);
}
