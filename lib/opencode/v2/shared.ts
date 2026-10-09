import { OpenCode } from '@opencode/client';

import { getServerBase, type OpencodeConnectionSettings } from '../client';
import type { ProviderAuthPrompt } from '../types';
import { modelToV1 } from '../v2-mappers';

export type V2Api = ReturnType<typeof OpenCode.make>;

export type V2Message = Awaited<ReturnType<V2Api['message']['list']>>['data'][number];
export type V2Diff = Awaited<ReturnType<V2Api['session']['diff']>>[number];
export type V2Permission = Awaited<ReturnType<V2Api['permission']['request']['list']>>['data'][number];
export type V2Form = Awaited<ReturnType<V2Api['form']['list']>>['data'][number];
type V2Provider = Awaited<ReturnType<V2Api['provider']['list']>>['data'][number];
type V2Model = Awaited<ReturnType<V2Api['model']['list']>>['data'][number];
type V2Agent = Awaited<ReturnType<V2Api['agent']['list']>>['data'][number];
type V2Integration = Awaited<ReturnType<V2Api['integration']['list']>>['data'][number];
type V2Shell = Awaited<ReturnType<V2Api['config']['shells']>>[number];
export type LocationOptions = { location?: { directory?: string } };

export type RawResult = { data?: unknown; response?: { headers: Headers } };

export type V2EventEnvelope = {
  id: string;
  type: string;
  location?: { directory?: string };
  data?: Record<string, unknown>;
};

export type V1Envelope = {
  directory: string;
  payload: { id: string; type: string; properties: Record<string, unknown> };
};

export type RawCredential = {
  id: string;
  integrationID: string;
  label: string;
  active: boolean;
  value?: { type?: string };
};

export type AdapterContext = {
  api: V2Api;
  directory?: string;
  listCredentials: () => Promise<RawCredential[]>;
  permissionSession: Map<string, string>;
  formSession: Map<string, V2Form>;
};

export type V2Adapter = {
  api: V2Api;
  ctx: AdapterContext;
  directory?: string;
  vcsLocation: LocationOptions;
  ok: (data: unknown) => RawResult;
  listSessionPage: () => Promise<Awaited<ReturnType<V2Api['session']['list']>>>;
  getProjectID: () => Promise<string>;
};

export function stringField(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function numberField(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record._tag === 'string') return record._tag;
  }
  return 'OpenCode request failed.';
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(extractErrorMessage(error));
}

// V2 routes are absolute (/api/...), so baseUrl path segments are replaced. A reverse
// proxy prefix is preserved by rewriting the outgoing request instead.
export function resolveV2Base(settings: OpencodeConnectionSettings) {
  const base = getServerBase(settings.serverUrl);
  const pathPrefix = base.pathPrefix.replace(/\/api$/, '');
  return { base, pathPrefix };
}

export function decodeFile(bytes: unknown): Record<string, unknown> {
  try {
    const content = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes as Uint8Array);
    if (content.includes('\0')) return { type: 'binary', content: '', encoding: 'base64' };
    return { type: 'text', content };
  } catch {
    return { type: 'binary', content: '', encoding: 'base64' };
  }
}

export function configToV1(entries: unknown): Record<string, unknown> {
  const list = Array.isArray(entries) ? (entries as Record<string, unknown>[]) : [];
  const document = list.find((entry) => entry.type === 'document' && entry.info);
  const info = (document?.info ?? {}) as Record<string, unknown>;
  const providers = (info.providers ?? {}) as Record<string, Record<string, unknown>>;
  const enabled: string[] = [];
  const disabled: string[] = [];
  const provider: Record<string, unknown> = {};
  Object.entries(providers).forEach(([id, value]) => {
    provider[id] = value ?? {};
    if (value && value.disabled === true) disabled.push(id);
    else enabled.push(id);
  });
  const rawModel = info.model;
  const model = typeof rawModel === 'string'
    ? rawModel
    : rawModel && typeof rawModel === 'object'
      ? `${stringField((rawModel as Record<string, unknown>).providerID)}/${stringField((rawModel as Record<string, unknown>).model)}`
      : undefined;

  return {
    ...info,
    provider,
    enabled_providers: enabled,
    disabled_providers: disabled,
    model,
    agent: info.agents,
    permission: info.permissions,
    mcp: (info.mcp as Record<string, unknown> | undefined)?.servers,
  };
}

