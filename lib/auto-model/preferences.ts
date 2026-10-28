import type { ModelComplexity } from './classifier-prompt';

// Auto model routing preferences live in the shared lib layer so persistence
// helpers can validate them without importing provider orchestration.
export type AutoModelClassifier = 'local' | 'server';
export type AutoModelTierPreference = 'auto' | string;
export type AutoModelPreferences = {
  enabled: boolean;
  classifier: AutoModelClassifier;
  classifierModelId?: string;
  tiers: Record<ModelComplexity, AutoModelTierPreference>;
  protectLongChats: boolean;
};

export const defaultAutoModelPreferences: AutoModelPreferences = {
  enabled: false,
  classifier: 'local',
  tiers: { simple: 'auto', standard: 'auto', complex: 'auto' },
  protectLongChats: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeAutoModelPreferences(value: unknown): AutoModelPreferences {
  if (!isRecord(value)) {
    return {
      ...defaultAutoModelPreferences,
      tiers: { ...defaultAutoModelPreferences.tiers },
    };
  }

  const tiers = isRecord(value.tiers) ? value.tiers : {};
  const tier = (key: ModelComplexity) => {
    const candidate = tiers[key];
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : 'auto';
  };
  const classifierModelId = typeof value.classifierModelId === 'string' && value.classifierModelId.trim()
    ? value.classifierModelId.trim()
    : undefined;

  return {
    enabled: value.enabled === true,
    classifier: value.classifier === 'server' ? 'server' : 'local',
    ...(classifierModelId ? { classifierModelId } : {}),
    tiers: { simple: tier('simple'), standard: tier('standard'), complex: tier('complex') },
    protectLongChats: value.protectLongChats !== false,
  };
}
