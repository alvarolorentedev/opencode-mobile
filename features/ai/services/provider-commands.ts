import type { QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { ProviderAuthValues } from '@/shared/protocol/opencode/types';
import { connectionQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

import { completeProviderAuthorization, getProviders, removeProviderCredentials, setProviderCredentialsForClient, startProviderAuthorization } from './capabilities-service';

const PROVIDER_RESOURCES = new Set(['capabilities', 'configuration', 'agents', 'skills', 'references', 'extension-inspection']);

export function createProviderCommands(cache: QueryClient, {
  identity, client, isCurrentClient, queryActive,
}: {
  identity: QueryIdentity;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  queryActive: boolean;
}) {
  const queryKey = connectionQueryKey(identity, client.__opencode.contract);
  const isCurrent = () => isCurrentClient(client);

  async function requireClient() {
    if (!isCurrent()) throw new Error('Connect this server before changing its providers.');
    await cache.cancelQueries({ queryKey });
    if (!isCurrent()) throw new Error('The connection changed before updating its providers.');
  }

  async function refresh() {
    if (!isCurrent() || !client.__opencode.directory) return;
    await cache.invalidateQueries({ queryKey,
      predicate: (query) => PROVIDER_RESOURCES.has(String(query.queryKey[7])),
      refetchType: queryActive ? 'active' : 'none',
    });
  }

  async function setProviderAuth(providerId: string, values: ProviderAuthValues) {
    await requireClient();
    const key = typeof values.key === 'string' ? values.key.trim() : '';
    if (!key) throw new Error('Enter a provider credential first.');
    await setProviderCredentialsForClient(client, providerId, values);
    await refresh();
  }

  async function removeProvider(providerId: string) {
    await requireClient();
    await removeProviderCredentials(client, providerId);
    await refresh();
  }

  async function start(providerId: string, methodIndex: number, inputs?: ProviderAuthValues) {
    await requireClient();
    const authorization = await startProviderAuthorization(client, providerId, methodIndex, inputs);
    if (!isCurrent()) throw new Error('The connection changed before sign-in completed.');
    if (!authorization) throw new Error('OpenCode did not return OAuth authorization details.');
    return { url: authorization.url, instructions: authorization.instructions, method: authorization.method };
  }

  async function completeAutomatic(providerId: string) {
    await requireClient();
    // V2 tracks the attempt status. The existing V1 flow checks its provider list.
    if (client.providerOAuth) {
      await client.providerOAuth.wait(providerId);
      if (!isCurrent()) throw new Error('The connection changed before sign-in completed.');
      await refresh();
      return;
    }
    const deadline = Date.now() + 900_000;
    while (isCurrent() && Date.now() < deadline) {
      const providers = await getProviders(client);
      if (isCurrent() && providers?.connected.includes(providerId)) {
        await refresh();
        return;
      }
      if (isCurrent() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error('Provider sign-in was not completed. Finish authentication in the browser and try again.');
  }

  async function cancel(providerId: string) {
    await requireClient();
    await client.providerOAuth?.cancel(providerId);
  }

  async function complete(providerId: string, methodIndex: number, code: string) {
    await requireClient();
    await completeProviderAuthorization(client, providerId, methodIndex, code);
    await refresh();
  }

  async function add(providerId: string, values: ProviderAuthValues, label?: string) {
    await requireClient();
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.add(providerId, values, label);
    await refresh();
  }

  async function activate(credentialId: string) {
    await requireClient();
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.activate(credentialId);
    await refresh();
  }

  async function remove(credentialId: string) {
    await requireClient();
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.remove(credentialId);
    await refresh();
  }

  return { setProviderAuth, removeProvider, providerOAuth: { start, complete, completeAutomatic, cancel }, providerAccounts: { add, activate, remove } };
}
