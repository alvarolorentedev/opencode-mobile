import type { ProviderAuthMethod, ProviderAuthPrompt, ProviderAuthValues, ProviderCatalog } from '@/shared/protocol/opencode/types';

import { compareLabels } from '@/shared/utilities/compare-labels';
import type { ProviderAccountInfo, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { createServerAdapter } from '@/shared/protocol/opencode/contracts/server-adapter';
import { getConfiguredProviderIds } from '@/features/ai/model/opencode-model-selection';
import type { ModelOption } from '@/shared/contracts/model-options';

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

export async function discoverProviderCapabilities(client: ScopedOpencodeClient) {
  const adapter = createServerAdapter(client).capabilities;
  const [discovery, accounts] = await Promise.all([
    adapter.discovery(),
    client.accounts ? client.accounts.list().catch(() => [] as ProviderAccountInfo[]) : Promise.resolve([] as ProviderAccountInfo[]),
  ]);
  const { providers: providerData, auth: authData } = discovery;
  const nextModels = uniqueById(providerData.all
    .flatMap((provider) =>
      Object.values(provider.models).map((model: DiscoveredModel): ModelOption => ({
        id: `${provider.id}/${model.id}`,
        label: model.name,
        providerID: provider.id,
        providerLabel: provider.name,
        modelID: model.id,
        variants: adapter.modelVariants(model),
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

  const configuredProviderIds = getConfiguredProviderIds(undefined, providerData.connected, nextModels);
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
        configured: configuredProviderIds.has(provider.id) || providerAccounts.length > 0,
        ...(providerAccounts.length
          ? { accounts: providerAccounts.map(({ id, label, method, active }) => ({ id, label, method, active })) }
          : {}),
      };
    })
    .sort((left, right) => compareLabels(left.label, right.label)));

  return {
    providers: nextProviders,
    connected: providerData.connected,
    providerAuthMethodsById: normalizeProviderAuthMethods(authData),
    models: nextModels,
  };
}

export function getProviders(client: ScopedOpencodeClient): Promise<ProviderCatalog> {
  return createServerAdapter(client).capabilities.providers();
}
export function setProviderCredentialsForClient(client: ScopedOpencodeClient, id: string, values: ProviderAuthValues) {
  return createServerAdapter(client).capabilities.setCredentials(id, values);
}
export function removeProviderCredentials(client: ScopedOpencodeClient, id: string) {
  return createServerAdapter(client).capabilities.removeCredentials(id);
}
export function startProviderAuthorization(client: ScopedOpencodeClient, id: string, method: number, values?: ProviderAuthValues) {
  return createServerAdapter(client).capabilities.startAuthorization(id, method, values);
}
export function completeProviderAuthorization(client: ScopedOpencodeClient, id: string, method: number, code: string) {
  return createServerAdapter(client).capabilities.completeAuthorization(id, method, code);
}
