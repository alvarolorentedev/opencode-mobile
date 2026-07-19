import type { Model, Part } from '@/lib/opencode/types';
import type { SessionMessageRecord } from '@/lib/opencode/format';

export type CostStatus = 'recorded' | 'estimated' | 'free' | 'pricing-unavailable';
export type UsageTotals = { cost: number; inputTokens: number; outputTokens: number; reasoningTokens: number; cacheReadTokens: number; cacheWriteTokens: number; completedSteps: number };
export type ModelUsage = UsageTotals & { providerId: string; modelId: string; costStatus: CostStatus };
export type ProviderUsage = UsageTotals & { providerId: string; models: ModelUsage[] };
export type UsagePricing = Pick<Model['cost'], 'input' | 'output' | 'cache'>;
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
    // OpenCode model costs are per token; reasoning is output-priced unless metadata says otherwise.
    totals.cost = totals.inputTokens * pricing.input + (totals.outputTokens + totals.reasoningTokens) * pricing.output + totals.cacheReadTokens * pricing.cache.read + totals.cacheWriteTokens * pricing.cache.write;
  }
  return totals;
}

export function aggregateSessionUsage(messages: SessionMessageRecord[], pricingByModel: Record<string, UsagePricing> = {}): SessionUsage {
  const providers = new Map<string, ProviderUsage>();
  const seenSteps = new Set<string>();
  const totals = { ...EMPTY_TOTALS };
  let hasRecordedCost = false;
  let hasEstimatedCost = false;
  let hasUnavailablePricing = false;

  for (const { info, parts } of messages) {
    if (info.role !== 'assistant') continue;
    const providerId = info.providerID;
    const modelId = info.modelID;
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
    for (const part of parts) {
      if (part.type !== 'step-finish') continue;
      const stepKey = `${part.sessionID}:${part.messageID}:${part.id}`;
      if (seenSteps.has(stepKey)) continue;
      seenSteps.add(stepKey);
      const stepTotals = getStepTotals(part, pricing);
      const status = getCostStatus(stepTotals, part.cost, hasUsablePricing(pricing));
      hasRecordedCost ||= status === 'recorded';
      hasEstimatedCost ||= status === 'estimated';
      hasUnavailablePricing ||= status === 'pricing-unavailable';
      addTotals(totals, stepTotals);
      addTotals(provider, stepTotals);
      addTotals(model, stepTotals);
      model.costStatus = getCostStatus(model, model.cost, hasUsablePricing(pricing));
    }
  }
  const costStatus: CostStatus = hasRecordedCost ? 'recorded' : hasEstimatedCost ? 'estimated' : hasUnavailablePricing ? 'pricing-unavailable' : 'free';
  return { ...totals, costStatus, providers: [...providers.values()].sort((a, b) => b.cost - a.cost) };
}

export function aggregateUsageByProvider(messages: SessionMessageRecord[], pricingByModel?: Record<string, UsagePricing>) {
  return aggregateSessionUsage(messages, pricingByModel).providers;
}

export function aggregateUsageByModel(messages: SessionMessageRecord[], pricingByModel?: Record<string, UsagePricing>) {
  return aggregateUsageByProvider(messages, pricingByModel).flatMap((provider) => provider.models);
}

export function getLatestAssistantTurnUsage(messages: SessionMessageRecord[], pricingByModel?: Record<string, UsagePricing>) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].info.role === 'assistant' && messages[index].parts.some((part) => part.type === 'step-finish')) return aggregateSessionUsage([messages[index]], pricingByModel);
  }
  return undefined;
}

export function formatEstimatedCost(value: number, currency = 'USD') {
  // OpenCode's SDK exposes no response currency, so USD is the explicit fallback.
  const fractionDigits = value < 0.01 ? 6 : value < 1 ? 3 : 2;
  try {
    return new Intl.NumberFormat('en-US', { currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: fractionDigits, minimumFractionDigits: value < 0.01 && value > 0 ? Math.min(4, fractionDigits) : fractionDigits, style: 'currency' }).format(value);
  } catch {
    return `${currency} ${value.toFixed(fractionDigits)}`;
  }
}

export function formatTokenCount(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