export async function providersToV1(api: V2Api, location: LocationOptions) {
  const [providersResponse, modelsResponse, defaultResponse, integrationsResponse] = await Promise.all([
    api.provider.list(location),
    api.model.list(location),
    api.model.default(location).catch(() => ({ data: null })),
    api.integration.list(location),
  ]);
  const providers: V2Provider[] = providersResponse.data ?? [];
  const models: V2Model[] = modelsResponse.data ?? [];
  const defaultRef = defaultResponse.data;

  // A provider's login methods can be served by more than one integration: its
  // direct integration (its own id) and a linked Console integration. Keep both
  // so stored credentials can be associated with every provider that offers the
  // matching login method.
  const all = providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    integrationIds: [...new Set([provider.integrationID, provider.id].filter(Boolean))] as string[],
    models: Object.fromEntries(models.filter((model) => model.providerID === provider.id).map((model) => [model.id, modelToV1(model)])),
  }));
  // V2's provider endpoint lists active providers. The integration endpoint is
  // the connectable catalog, including providers with no credentials yet.
  const providerIds = new Set(providers.map((provider) => provider.id));
  const linkedIntegrationIds = new Set(providers.map((provider) => provider.integrationID ?? provider.id));
  for (const integration of integrationsResponse.data ?? []) {
    if (providerIds.has(integration.id) || linkedIntegrationIds.has(integration.id)
      || integration.metadata?.source === 'mcp'
      || !integration.methods.some((method) => method.type === 'key' || method.type === 'oauth')) continue;
    all.push({ id: integration.id, name: integration.name, integrationIds: [integration.id], models: {} });
  }

  const defaults: Record<string, string> = {};
  providers.forEach((provider) => {
    const first = models.find((model) => model.providerID === provider.id);
    if (first) defaults[provider.id] = first.id;
  });
  if (defaultRef) defaults[defaultRef.providerID] = defaultRef.id;

  // `auto` is a catalog activation policy, not evidence of a connection.
  // Keep unconnected providers available in Settings' Add provider picker.
  const connected = providers.filter((provider) => {
    if (provider.activation === 'disabled') return false;
    const integration = integrationsResponse.data.find((item) => item.id === (provider.integrationID ?? provider.id));
    return Boolean(integration?.connections.length)
      || models.some((model) => model.providerID === provider.id && model.enabled);
  }).map((provider) => provider.id);
  return { all, default: defaults, connected };
}

type V2FormField = {
  key: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external';
  title?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<{ key: string; op: 'eq' | 'neq'; value: unknown }>;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  url?: string;
};

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// V2 integration methods carry a rich `form` (string/select/number/boolean/
// multiselect/external with `when` conditions). Map it into the app's normalized
// prompt model so the setup UI can render type-specific controls.
function formToPrompts(form: unknown): ProviderAuthPrompt[] | undefined {
  if (!Array.isArray(form)) return undefined;
  const prompts = (form as V2FormField[])
    .filter((field) => !field.hidden)
    .map((field): ProviderAuthPrompt => {
      const message = field.title || field.key;
      const when = field.when?.map((condition) => ({
        key: condition.key,
        op: condition.op,
        value: condition.value as string | number | boolean,
      }));

      switch (field.type) {
        case 'boolean':
          return { type: 'boolean', key: field.key, message, defaultValue: typeof field.default === 'boolean' ? field.default : undefined, when };
        case 'number':
        case 'integer':
          return { type: field.type, key: field.key, message, min: numeric(field.minimum), max: numeric(field.maximum), defaultValue: numeric(field.default), when };
        case 'multiselect':
          return { type: 'multiselect', key: field.key, message, options: field.options, defaultValue: Array.isArray(field.default) ? (field.default as string[]) : undefined, when };
        case 'external':
          return { type: 'external', key: field.key, message, url: field.url, when };
        default:
          return field.options?.length
            ? { type: 'select', key: field.key, message, options: field.options, defaultValue: typeof field.default === 'string' ? field.default : undefined, when }
            : { type: 'text', key: field.key, message, placeholder: field.placeholder, defaultValue: typeof field.default === 'string' ? field.default : undefined, when };
      }
    });
  return prompts.length > 0 ? prompts : undefined;
}

