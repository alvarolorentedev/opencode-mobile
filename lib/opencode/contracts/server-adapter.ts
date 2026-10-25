import type { McpLocalConfig, McpRemoteConfig, McpStatus, Pty } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { mcpConfigToV2 } from '@/lib/opencode/v2/shared';
import { getErrorMessage } from '@/lib/error-message';
import * as v1Mcp from '@/lib/opencode/compat/v1/mcp';
import * as v1Terminal from '@/lib/opencode/compat/v1/terminal';
import { loadDiagnostics as loadLegacyDiagnostics } from '@/lib/opencode/compat/v1/diagnostics';

type OptionalDiagnostic<T> =
  | { available: true; data: T }
  | { available: false; error: string };

export type Diagnostics = {
  health: OptionalDiagnostic<{ healthy: boolean; version: string }>;
  mcp: OptionalDiagnostic<Record<string, McpStatus>>;
};

export type ServerAdapter = {
  terminals: {
    list: () => Promise<Pty[]>;
    create: () => Promise<Pty>;
    remove: (ptyID: string) => Promise<unknown>;
    resize: (ptyID: string, size: { cols: number; rows: number }) => Promise<unknown>;
    connectToken: (ptyID: string) => Promise<{ ticket?: string }>;
  };
  mcp: {
    status: () => Promise<Record<string, McpStatus>>;
    add: (name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<unknown>;
    connect: (name: string) => Promise<unknown>;
    disconnect: (name: string) => Promise<unknown>;
    startOAuth: (name: string) => Promise<{ authorizationUrl: string; instructions?: string; method?: 'auto' | 'code' }>;
    completeOAuth: (name: string, code: string) => Promise<unknown>;
  };
  diagnostics: {
    load: () => Promise<Diagnostics>;
  };
};

async function optionalDiagnostic<T>(load: () => Promise<T>): Promise<OptionalDiagnostic<T>> {
  try {
    return { available: true, data: await load() };
  } catch (error) {
    return { available: false, error: getErrorMessage(error) };
  }
}

export function createServerAdapter(client: ScopedOpencodeClient): ServerAdapter {
  const location = { location: { directory: client.__opencode.directory } };
  const compatibility = client.compatibility;

  const mcp = {
    status: async (): Promise<Record<string, McpStatus>> => {
      if (compatibility) return v1Mcp.getMcpStatus(compatibility);
      return Object.fromEntries((await client.api!.mcp.list(location)).data.map((server) => [server.name, {
        ...server.status,
        ...(server.integrationID ? { integrationID: server.integrationID } : {}),
      }]));
    },
    add: async (name: string, config: McpLocalConfig | McpRemoteConfig) => {
      if (compatibility) return v1Mcp.addMcpServer(compatibility, name, config);
      await client.api!.mcp.add({ ...location, server: name, config: mcpConfigToV2(config) });
    },
    connect: (name: string) => compatibility
      ? v1Mcp.connectMcpServer(compatibility, name)
      : client.api!.mcp.connect({ ...location, server: name }),
    disconnect: (name: string) => compatibility
      ? v1Mcp.disconnectMcpServer(compatibility, name)
      : client.api!.mcp.disconnect({ ...location, server: name }),
    startOAuth: (name: string) => {
      if (!compatibility) throw new Error('MCP OAuth is unavailable.');
      return v1Mcp.startMcpOAuth(compatibility, name) as Promise<{ authorizationUrl: string; instructions?: string; method?: 'auto' | 'code' }>;
    },
    completeOAuth: (name: string, code: string) => {
      if (!compatibility) throw new Error('MCP OAuth is unavailable.');
      return v1Mcp.completeMcpOAuth(compatibility, name, code);
    },
  };

  return {
    terminals: {
      list: () => compatibility ? v1Terminal.listTerminals(compatibility) : client.api!.pty.list(location).then((result) => result.data),
      create: () => compatibility ? v1Terminal.createTerminal(compatibility, client.__opencode.directory) : client.api!.pty.create(location).then((result) => result.data),
      remove: (ptyID: string) => compatibility ? v1Terminal.removeTerminal(compatibility, ptyID) : client.api!.pty.remove({ ...location, ptyID }),
      resize: (ptyID: string, size: { cols: number; rows: number }) => compatibility
        ? v1Terminal.resizeTerminal(compatibility, ptyID, size)
        : client.api!.pty.update({ ...location, ptyID, size }),
      connectToken: (ptyID: string) => compatibility
        ? v1Terminal.createTerminalConnectToken(compatibility, ptyID)
        : client.api!.pty.connect.token({ ...location, ptyID }, { headers: { 'x-opencode-ticket': '1' } }).then((result) => result.data as { ticket?: string }),
    },
    mcp,
    diagnostics: {
      load: async () => {
        if (compatibility) return loadLegacyDiagnostics(compatibility);
        const [health, mcpStatus] = await Promise.all([
          optionalDiagnostic(async () => ({ healthy: true, version: (await client.api!.server.info()).version })),
          optionalDiagnostic<Record<string, McpStatus>>(() => mcp.status()),
        ]);
        return { health, mcp: mcpStatus };
      },
    },
  };
}
