import { useMemo } from 'react';

import { useAppStore } from '@/runtime/core';

import { CURRENT_ONBOARDING_VERSION, isOnboardingComplete } from './model/onboarding-state';
import type { OnboardingContextValue } from './model/types';

export function useOnboarding(): OnboardingContextValue {
  const isHydrated = useAppStore((state) => state.registry.ready);
  const version = useAppStore((state) => state.shell.onboardingVersion);
  const onboardingActive = useAppStore((state) => state.shell.onboardingActive);
  const setShellValue = useAppStore((state) => state.setShellValue);
  const actions = useMemo(() => ({
    completeOnboarding: async () => {
      setShellValue('onboardingVersion', CURRENT_ONBOARDING_VERSION);
      setShellValue('onboardingActive', false);
    },
    startOnboardingReview: () => setShellValue('onboardingActive', true),
    stopOnboardingReview: () => setShellValue('onboardingActive', false),
  }), [setShellValue]);
  return useMemo(() => ({
    isHydrated, onboardingCompleted: isOnboardingComplete(version), onboardingActive, ...actions,
  }), [actions, isHydrated, onboardingActive, version]);
}
