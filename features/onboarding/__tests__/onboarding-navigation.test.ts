import { describe, expect, it } from 'vitest';

import { getOnboardingSteps, onboardingRoute } from '@/features/onboarding/ui/navigation';
import { getVisibleModels } from '@/features/ai/model/opencode-model-selection';
import { type ModelOption } from '@/shared/contracts/model-options';

const models = [
  { id: 'openai/mini', providerID: 'openai', variants: [] },
  { id: 'openai/full', providerID: 'openai', variants: [] },
  { id: 'openrouter/auto', providerID: 'openrouter', variants: [] },
] as unknown as ModelOption[];

describe('onboarding navigation and model choices', () => {
  it('inserts AI after connection and Voice after General', () => {
    expect(getOnboardingSteps(true)).toEqual(['index', 'permissions', 'connect', 'ai', 'project', 'general', 'voice', 'ready']);
    expect(getOnboardingSteps(true).map(onboardingRoute)).toEqual([
      '/onboarding', '/onboarding/permissions', '/onboarding/connect', '/onboarding/ai',
      '/onboarding/project', '/onboarding/general', '/onboarding/voice', '/onboarding/ready',
    ]);
  });

  it('skips server-dependent steps in both directions without a connection', () => {
    const steps = getOnboardingSteps(false);
    expect(steps).toEqual(['index', 'permissions', 'connect', 'general', 'voice', 'ready']);
    expect(steps[steps.indexOf('general') - 1]).toBe('connect');
    expect(steps[steps.indexOf('voice') - 1]).toBe('general');
    expect(steps[steps.indexOf('voice') + 1]).toBe('ready');
  });

  it('uses the same configured, enabled models in Chat, General, and Review', () => {
    expect(getVisibleModels(models, [{ id: 'openai' }], ['openai/full', 'openrouter/auto']))
      .toEqual([models[1]]);
    expect(getVisibleModels(models, [{ id: 'openai' }], [])).toEqual(models.slice(0, 2));
    expect(getVisibleModels(models, [], ['openai/mini'])).toEqual([]);
    expect(getVisibleModels([], [{ id: 'openai' }], [])).toEqual([]);
    expect(getVisibleModels(models, [{ id: 'openai' }], ['removed/model'])).toEqual([]);
  });
});