export async function providerAuthToV1(api: V2Api, location: LocationOptions) {
  const [integrationsResponse, providersResponse] = await Promise.all([api.integration.list(location), api.provider.list(location)]);
  const result: Record<string, unknown[]> = {};
  const providers = providersResponse.data ?? [];
  const ids = new Set([...providers.map((provider) => provider.id), ...(integrationsResponse.data ?? [])
    .filter((integration) => integration.metadata?.source !== 'mcp').map((integration) => integration.id)]);
  ids.forEach((id) => {
    const provider = providers.find((item) => item.id === id);
    const integration = (integrationsResponse.data ?? []).find((item) => item.id === (provider?.integrationID ?? id));
    if (!integration) return;
    const methods = integration.methods.filter((method) => method.type === 'key' || method.type === 'oauth');
    // A shared Console integration can supply OAuth while the provider's
    // direct integration accepts its API key. Keep both choices available.
    const directKey = (integrationsResponse.data ?? []).find((item) => item.id === id)?.methods.find((method) => method.type === 'key');
    if (directKey && !methods.some((method) => method.type === 'key')) methods.push(directKey);
    result[id] = methods.map((method) => {
      const prompts = 'form' in method ? formToPrompts(method.form) : undefined;
      return {
        type: method.type === 'oauth' ? 'oauth' : 'api',
        label: 'label' in method && method.label ? method.label : method.type,
        ...(prompts ? { prompts } : {}),
      };
    });
  });
  return result;
}

export async function findIntegration(api: V2Api, providerID: string, location: LocationOptions, forKey = false): Promise<V2Integration | undefined> {
  const [integrations, providers] = await Promise.all([api.integration.list(location), api.provider.list(location)]);
  const provider = (providers.data ?? []).find((item) => item.id === providerID);
  // Console-managed Go providers may use `opencode` for OAuth while their API
  // keys belong to the provider's own integration.
  const direct = (integrations.data ?? []).find((item) => item.id === providerID);
  if (forKey && direct?.methods.some((method) => method.type === 'key')) return direct;
  return (integrations.data ?? []).find((item) => item.id === (provider?.integrationID ?? providerID));
}

export function agentToV1(agent: V2Agent): Record<string, unknown> {
  return { name: agent.id, description: agent.description, mode: agent.mode, hidden: agent.hidden };
}

export function shellToV1(shell: V2Shell): Record<string, unknown> {
  return { name: shell.name, path: shell.path, acceptable: shell.acceptable };
}

export function mcpConfigToV2(config: Record<string, unknown> | undefined) {
  if (!config) return { type: 'local' as const, command: [] as string[] };
  const enabled = config.enabled !== false;
  if (config.type === 'remote') {
    return { type: 'remote' as const, url: stringField(config.url), disabled: !enabled };
  }
  const command = Array.isArray(config.command) ? config.command.map((item) => stringField(item)) : [];
  return { type: 'local' as const, command, disabled: !enabled };
}

// V2 prompt input has no `system` field. The equivalent is a durable,
// session-scoped instruction entry, applied at the next step boundary.
const PREFERENCES_INSTRUCTION_KEY = 'opencode-mobile.chat-preferences';

export async function syncSessionInstructions(api: V2Api, sessionID: string, system: unknown) {
  if (!sessionID) return;
  const value = typeof system === 'string' ? system.trim() : '';
  try {
    if (value) {
      await api.session.instructions.entry.put({ sessionID, key: PREFERENCES_INSTRUCTION_KEY, value });
    } else {
      await api.session.instructions.entry.remove({ sessionID, key: PREFERENCES_INSTRUCTION_KEY });
    }
  } catch {
    // Instruction entries are an experimental V2 surface. A V2 server that
    // does not expose them must still accept the prompt.
  }
}
