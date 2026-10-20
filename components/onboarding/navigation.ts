export const ONBOARDING_STEPS = ['index', 'permissions', 'connect', 'ai', 'project', 'general', 'ready'] as const;
export type OnboardingStepName = typeof ONBOARDING_STEPS[number];

export function getOnboardingSteps(hasConnection: boolean) {
  return ONBOARDING_STEPS.filter((step) => hasConnection || (step !== 'ai' && step !== 'project'));
}

export function onboardingRoute(step: OnboardingStepName) {
  return step === 'index' ? '/onboarding' : `/onboarding/${step}` as const;
}
