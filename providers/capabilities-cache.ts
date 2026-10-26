import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { Config, Reference, Skill } from '@/lib/opencode/types';
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
  skills?: Skill[];
  references?: Reference[];
};

type Storage = PersistenceStorage & Pick<typeof AsyncStorage, 'setItem'>;

const CachedCapabilitiesSchema = z.object({
  cachedAt: z.number().finite(),
  config: z.record(z.string(), z.unknown()).optional(),
  providers: z.array(z.record(z.string(), z.unknown())),
  connected: z.array(z.string()),
  providerAuthMethodsById: z.record(z.string(), z.unknown()),
  models: z.array(z.record(z.string(), z.unknown())),
  agents: z.array(z.record(z.string(), z.unknown())),
  skills: z.array(z.record(z.string(), z.unknown())).optional(),
  references: z.array(z.record(z.string(), z.unknown())).optional(),
});

function parse(raw: string): CachedCapabilities {
  const value = CachedCapabilitiesSchema.parse(JSON.parse(raw));
  if (Date.now() - value.cachedAt > CACHE_TTL_MS) throw new Error('Capabilities cache expired.');
  return {
    ...(value.config ? { config: value.config as Config } : {}),
    providers: value.providers as ProviderOption[],
    connected: value.connected,
    providerAuthMethodsById: value.providerAuthMethodsById as Record<string, ProviderAuthMethod[]>,
    models: value.models as ModelOption[],
    agents: value.agents as AgentOption[],
    skills: value.skills as Skill[] | undefined,
    references: value.references as Reference[] | undefined,
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
