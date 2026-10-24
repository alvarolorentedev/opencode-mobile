import { startMcpOAuth as startLegacyOAuth, completeMcpOAuth as completeLegacyOAuth } from '@/lib/opencode/compat/v1/mcp';
import type { McpContextValue } from './opencode-provider-types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { McpLocalConfig, McpRemoteConfig, McpStatus } from '@/lib/opencode/types';
import {
  addMcpServer as svcAddMcpServer,
  connectMcpServer as svcConnectMcpServer,
  disconnectMcpServer as svcDisconnectMcpServer,
  getMcpStatus,
} from '@/providers/services/mcp-service';

// MCP server status plus its lifecycle actions. Enabling or adding a server can
// change the capability set, so those actions refresh chat capabilities through
// the injected callback.
export function useMcpState({
  client,
  isCurrentClient,
  refreshChatCapabilities,
}: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  refreshChatCapabilities: () => Promise<void>;
}) {
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, McpStatus>>({});

  const resetMcpState = useCallback(() => setMcpStatuses({}), []);

  const refreshMcpServers = useCallback(async () => {
    const next = await getMcpStatus(client);
    if (isCurrentClient(client)) setMcpStatuses(next);
  }, [client, isCurrentClient]);

  const addMcpServer = useCallback(async (name: string, config: McpLocalConfig | McpRemoteConfig) => {
    await svcAddMcpServer(client, name.trim(), config);
    await Promise.all([refreshMcpServers(), refreshChatCapabilities()]);
  }, [client, refreshChatCapabilities, refreshMcpServers]);

  const connectMcpServer = useCallback(async (name: string) => {
    await svcConnectMcpServer(client, name);
    await refreshMcpServers();
  }, [client, refreshMcpServers]);

  const disconnectMcpServer = useCallback(async (name: string) => {
    await svcDisconnectMcpServer(client, name);
    await refreshMcpServers();
  }, [client, refreshMcpServers]);

  const mcpOAuth = useMemo<McpContextValue['mcpOAuth']>(() => {
    const names = new Set<string>();
    const current = () => { if (!isCurrentClient(client)) throw new Error('The connection changed before sign-in completed.'); };
    const checked = async <T,>(action: Promise<T>) => { const result = await action; current(); return result; };
    return {
      methods: (name) => checked(client.mcpOAuth ? client.mcpOAuth.methods(name) : Promise.resolve([{ type: 'oauth' as const, label: 'OAuth' }])),
      start: async (name, method, values) => {
        current(); names.add(name);
        if (client.mcpOAuth) return checked(client.mcpOAuth.start(name, method, values));
        const result = await checked(startLegacyOAuth(client.compatibility!, name));
        return { url: result.authorizationUrl, method: 'code' as const };
      },
      complete: async (name, code) => {
        current();
        if (client.mcpOAuth) await checked(client.mcpOAuth.complete(name, code.trim()));
        else await checked(completeLegacyOAuth(client.compatibility!, name, code.trim()));
        names.delete(name); await refreshMcpServers();
      },
      wait: async (name) => {
        current();
        if (!client.mcpOAuth) throw new Error('Enter the MCP authorization code to complete sign-in.');
        await checked(client.mcpOAuth.wait(name));
        names.delete(name); await refreshMcpServers();
      },
      cancel: async (name) => { names.delete(name); await client.mcpOAuth?.cancel(name); },
      dispose: () => { for (const name of names) void client.mcpOAuth?.cancel(name).catch(() => undefined); names.clear(); },
    };
  }, [client, isCurrentClient, refreshMcpServers]);
  useEffect(() => () => (mcpOAuth as McpContextValue['mcpOAuth'] & { dispose: () => void }).dispose(), [mcpOAuth]);

  return {
    mcpStatuses,
    refreshMcpServers,
    addMcpServer,
    connectMcpServer,
    disconnectMcpServer,
    mcpOAuth,
    resetMcpState,
  };
}
