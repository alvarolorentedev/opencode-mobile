import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { OnboardingContextValue } from '@/features/onboarding/model/types';

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export const useOnboarding = () => useDomainValue(OnboardingContext, 'useOnboarding');
