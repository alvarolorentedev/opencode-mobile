import type { ModelComplexity } from '@/lib/auto-model/classifier-prompt';
import type { AutoModelPreferences } from '@/lib/auto-model/preferences';
import type { ModelOption } from '@/providers/opencode-model-selection';

// Pure model-routing rules. Classification always comes from a real classifier
// (on-device GGUF or the OpenCode generate endpoint); this module only maps a
// returned tier to a model and applies capability/cache guards.

export type AutoModelSuggestions = Record<ModelComplexity, string | undefined>;
export type AutoModelSelection = {
  model: ModelOption;
  tier: ModelComplexity;
  variant?: string;
  sameAsCurrent: boolean;
};

const LONG_CHAT_CONTEXT_TOKENS = 32_000;
const MAX_DOWNGRADE_PRICE_RATIO = 0.5;

function compareIds(left: ModelOption, right: ModelOption) {
  return left.id.localeCompare(right.id);
}

function modelCost(model: ModelOption) {
  if (!model.pricing) {
    return Number.POSITIVE_INFINITY;
  }
  return model.pricing.input + model.pricing.output * 2;
}

function classifierCost(model: ModelOption) {
  if (!model.pricing) {
    return Number.POSITIVE_INFINITY;
  }
  return model.pricing.input + model.pricing.output * 0.1;
}

function isUsable(model: ModelOption) {
  return model.status !== 'deprecated';
}

function toolCapable(models: ModelOption[]) {
  const capable = models.filter((model) => model.supportsToolCalls);
  return capable.length > 0 ? capable : models;
}

export function getAutoModelSuggestions(models: ModelOption[], defaultModelId?: string): AutoModelSuggestions {
  const usable = models.filter(isUsable);
  const pool = toolCapable(usable);
  if (pool.length === 0) {
    return { simple: undefined, standard: undefined, complex: undefined };
  }

  const simple = [...pool].sort((left, right) => {
    const cost = modelCost(left) - modelCost(right);
    if (Number.isFinite(cost) && cost !== 0) return cost;
    return compareIds(left, right);
  })[0];
  const standard = usable.find((model) => model.id === defaultModelId) ?? simple;
  const complex = [...pool].sort((left, right) => {
    if (left.supportsReasoning !== right.supportsReasoning) return left.supportsReasoning ? -1 : 1;
    const context = (right.contextLimit ?? 0) - (left.contextLimit ?? 0);
    if (context !== 0) return context;
    const cost = modelCost(right) - modelCost(left);
    if (Number.isFinite(cost) && cost !== 0) return cost;
    return compareIds(left, right);
  })[0];

  return { simple: simple?.id, standard: standard?.id, complex: complex?.id };
}

export function getCheapestClassifierModel(models: ModelOption[]) {
  const usable = models.filter(isUsable);
  return [...usable].sort((left, right) => {
    const cost = classifierCost(left) - classifierCost(right);
    if (Number.isFinite(cost) && cost !== 0) return cost;
    return compareIds(left, right);
  })[0];
}

export function getClassifierModelId(preferences: AutoModelPreferences, models: ModelOption[]) {
  const explicit = preferences.classifierModelId
    ? models.find((model) => model.id === preferences.classifierModelId)
    : undefined;
  return explicit?.id ?? getCheapestClassifierModel(models)?.id;
}

export function getAttachmentModality(mime?: string) {
  if (!mime) return undefined;
  if (mime.startsWith('image/')) return 'image' as const;
  if (mime.startsWith('audio/')) return 'audio' as const;
  if (mime.startsWith('video/')) return 'video' as const;
  if (mime === 'application/pdf') return 'pdf' as const;
  return undefined;
}

export function isModelCompatibleWithAttachments(
  model: ModelOption,
  attachments?: { mime?: string }[],
) {
  if (!attachments?.length) {
    return true;
  }
  if (!model.supportsAttachments) {
    return false;
  }
  return attachments.every((attachment) => {
    const modality = getAttachmentModality(attachment.mime);
    return !modality || model.inputModalities.length === 0 || model.inputModalities.includes(modality);
  });
}

export function estimatePromptTokens(prompt: string) {
  return Math.ceil(prompt.length / 4);
}

function currentModelId(currentModel?: { providerID: string; id: string }) {
  return currentModel ? `${currentModel.providerID}/${currentModel.id}` : undefined;
}

function passesCacheGuard(input: {
  preferences: AutoModelPreferences;
  tier: ModelComplexity;
  target: ModelOption;
  current?: ModelOption;
  contextTokens?: number;
}) {
  if (!input.preferences.protectLongChats || input.tier === 'complex') {
    return true;
  }
  if ((input.contextTokens ?? 0) < LONG_CHAT_CONTEXT_TOKENS || !input.current) {
    return true;
  }

  const currentInput = input.current.pricing?.input;
  const targetInput = input.target.pricing?.input;
  if (currentInput === undefined || targetInput === undefined) {
    return false;
  }
  return targetInput <= currentInput * MAX_DOWNGRADE_PRICE_RATIO;
}

export function resolveAutoModelSelection(input: {
  tier: ModelComplexity;
  preferences: AutoModelPreferences;
  models: ModelOption[];
  defaultModelId?: string;
  currentModel?: { providerID: string; id: string; variant?: string };
  modelVariantSelections?: Record<string, string | null>;
  attachments?: { mime?: string }[];
  contextTokens?: number;
  promptTokens?: number;
}): AutoModelSelection | undefined {
  if (input.models.length === 0) {
    return undefined;
  }

  const suggestions = getAutoModelSuggestions(input.models, input.defaultModelId);
  const requested = input.preferences.tiers[input.tier];
  const modelId = requested === 'auto' ? suggestions[input.tier] : requested;
  const model = modelId ? input.models.find((candidate) => candidate.id === modelId) : undefined;
  if (!model) {
    return undefined;
  }

  if (!isModelCompatibleWithAttachments(model, input.attachments)) {
    return undefined;
  }

  const requiredTokens = (input.contextTokens ?? 0) + (input.promptTokens ?? 0);
  if (model.contextLimit && requiredTokens > model.contextLimit) {
    return undefined;
  }

  const currentId = currentModelId(input.currentModel);
  const current = currentId ? input.models.find((candidate) => candidate.id === currentId) : undefined;
  if (!passesCacheGuard({
    preferences: input.preferences,
    tier: input.tier,
    target: model,
    current,
    contextTokens: input.contextTokens,
  })) {
    return undefined;
  }

  const selectedVariant = input.modelVariantSelections?.[model.id];
  const variant = selectedVariant && model.variants.some((candidate) => candidate.id === selectedVariant)
    ? selectedVariant
    : undefined;

  return {
    model,
    tier: input.tier,
    ...(variant ? { variant } : {}),
    sameAsCurrent: currentId === model.id,
  };
}
