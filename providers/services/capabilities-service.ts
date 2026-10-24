import { getProviderCatalog, getProviderAuthMethods, toConfigView, toAgentView, findIntegration } from '@/lib/opencode/v2/shared';
import { setProviderCredentials } from '@/lib/opencode/compat/v1/auth';
import type { Config, ProviderCatalog, ProviderAuthMethod, ProviderAuthPrompt, ProviderAuthValues } from '@/lib/opencode/types';

import { compareLabels } from '@/lib/compare-labels';
import type { ProviderAccountInfo, ScopedOpencodeClient } from '@/lib/opencode/client';
import { getConfiguredProviderIds, toAgentOption, type ModelOption } from '@/providers/opencode-model-selection';
import { requireData } from '@/providers/services/require-data';

const PROMPT_TYPES: ProviderAuthPrompt['type'][] = ['text', 'select', 'number', 'integer', 'boolean', 'multiselect', 'external'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// V1 auth metadata and the V2-normalized methods share one prompt model. V1
// carries a single `when` condition; V2 carries an array.
function normalizePrompt(prompt: unknown): ProviderAuthPrompt {
  const value = asRecord(prompt);
  const type = PROMPT_TYPES.includes(value.type as ProviderAuthPrompt['type'])
    ? (value.type as ProviderAuthPrompt['type'])
    : 'text';
  const rawWhen = Array.isArray(value.when) ? value.when : value.when ? [value.when] : undefined;
  return {
    type,
    key: typeof value.key === 'string' ? value.key : '',
    message: typeof value.message === 'string' ? value.message : typeof value.key === 'string' ? value.key : '',
    placeholder: typeof value.placeholder === 'string' ? value.placeholder : undefined,
    options: Array.isArray(value.options)
      ? value.options.map((option) => {
        const entry = asRecord(option);
        return { label: String(entry.label ?? entry.value ?? ''), value: String(entry.value ?? '') };
      })
      : undefined,
    defaultValue: value.defaultValue as ProviderAuthPrompt['defaultValue'],
    required: typeof value.required === 'boolean' ? value.required : undefined,
    min: typeof value.min === 'number' ? value.min : undefined,
    max: typeof value.max === 'number' ? value.max : undefined,
    url: typeof value.url === 'string' ? value.url : undefined,
    when: rawWhen?.map((condition) => {
      const entry = asRecord(condition);
      return {
        key: String(entry.key ?? ''),
        op: entry.op === 'neq' ? 'neq' as const : 'eq' as const,
        value: entry.value as string | number | boolean,
      };
    }),
  };
}

function normalizeProviderAuthMethods(authData: unknown): Record<string, ProviderAuthMethod[]> {
  return Object.fromEntries(
    Object.entries(asRecord(authData)).map(([providerId, methods]) => [
      providerId,
      Array.isArray(methods)
        ? methods.map((method): ProviderAuthMethod => {
          const value = asRecord(method);
          return {
            type: value.type === 'oauth' ? 'oauth' : 'api',
            label: typeof value.label === 'string' ? value.label : '',
            prompts: Array.isArray(value.prompts) ? value.prompts.map(normalizePrompt) : undefined,
          };
        })
        : [],
    ]),
  );
}

type DiscoveredModel = ProviderCatalog['all'][number]['models'][string];
const INPUT_MODALITIES: ModelOption['inputModalities'] = ['text', 'audio', 'image', 'video', 'pdf'];

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

export async function discoverChatCapabilities(client: ScopedOpencodeClient, activeProjectPath?: string) {
  if (!activeProjectPath) {
    return {
      config: undefined,
      providers: [],
      providerAuthMethodsById: {},
      models: [],
      agents: [],
      connected: [],
      configuredModels: [],
    };
  }

  const [configResponse, providersResponse, providerAuthResponse, agentsResponse, accounts] = await Promise.all([
    getConfig(client),
    getProviders(client),
    client.compatibility ? client.compatibility.provider.auth().then((r) => r.data) : getProviderAuthMethods(client.api!, { location: { directory: client.__opencode.directory } }),
    client.compatibility ? client.compatibility.app.agents().then((r) => r.data) : client.api!.agent.list({ location: { directory: client.__opencode.directory } }).then((r) => r.data.map(toAgentView)),
    client.accounts ? client.accounts.list().catch(() => [] as ProviderAccountInfo[]) : Promise.resolve([] as ProviderAccountInfo[]),
  ]);

  const nextConfig = requireData(configResponse, 'config request');
  const providerData = requireData(providersResponse, 'provider request');
  const authData = requireData(providerAuthResponse, 'provider auth request');
  const agentData = requireData(agentsResponse, 'agent request');
  const nextModels = uniqueById(providerData.all
    .flatMap((provider) =>
      Object.values(provider.models).map((model: DiscoveredModel): ModelOption => ({
        id: `${provider.id}/${model.id}`,
        label: model.name,
        providerID: provider.id,
        providerLabel: provider.name,
        modelID: model.id,
        variants: client.compatibility ? [] : model.variants ?? [],
        supportsReasoning: model.capabilities.reasoning,
        supportsAttachments: model.capabilities.attachment,
        inputModalities: INPUT_MODALITIES.filter((modality) => model.capabilities.input[modality]),
        supportsToolCalls: model.capabilities.toolcall,
        contextLimit: model.limit.context,
        outputLimit: model.limit.output,
        pricing: model.cost,
        status: model.status,
      })),
    )
    .sort((left, right) => {
      const leftDefault = providerData.default[left.providerID] === left.modelID;
      const rightDefault = providerData.default[right.providerID] === right.modelID;
      return Number(rightDefault) - Number(leftDefault) || compareLabels(left.label, right.label);
    }));

  const configuredProviderIds = getConfiguredProviderIds(nextConfig, providerData.connected, nextModels);
  const configuredModels = nextModels.filter((model) => configuredProviderIds.has(model.providerID));
  const accountsByIntegration = new Map<string, ProviderAccountInfo[]>();
  accounts.forEach((account) => {
    const list = accountsByIntegration.get(account.providerId) ?? [];
    list.push(account);
    accountsByIntegration.set(account.providerId, list);
  });
  const nextProviders = uniqueById(providerData.all
    .map((provider) => {
      // The catalog entry carries the integrations that serve the provider's
      // login methods; fall back to the provider id for V1 and legacy shapes.
      const integrationIds = (provider as { integrationIds?: string[] }).integrationIds ?? [provider.id];
      const providerAccounts = [...new Set(integrationIds)].flatMap((id) => accountsByIntegration.get(id) ?? []);
      return {
        id: provider.id,
        label: provider.name,
        modelCount: Object.keys(provider.models).length,
        configured: configuredProviderIds.has(provider.id) || providerAccounts.length > 0,
        integrationIds,
        ...(providerAccounts.length
          ? { accounts: providerAccounts.map(({ id, label, method, active }) => ({ id, label, method, active })) }
          : {}),
      };
    })
    .sort((left, right) => compareLabels(left.label, right.label)));
  const nextAgents = uniqueById(agentData.map(toAgentOption));

  return {
    config: nextConfig,
    providers: nextProviders,
    connected: providerData.connected,
    providerAuthMethodsById: normalizeProviderAuthMethods(authData),
    models: nextModels,
    agents: nextAgents,
    configuredModels,
  };
}

export async function getConfig(client: ScopedOpencodeClient): Promise<Config> {
  return client.compatibility ? requireData((await client.compatibility.config.get()).data, 'config request') : toConfigView(await client.api!.config.get({ location: { directory: client.__opencode.directory } }));
}
export async function updateConfig(client: ScopedOpencodeClient, config: Config): Promise<Config> {
  if (!client.compatibility) throw new Error('General configuration changes are unavailable on OpenCode 2.');
  return requireData((await client.compatibility.config.update({ config: config as NonNullable<Parameters<typeof client.compatibility.config.update>[0]>['config'] })).data, 'config update');
}
export async function getProviders(client: ScopedOpencodeClient): Promise<ProviderCatalog> {
  if (!client.compatibility) return getProviderCatalog(client.api!, { location: { directory: client.__opencode.directory } });
  const catalog = requireData((await client.compatibility.provider.list()).data, 'provider request');
  return {
    ...catalog,
    all: catalog.all.map((provider) => ({
      ...provider,
      models: Object.fromEntries(Object.entries(provider.models).map(([id, model]) => [id, { ...model, variants: [] }])),
    })),
  };
}
export async function setProviderCredentialsForClient(client: ScopedOpencodeClient, id: string, values: ProviderAuthValues) {
  if (client.compatibility) return setProviderCredentials(client.compatibility, id, values);
  await client.accounts!.add(id, values);
}
export async function removeProviderCredentials(client: ScopedOpencodeClient, id: string) {
  if (client.compatibility) return client.compatibility.auth.remove({ providerID: id });
  let integration = await findIntegration(client.api!, id, { location: { directory: client.__opencode.directory } }, true);
  if (!integration?.connections.some((item) => item.type === 'credential')) integration = await findIntegration(client.api!, id, { location: { directory: client.__opencode.directory } });
  await Promise.all((integration?.connections ?? []).filter((item) => item.type === 'credential').map((item) => client.api!.credential.remove({ credentialID: item.id })));
}
export async function startProviderAuthorization(client: ScopedOpencodeClient, id: string, method: number, values?: ProviderAuthValues) {
  if (client.providerOAuth) return client.providerOAuth.start(id, method, values);
  const auth = requireData((await client.compatibility!.provider.oauth.authorize({ providerID: id, method, inputs: values as Record<string, string> })).data, 'OAuth authorization');
  return { url: auth.url, instructions: auth.instructions, method: auth.method };
}
export async function completeProviderAuthorization(client: ScopedOpencodeClient, id: string, method: number, code: string) {
  if (client.providerOAuth) return client.providerOAuth.complete(id, code);
  await client.compatibility!.provider.oauth.callback({ providerID: id, method, code });
}
