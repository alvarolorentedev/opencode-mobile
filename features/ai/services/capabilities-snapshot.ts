import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { Config, Reference, Skill , ProviderAuthMethod } from '@/shared/protocol/opencode/types';
import { capabilitiesCacheKey } from '@/shared/storage/keys';
import type { AgentOption, ModelOption } from '@/shared/contracts/model-options';
import type { ProviderOption } from '@/features/ai/model/types';
import { loadPersistedValue, type PersistenceStorage } from '@/shared/storage/persistence-hydration';

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

function persistedConfig(config?: Config): Config | undefined {
  return config && {
    model: config.model, enabled_providers: config.enabled_providers, disabled_providers: config.disabled_providers,
    provider: Object.fromEntries(Object.keys(config.provider ?? {}).map((id) => [id, {}])),
    agent: Object.fromEntries(Object.entries(config.agent ?? {}).map(([id, agent]) => [id, { disable: agent?.disable }])),
  };
}

function parse(raw: string): CachedCapabilities & { cachedAt: number } {
  const value = CachedCapabilitiesSchema.parse(JSON.parse(raw));
  if (Date.now() - value.cachedAt > CACHE_TTL_MS || value.cachedAt > Date.now()) throw new Error('Capabilities cache expired.');
  return {
    cachedAt: value.cachedAt,
    ...(value.config ? { config: persistedConfig(value.config as Config) } : {}),
    providers: value.providers as ProviderOption[],
    connected: value.connected,
    providerAuthMethodsById: value.providerAuthMethodsById as Record<string, ProviderAuthMethod[]>,
    models: value.models as ModelOption[],
    agents: value.agents as AgentOption[],
    skills: value.skills as Skill[] | undefined,
    references: value.references as Reference[] | undefined,
  };
}

export async function hydrateCapabilitiesSnapshot(
  connectionScope: string,
  projectPath: string,
  apply: (value: CachedCapabilities, cachedAt: number) => void,
  isCurrent: () => boolean,
  storage: Storage = AsyncStorage,
) {
  if (!connectionScope || !projectPath) return;
  await loadPersistedValue(storage, capabilitiesCacheKey(connectionScope, projectPath), parse, (value) => {
    if (isCurrent()) apply(value, value.cachedAt);
  });
}

export async function persistCapabilitiesSnapshot(
  connectionScope: string,
  projectPath: string,
  value: CachedCapabilities,
  cachedAt: number,
  storage: Storage = AsyncStorage,
) {
  if (!connectionScope || !projectPath) return;
  const config = persistedConfig(value.config);
  const serialized = JSON.stringify({ ...value, config, cachedAt });
  if (serialized.length > MAX_CHARS) return;
  await storage.setItem(capabilitiesCacheKey(connectionScope, projectPath), serialized).catch(() => undefined);
}

export async function migrateCapabilitiesSnapshots(previousScope: string, nextScope: string) {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = 'opencode-mobile.capabilities.';
  for (const key of keys.filter((entry) => entry.startsWith(`${prefix}${previousScope}.`))) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    let value;
    try { value = parse(raw); } catch { await AsyncStorage.removeItem(key); continue; }
    const nextKey = `${prefix}${nextScope}.${key.slice(`${prefix}${previousScope}.`.length)}`;
    const existing = await AsyncStorage.getItem(nextKey);
    let newer = false;
    try { newer = Boolean(existing && parse(existing).cachedAt >= value.cachedAt); } catch {}
    if (!newer) await AsyncStorage.setItem(nextKey, JSON.stringify(value));
    if (key !== nextKey) await AsyncStorage.removeItem(key);
  }
}

export async function clearCapabilitiesSnapshots(scope: string) {
  const prefix = `opencode-mobile.capabilities.${scope}.`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
