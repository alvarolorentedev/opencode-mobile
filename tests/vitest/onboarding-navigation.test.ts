import { describe, expect, it } from 'vitest';

import { getOnboardingSteps, onboardingRoute } from '@/components/onboarding/navigation';
import { getVisibleModels, type ModelOption } from '@/providers/opencode-model-selection';

const models = [
  { id: 'openai/mini', providerID: 'openai' },
  { id: 'openai/full', providerID: 'openai' },
  { id: 'openrouter/auto', providerID: 'openrouter' },
] as ModelOption[];

describe('onboarding navigation and model choices', () => {
  it('inserts AI after connection and General before review', () => {
    expect(getOnboardingSteps(true)).toEqual(['index', 'permissions', 'connect', 'ai', 'project', 'general', 'ready']);
    expect(getOnboardingSteps(true).map(onboardingRoute)).toEqual([
      '/onboarding', '/onboarding/permissions', '/onboarding/connect', '/onboarding/ai',
      '/onboarding/project', '/onboarding/general', '/onboarding/ready',
    ]);
  });

  it('skips server-dependent steps in both directions without a connection', () => {
    const steps = getOnboardingSteps(false);
    expect(steps).toEqual(['index', 'permissions', 'connect', 'general', 'ready']);
    expect(steps[steps.indexOf('general') - 1]).toBe('connect');
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
