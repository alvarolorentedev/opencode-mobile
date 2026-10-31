

// Domain-scoped context values. Consumers subscribe to the narrowest value they
// need (`useProjects()`, `useChat()`, ...) instead of one 130-member surface,
// so unrelated state changes do not re-render every screen.
export type OnboardingContextValue = {
  isHydrated: boolean;
  onboardingCompleted: boolean;
  onboardingActive: boolean;
  completeOnboarding: () => Promise<void>;
  startOnboardingReview: () => void;
  stopOnboardingReview: () => void;
};
