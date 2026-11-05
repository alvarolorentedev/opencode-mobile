import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';
import { hydrateCapabilitiesSnapshot, persistCapabilitiesSnapshot } from '@/features/ai/services/capabilities-snapshot';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

const build = { id: 'build', label: 'Build', mode: 'primary' as const };
const plan = { id: 'plan', label: 'Plan', mode: 'primary' as const };

async function capabilitiesHarness() {
  const runtime = hookRuntime();
  const { useCapabilitiesActions } = await loadTs('features/ai/state/use-capabilities-actions.ts', {
    react: runtime.react,
    '@/features/ai/services/capabilities-service': {},
    '@/features/ai/model/auto-model/models': { getLocalAutoModelStatus: () => 'unavailable' },
    '@/features/ai/model/opencode-auto-model': { getClassifierModelId: () => undefined },
    '@/features/ai/services/model-routing-service': {},
  });
  let preferences = { mode: 'summary', enabledModelIds: [], providerModelSelections: {}, autoModel: { enabled: false } };
  const write = vi.fn((update: (value: typeof preferences) => typeof preferences) => { preferences = update(preferences); });
  const client = { __opencode: { contract: 'v2' } };
  runtime.mount(useCapabilitiesActions, {
    client, isCurrentClient: (candidate: unknown) => candidate === client, isHydrated: false,
    activeProjectPath: '/a', availableProviders: [], availableModels: [], chatPreferences: preferences,
    capabilities: { agents: [build, plan], models: [], providers: [], connected: [], config: { default_agent: 'plan' } },
    setChatPreferences: write,
  });
  return { runtime, write, get preferences() { return preferences; }, set preferences(value) { preferences = value; }, client };
}

describe('agent preference reconciliation', () => {  it('waits for hydration, repairs an invalid selection and preserves valid user choices without loops', async () => {
    const h = await capabilitiesHarness();
    expect(h.write).not.toHaveBeenCalled();
    h.runtime.update({ isHydrated: true });
    expect(h.preferences.mode).toBe('plan');
    h.preferences = { ...h.preferences, mode: 'build' };
    h.runtime.update({ chatPreferences: h.preferences });
    expect(h.preferences.mode).toBe('build');
    h.runtime.update({ chatPreferences: h.preferences });
    const count = h.write.mock.calls.length;
    h.runtime.update({ chatPreferences: h.preferences });
    expect(h.write).toHaveBeenCalledTimes(count);
    h.runtime.unmount();
  });

  it('retains preferences across empty/missing-mode catalogs and rejects stale clients', async () => {
    const h = await capabilitiesHarness();
    h.runtime.update({ isHydrated: true, capabilities: { agents: [], models: [], providers: [], connected: [] } });
    expect(h.preferences.mode).toBe('summary');
    h.runtime.update({ capabilities: { agents: [{ id: 'summary', label: 'Summary' }], models: [], providers: [], connected: [] } });
    expect(h.preferences.mode).toBe('summary');
    h.runtime.update({ isCurrentClient: () => false, capabilities: { agents: [build], models: [], providers: [], connected: [] } });
    expect(h.preferences.mode).toBe('summary');
    h.runtime.unmount();
  });

  it('revalidates on project/server changes and after an agent is disabled or removed', async () => {
    const h = await capabilitiesHarness();
    h.runtime.update({ isHydrated: true });
    expect(h.preferences.mode).toBe('plan');
    h.runtime.update({ activeProjectPath: '/b', capabilities: { agents: [build], models: [], providers: [], connected: [] } });
    expect(h.preferences.mode).toBe('build');
    const client = { __opencode: { contract: 'v2' } };
    h.runtime.update({ client, isCurrentClient: (candidate: unknown) => candidate === client,
      capabilities: { agents: [plan], models: [], providers: [], connected: [] } });
    expect(h.preferences.mode).toBe('plan');
    h.runtime.unmount();
  });

  it('remembers the latest model separately for each agent', async () => {
    const runtime = hookRuntime();
    const { useCapabilitiesActions } = await loadTs('features/ai/state/use-capabilities-actions.ts', {
      react: runtime.react,
      '@/features/ai/services/capabilities-service': {},
      '@/features/ai/model/auto-model/models': { getLocalAutoModelStatus: () => 'unavailable' },
      '@/features/ai/model/opencode-auto-model': { getClassifierModelId: () => undefined },
      '@/features/ai/services/model-routing-service': {},
    });
    const provider = { id: 'openai', label: 'OpenAI', configured: true };
    const modelA = { id: 'openai/a', providerID: 'openai', modelID: 'a', label: 'A', providerLabel: 'OpenAI', variants: [], supportsReasoning: false, supportsAttachments: true, inputModalities: ['text'], supportsToolCalls: true };
    const modelB = { ...modelA, id: 'openai/b', modelID: 'b', label: 'B' };
    let preferences: any = { mode: 'build', enabledModelIds: [], providerModelSelections: {}, agentModelSelections: {}, modelVariantSelections: {}, recentModelIds: [], autoModel: { enabled: false } };
    const write = vi.fn((update: (value: any) => any) => { preferences = update(preferences); });
    const client = { __opencode: { contract: 'v2' } };
    runtime.mount(useCapabilitiesActions, {
      client, isCurrentClient: (candidate: unknown) => candidate === client, isHydrated: true,
      activeProjectPath: '/a', availableProviders: [provider], availableModels: [modelA, modelB], chatPreferences: preferences,
      capabilities: { agents: [build, plan], models: [modelA, modelB], providers: [provider], connected: ['openai'], config: { default_agent: 'build' } },
      setChatPreferences: write,
    });

    runtime.value.updateChatPreferences({ providerId: 'openai', modelId: modelA.id });
    expect(preferences.modelId).toBe(modelA.id);
    expect(preferences.agentModelSelections).toEqual({ build: modelA.id });

    runtime.value.updateChatPreferences({ mode: 'plan' });
    expect(preferences.modelId).toBeUndefined();

    runtime.value.updateChatPreferences({ providerId: 'openai', modelId: modelB.id });
    expect(preferences.agentModelSelections).toEqual({ build: modelA.id, plan: modelB.id });

    runtime.value.updateChatPreferences({ mode: 'build' });
    expect(preferences.modelId).toBe(modelA.id);
    runtime.unmount();
  });
});

describe('agent capability snapshots', () => {
  it('round-trips metadata and the configured default through hydration', async () => {
    let raw = '';
    const storage = { setItem: vi.fn(async (_key: string, value: string) => { raw = value; }), getItem: async () => raw, removeItem: vi.fn(async () => {}) };
    const value = { agents: [build, { ...plan, hidden: true }], config: { default_agent: 'build' }, providers: [], connected: [], models: [], providerAuthMethodsById: {} };
    await persistCapabilitiesSnapshot('scope', '/a', value, Date.now(), storage);
    const apply = vi.fn();
    await hydrateCapabilitiesSnapshot('scope', '/a', apply, () => true, storage);
    expect(apply.mock.calls[0][0]).toMatchObject({ agents: value.agents, config: { default_agent: 'build' } });
    const stale = vi.fn();
    await hydrateCapabilitiesSnapshot('scope', '/a', stale, () => false, storage);
    expect(stale).not.toHaveBeenCalled();
  });
});
