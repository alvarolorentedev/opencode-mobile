import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  AUTO_MODEL_MAX_PROMPT_CHARS,
  buildAutoModelClassifierPrompt,
  parseAutoModelTier,
} from '@/lib/auto-model/classifier-prompt';
import {
  getAutoModelSuggestions,
  getCheapestClassifierModel,
  isModelCompatibleWithAttachments,
  resolveAutoModelSelection,
} from '@/providers/opencode-auto-model';
import { normalizeAutoModelPreferences, defaultAutoModelPreferences, type AutoModelPreferences } from '@/providers/opencode-preferences';
import type { ModelOption } from '@/providers/opencode-model-selection';

function model(overrides: Partial<ModelOption> & { id: string }): ModelOption {
  return {
    label: overrides.id,
    providerID: overrides.id.split('/')[0],
    providerLabel: 'Provider',
    modelID: overrides.id.split('/').slice(1).join('/'),
    variants: [],
    supportsReasoning: false,
    supportsAttachments: true,
    inputModalities: ['text', 'image'],
    supportsToolCalls: true,
    contextLimit: 128_000,
    outputLimit: 8_000,
    pricing: { input: 1, output: 2, cache: { read: 0, write: 0 } },
    status: 'active',
    ...overrides,
  };
}

const nano = model({ id: 'openai/nano', pricing: { input: 0.1, output: 0.2, cache: { read: 0, write: 0 } } });
const mini = model({ id: 'openai/mini', pricing: { input: 1, output: 2, cache: { read: 0, write: 0 } } });
const deep = model({
  id: 'openai/deep',
  supportsReasoning: true,
  contextLimit: 200_000,
  pricing: { input: 10, output: 20, cache: { read: 0, write: 0 } },
});

function preferences(overrides: Partial<Omit<AutoModelPreferences, 'tiers'>> & { tiers?: Partial<AutoModelPreferences['tiers']> } = {}): AutoModelPreferences {
  return normalizeAutoModelPreferences({ ...defaultAutoModelPreferences, ...overrides, tiers: { ...defaultAutoModelPreferences.tiers, ...overrides.tiers } });
}

describe('auto model classifier prompt', () => {
  it('parses only the three documented labels', () => {
    assert.equal(parseAutoModelTier('simple'), 'simple');
    assert.equal(parseAutoModelTier(' Standard. '), 'standard');
    assert.equal(parseAutoModelTier('complex\n'), 'complex');
    assert.equal(parseAutoModelTier('I would choose standard'), 'standard');
    assert.equal(parseAutoModelTier('unknown'), undefined);
    assert.equal(parseAutoModelTier(undefined), undefined);
  });

  it('includes the prompt and refuses oversized prompts', () => {
    const prompt = buildAutoModelClassifierPrompt({ prompt: 'Refactor the repository', contextTokens: 12_000 });
    assert.match(prompt, /Refactor the repository/);
    assert.match(prompt, /12,?000/);
    assert.ok('x'.repeat(AUTO_MODEL_MAX_PROMPT_CHARS).length <= AUTO_MODEL_MAX_PROMPT_CHARS);
  });
});

describe('auto model preferences', () => {
  it('fills defaults from malformed persisted values without preserving unknown fields', () => {
    const value = normalizeAutoModelPreferences({ enabled: true, classifier: 'other', tiers: { simple: 'openai/nano', standard: 42 } });
    assert.equal(value.enabled, true);
    assert.equal(value.classifier, 'local');
    assert.equal(value.tiers.simple, 'openai/nano');
    assert.equal(value.tiers.standard, 'auto');
    assert.equal(value.protectLongChats, true);
  });
});

