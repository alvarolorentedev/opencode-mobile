import type { Model, Part } from '@/lib/opencode/types';
import type { SessionMessageRecord } from '@/lib/opencode/format';

type CostStatus = 'recorded' | 'estimated' | 'free' | 'pricing-unavailable';
type UsageTotals = { cost: number; inputTokens: number; outputTokens: number; reasoningTokens: number; cacheReadTokens: number; cacheWriteTokens: number; completedSteps: number };
type ModelUsage = UsageTotals & { providerId: string; modelId: string; costStatus: CostStatus };
type ProviderUsage = UsageTotals & { providerId: string; models: ModelUsage[] };
type UsagePricing = Model['cost'];
export type SessionUsage = UsageTotals & { costStatus: CostStatus; providers: ProviderUsage[] };

const EMPTY_TOTALS: UsageTotals = { cacheReadTokens: 0, cacheWriteTokens: 0, completedSteps: 0, cost: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

function addTotals(target: UsageTotals, source: UsageTotals) {
  target.cost += source.cost;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningTokens += source.reasoningTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.completedSteps += source.completedSteps;
}

function hasTokens(totals: UsageTotals) {
  return totals.inputTokens + totals.outputTokens + totals.reasoningTokens + totals.cacheReadTokens + totals.cacheWriteTokens > 0;
}

function hasUsablePricing(pricing: UsagePricing | undefined): pricing is UsagePricing {
  return Boolean(pricing && Number.isFinite(pricing.input) && Number.isFinite(pricing.output) && Number.isFinite(pricing.cache.read) && Number.isFinite(pricing.cache.write) && (pricing.input > 0 || pricing.output > 0));
}

function getCostStatus(totals: UsageTotals, recordedCost: number, hasPricing: boolean): CostStatus {
  if (recordedCost > 0) return 'recorded';
  if (!hasTokens(totals)) return 'free';
  return hasPricing ? 'estimated' : 'pricing-unavailable';
}

function getStepTotals(part: Extract<Part, { type: 'step-finish' }>, pricing?: UsagePricing) {
  const totals: UsageTotals = { cacheReadTokens: part.tokens.cache.read, cacheWriteTokens: part.tokens.cache.write, completedSteps: 1, cost: part.cost, inputTokens: part.tokens.input, outputTokens: part.tokens.output, reasoningTokens: part.tokens.reasoning };
  if (totals.cost <= 0 && hasTokens(totals) && hasUsablePricing(pricing)) {
    const contextTokens = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
    const tier = pricing.tiers
      ?.filter((item) => contextTokens > item.tier.size)
      .sort((left, right) => right.tier.size - left.tier.size)[0];
    const effectivePricing = tier || (contextTokens > 200_000 ? pricing.experimentalOver200K : undefined) || pricing;
    // OpenCode model costs are per token; reasoning is output-priced unless metadata says otherwise.
    totals.cost = totals.inputTokens * effectivePricing.input + (totals.outputTokens + totals.reasoningTokens) * effectivePricing.output + totals.cacheReadTokens * effectivePricing.cache.read + totals.cacheWriteTokens * effectivePricing.cache.write;
  }
  return totals;
}

// A single completed model call. A paginated transcript window no longer holds
// every message, so the provider accumulates these steps independently of the
// loaded window to keep session cost/token totals exact.
export type SessionUsageStep = {
  key: string;
  providerId: string;
  modelId: string;
  part: Extract<Part, { type: 'step-finish' }>;
};

export function usageStepKey(part: Extract<Part, { type: 'step-finish' }>) {
  return `${part.sessionID}:${part.messageID}:${part.id}`;
}

// Keep one current usage entry per model call, including updates to an existing
// message, so replayed fetches and events cannot double count.
export function addUsageSteps(steps: Map<string, SessionUsageStep>, messages: SessionMessageRecord[]) {
  let changed = false;
  for (const { info, parts } of messages) {
    if (info.role !== 'assistant') continue;
    for (const part of parts) {
      if (part.type !== 'step-finish') continue;
      const key = usageStepKey(part);
      if (JSON.stringify(steps.get(key)?.part) !== JSON.stringify(part)) {
        steps.set(key, { key, providerId: info.providerID, modelId: info.modelID, part });
        changed = true;
      }
    }
  }
  return changed;
}

export function aggregateUsageSteps(steps: Iterable<SessionUsageStep>, pricingByModel: Record<string, UsagePricing> = {}): SessionUsage {
  const providers = new Map<string, ProviderUsage>();
  const totals = { ...EMPTY_TOTALS };
  let hasRecordedCost = false;
  let hasEstimatedCost = false;
  let hasUnavailablePricing = false;

  for (const step of steps) {
    const providerId = step.providerId;
    const modelId = step.modelId;
    const pricing = pricingByModel[`${providerId}/${modelId}`];
    let provider = providers.get(providerId);
    if (!provider) {
      provider = { ...EMPTY_TOTALS, providerId, models: [] };
      providers.set(providerId, provider);
    }
    let model = provider.models.find((item) => item.modelId === modelId);
    if (!model) {
      model = { ...EMPTY_TOTALS, costStatus: 'free', modelId, providerId };
      provider.models.push(model);
    }
    const stepTotals = getStepTotals(step.part, pricing);
    const status = getCostStatus(stepTotals, step.part.cost, hasUsablePricing(pricing));
    hasRecordedCost ||= status === 'recorded';
    hasEstimatedCost ||= status === 'estimated';
    hasUnavailablePricing ||= status === 'pricing-unavailable';
    addTotals(totals, stepTotals);
    addTotals(provider, stepTotals);
    addTotals(model, stepTotals);
    model.costStatus = getCostStatus(model, model.cost, hasUsablePricing(pricing));
  }

  const costStatus: CostStatus = hasRecordedCost ? 'recorded' : hasEstimatedCost ? 'estimated' : hasUnavailablePricing ? 'pricing-unavailable' : 'free';
  return { ...totals, costStatus, providers: [...providers.values()].sort((a, b) => b.cost - a.cost) };
}

export function aggregateSessionUsage(messages: SessionMessageRecord[], pricingByModel: Record<string, UsagePricing> = {}): SessionUsage {
  const steps = new Map<string, SessionUsageStep>();
  addUsageSteps(steps, messages);
  return aggregateUsageSteps(steps.values(), pricingByModel);
}

export function getLatestAssistantTurnUsage(messages: SessionMessageRecord[], pricingByModel?: Record<string, UsagePricing>) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].info.role === 'assistant' && messages[index].parts.some((part) => part.type === 'step-finish')) return aggregateSessionUsage([messages[index]], pricingByModel);
  }
  return undefined;
}

// Session token totals accumulate across every call, so they overstate what is
// in the context window. The most recent call's prompt plus its reply is what
// the next call starts from. Reasoning is excluded: it is normally dropped from
// history before the next request.
export function getLatestContextTokens(messages: SessionMessageRecord[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const { info, parts } = messages[index];
    if (info.role !== 'assistant') continue;
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part.type !== 'step-finish') continue;
      const tokens = part.tokens.input + part.tokens.cache.read + part.tokens.cache.write + part.tokens.output;
      // Keep the previous completed call visible while usage has not arrived.
      if (tokens > 0) return tokens;
    }
  }
  return undefined;
}

export function formatEstimatedCost(value: number, currency = 'USD', locale = 'en-US') {
  // OpenCode's SDK exposes no response currency, so USD is the explicit fallback.
  const fractionDigits = value < 0.01 ? 6 : value < 1 ? 3 : 2;
  try {
    return new Intl.NumberFormat(locale, { currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: fractionDigits, minimumFractionDigits: value < 0.01 && value > 0 ? Math.min(4, fractionDigits) : fractionDigits, style: 'currency' }).format(value);
  } catch {
    return `${currency} ${value.toFixed(fractionDigits)}`;
  }
}

export function formatTokenCount(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
