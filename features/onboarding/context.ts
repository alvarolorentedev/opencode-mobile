import { useWorkspaceDomainValue } from '@/runtime/core';

export const useOnboarding = () => useWorkspaceDomainValue((values) => values.onboardingValue, 'useOnboarding');
