// Prompt and parsing rules shared by the on-device classifier and the
// OpenCode classifier call. The classifier must return one of three labels; the
// router never guesses a tier when the classifier is unavailable.

export const MODEL_COMPLEXITIES = ['simple', 'standard', 'complex'] as const;
export type ModelComplexity = (typeof MODEL_COMPLEXITIES)[number];

// Auto model routing preferences live in the shared lib layer so persistence
// helpers can validate them without importing provider orchestration.
export type AutoModelClassifier = 'local' | 'server';
export type AutoModelTierPreference = 'auto' | string;
export type AutoModelPreferences = {
  enabled: boolean;
  classifier: AutoModelClassifier;
  classifierModelId?: string;
  tiers: Record<ModelComplexity, AutoModelTierPreference>;
  // Thinking level used for each routed tier. `null` keeps the existing
  // per-model selection (or the model default).
  tierVariants: Record<ModelComplexity, string | null>;
  protectLongChats: boolean;
};

export const defaultAutoModelPreferences: AutoModelPreferences = {
  enabled: false,
  classifier: 'local',
  tiers: { simple: 'auto', standard: 'auto', complex: 'auto' },
  tierVariants: { simple: null, standard: null, complex: null },
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
  const tierVariants = isRecord(value.tierVariants) ? value.tierVariants : {};
  const tierVariant = (key: ModelComplexity) => {
    const candidate = tierVariants[key];
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
  };
  const classifierModelId = typeof value.classifierModelId === 'string' && value.classifierModelId.trim()
    ? value.classifierModelId.trim()
    : undefined;

  return {
    enabled: value.enabled === true,
    classifier: value.classifier === 'server' ? 'server' : 'local',
    ...(classifierModelId ? { classifierModelId } : {}),
    tiers: { simple: tier('simple'), standard: tier('standard'), complex: tier('complex') },
    tierVariants: { simple: tierVariant('simple'), standard: tierVariant('standard'), complex: tierVariant('complex') },
    protectLongChats: value.protectLongChats !== false,
  };
}