describe('auto model catalog suggestions', () => {
  it('picks the cheapest tool model, the default, and the most capable model', () => {
    const suggestions = getAutoModelSuggestions([mini, nano, deep], 'openai/mini');
    assert.equal(suggestions.simple, 'openai/nano');
    assert.equal(suggestions.standard, 'openai/mini');
    assert.equal(suggestions.complex, 'openai/deep');
  });

  it('uses the cheapest visible model for the classifier call', () => {
    assert.equal(getCheapestClassifierModel([mini, nano, deep])?.id, 'openai/nano');
  });

  it('checks attachment modalities', () => {
    assert.equal(isModelCompatibleWithAttachments(mini, [{ mime: 'image/png' }]), true);
    assert.equal(isModelCompatibleWithAttachments({ ...mini, supportsAttachments: false }, [{ mime: 'image/png' }]), false);
    assert.equal(isModelCompatibleWithAttachments({ ...mini, inputModalities: ['text'] }, [{ mime: 'application/pdf' }]), false);
    assert.equal(isModelCompatibleWithAttachments(mini, [{ mime: 'text/plain' }]), true);
  });
});

describe('auto model resolution', () => {
  it('resolves automatic tiers and explicit overrides', () => {
    const automatic = resolveAutoModelSelection({
      tier: 'simple',
      preferences: preferences({ enabled: true }),
      models: [mini, nano, deep],
      defaultModelId: 'openai/mini',
    });
    assert.equal(automatic?.model.id, 'openai/nano');
    assert.equal(automatic?.sameAsCurrent, false);

    const explicit = resolveAutoModelSelection({
      tier: 'simple',
      preferences: preferences({ tiers: { simple: 'openai/mini' } }),
      models: [mini, nano, deep],
      defaultModelId: 'openai/mini',
    });
    assert.equal(explicit?.model.id, 'openai/mini');
  });

  it('does not guess when an explicit tier model is unavailable', () => {
    const selected = resolveAutoModelSelection({
      tier: 'complex',
      preferences: preferences({ tiers: { complex: 'openai/missing' } }),
      models: [mini, nano, deep],
      defaultModelId: 'openai/mini',
    });
    assert.equal(selected, undefined);
  });

  it('skips routing when attachments or context do not fit', () => {
    const noVision = { ...nano, supportsAttachments: false };
    assert.equal(resolveAutoModelSelection({
      tier: 'simple',
      preferences: preferences(),
      models: [noVision, mini, deep],
      defaultModelId: 'openai/mini',
      attachments: [{ mime: 'image/png' }],
    }), undefined);
    assert.equal(resolveAutoModelSelection({
      tier: 'simple',
      preferences: preferences(),
      models: [nano, mini, deep],
      defaultModelId: 'openai/mini',
      contextTokens: 200_000,
    }), undefined);
  });

  it('keeps the current model on long downgrades unless the target is much cheaper', () => {
    const costly = model({ id: 'openai/costly', pricing: { input: 6, output: 2, cache: { read: 0, write: 0 } } });
    const blocked = resolveAutoModelSelection({
      tier: 'simple',
      preferences: preferences({ protectLongChats: true, tiers: { simple: 'openai/costly' } }),
      models: [costly, deep],
      defaultModelId: 'openai/deep',
      currentModel: { providerID: 'openai', id: 'deep' },
      contextTokens: 40_000,
    });
    assert.equal(blocked, undefined);

    const allowed = resolveAutoModelSelection({
      tier: 'simple',
      preferences: preferences({ protectLongChats: true, tiers: { simple: 'openai/nano' } }),
      models: [nano, deep],
      defaultModelId: 'openai/deep',
      currentModel: { providerID: 'openai', id: 'deep' },
      contextTokens: 40_000,
    });
    assert.equal(allowed?.model.id, 'openai/nano');
  });

  it('marks an unchanged model without inventing a switch', () => {
    const selected = resolveAutoModelSelection({
      tier: 'standard',
      preferences: preferences(),
      models: [mini, nano, deep],
      defaultModelId: 'openai/mini',
      currentModel: { providerID: 'openai', id: 'mini' },
    });
    assert.equal(selected?.sameAsCurrent, true);
  });
});
