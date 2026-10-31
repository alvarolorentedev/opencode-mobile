import { useRouter } from 'expo-router';

import { useConnection } from '@/features/connections/context';
import { getOnboardingSteps, onboardingRoute, type OnboardingStepName } from '@/features/onboarding/ui/navigation';

export function useOnboardingNavigation(name: OnboardingStepName) {
  const router = useRouter();
  const { connection } = useConnection();
  // Reconnecting must not unmount an in-progress provider sign-in dialog.
  const steps = getOnboardingSteps(connection.status === 'connected' || connection.status === 'connecting');
  const index = steps.indexOf(name);
  const previous = steps[index - 1];
  const next = steps[index + 1];

  return {
    step: index + 1,
    totalSteps: steps.length,
    available: index !== -1,
    back: previous ? () => router.dismissTo(onboardingRoute(previous)) : undefined,
    next: () => { if (next) router.push(onboardingRoute(next)); },
  };
}
