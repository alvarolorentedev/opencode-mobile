import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Config } from '@/lib/opencode/types';
import { capabilitiesCacheKey } from '@/lib/storage-keys';
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ProviderAuthMethod, ProviderOption } from '@/providers/opencode-provider-types';
import { loadPersistedValue, type PersistenceStorage } from '@/providers/persistence-hydration';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHARS = 300_000;

export type CachedCapabilities = {
  config?: Config;
  providers: ProviderOption[];
  connected: string[];
  providerAuthMethodsById: Record<string, ProviderAuthMethod[]>;
  models: ModelOption[];
  agents: AgentOption[];
};

type Storage = PersistenceStorage & Pick<typeof AsyncStorage, 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(raw: string): CachedCapabilities {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error('Expected a capabilities envelope.');
  if (typeof value.cachedAt !== 'number' || !Number.isFinite(value.cachedAt)) throw new Error('Expected a cache timestamp.');
  if (Date.now() - value.cachedAt > CACHE_TTL_MS) throw new Error('Capabilities cache expired.');
  if (!Array.isArray(value.providers) || !value.providers.every(isRecord)) throw new Error('Expected cached providers.');
  if (!Array.isArray(value.connected) || !value.connected.every((id) => typeof id === 'string')) throw new Error('Expected connected provider IDs.');
  if (!isRecord(value.providerAuthMethodsById)) throw new Error('Expected cached auth methods.');
  if (!Array.isArray(value.models) || !value.models.every(isRecord)) throw new Error('Expected cached models.');
  if (!Array.isArray(value.agents) || !value.agents.every(isRecord)) throw new Error('Expected cached agents.');
  if (value.config !== undefined && !isRecord(value.config)) throw new Error('Expected a cached config.');
  return {
    ...(value.config ? { config: value.config as Config } : {}),
    providers: value.providers as ProviderOption[],
    connected: value.connected as string[],
    providerAuthMethodsById: value.providerAuthMethodsById as Record<string, ProviderAuthMethod[]>,
    models: value.models as ModelOption[],
    agents: value.agents as AgentOption[],
  };
}

export async function hydrateCapabilitiesCache(
  connectionScope: string,
  projectPath: string,
  apply: (value: CachedCapabilities) => void,
  isCurrent: () => boolean,
  storage: Storage = AsyncStorage,
) {
  if (!connectionScope || !projectPath) return;
  await loadPersistedValue(storage, capabilitiesCacheKey(connectionScope, projectPath), parse, (value) => {
    if (isCurrent()) apply(value);
  });
}

export async function persistCapabilitiesCache(
  connectionScope: string,
  projectPath: string,
  value: CachedCapabilities,
  storage: Storage = AsyncStorage,
) {
  if (!connectionScope || !projectPath) return;
  const serialized = JSON.stringify({ cachedAt: Date.now(), ...value });
  if (serialized.length > MAX_CHARS) return;
  await storage.setItem(capabilitiesCacheKey(connectionScope, projectPath), serialized).catch(() => undefined);
}

export async function migrateCapabilitiesCaches(previousScope: string, nextScope: string) {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = 'opencode-mobile.capabilities.';
  for (const key of keys.filter((entry) => entry.startsWith(`${prefix}${previousScope}.`))) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    try { parse(raw); } catch { continue; }
    await AsyncStorage.setItem(`${prefix}${nextScope}.${key.slice(`${prefix}${previousScope}.`.length)}`, raw);
  }
}
