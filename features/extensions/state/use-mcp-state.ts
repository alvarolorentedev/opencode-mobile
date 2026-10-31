import { useCallback, useEffect, useMemo, useState } from 'react';
import type { McpContextValue } from '@/features/extensions/model/types';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { McpLocalConfig, McpRemoteConfig } from '@/shared/protocol/opencode/types';
import { useQueryActivity, useQueryIdentity } from '@/shared/server-data/client';
import { mcpOptions } from '@/shared/server-data/diagnostics';
import { completeLegacyMcpOAuth, startLegacyMcpOAuth, addMcpServer as svcAddMcpServer, connectMcpServer as svcConnectMcpServer, disconnectMcpServer as svcDisconnectMcpServer } from '@/shared/protocol/services/mcp-service';
import { useQueries, useQueryClient } from '@tanstack/react-query';

const EMPTY_STATUSES: Record<string, import('@/shared/protocol/opencode/types').McpStatus> = {};
// Status shares the same query as diagnostics and extension discovery.
export function useMcpState({
  client,
  isCurrentClient,
}: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
}) {
  const identity = useQueryIdentity();
  const cache = useQueryClient();
  const active = useQueryActivity();
  const [requested, setRequested] = useState(false);
  const [query] = useQueries({ queries: [{ ...mcpOptions(identity, client), enabled: active && requested, subscribed: active && requested }].filter(() => active && requested) });
  const refreshMcpServers = useCallback(async () => {
    setRequested(true);
    await cache.invalidateQueries({ queryKey: mcpOptions(identity, client).queryKey, refetchType: 'none' });
    if (active && isCurrentClient(client)) await cache.fetchQuery(mcpOptions(identity, client));
  }, [active, cache, client, identity, isCurrentClient]);
  const refreshChatCapabilities = useCallback(() => cache.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'opencode' && query.queryKey[1] === identity.connectionId && ['capabilities', 'configuration', 'skills', 'references', 'extension-inspection'].includes(String(query.queryKey[7])) }), [cache, identity]);
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
        const result = await checked(startLegacyMcpOAuth(client, name));
        return { url: result.authorizationUrl, method: 'code' as const };
      },
      complete: async (name, code) => {
        current();
        if (client.mcpOAuth) await checked(client.mcpOAuth.complete(name, code.trim()));
        else await checked(completeLegacyMcpOAuth(client, name, code.trim()));
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
    mcpStatuses: query?.data ?? EMPTY_STATUSES,
    refreshMcpServers,
    addMcpServer,
    connectMcpServer,
    disconnectMcpServer,
    mcpOAuth,
  };
}
