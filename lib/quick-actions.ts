import * as QuickActions from 'expo-quick-actions';
import { Platform } from 'react-native';

// Thin platform bridge over the launcher/home-screen quick actions
// (`expo-quick-actions`). The package degrades to no-ops when its native module
// is missing, so web, Expo Go, and E2E runs are unaffected; the extra platform
// guard keeps that behavior explicit. Session actions carry only a non-secret
// routing payload (session id, project path, connection scope) that the root
// shell resolves through the existing session deep-link resolver.
export type QuickAction = QuickActions.Action;

export type QuickActionItem = {
  id: string;
  title: string;
  icon?: string;
  params?: Record<string, string>;
};

// iOS shows at most four dynamic items; both platforms recommend four.
export const MAX_QUICK_ACTIONS = 4;

export const quickActionsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

export function setQuickActions(items: QuickActionItem[]) {
  if (!quickActionsSupported) return;
  void QuickActions.setItems(items.slice(0, MAX_QUICK_ACTIONS)).catch(() => undefined);
}

export function readInitialQuickAction(): QuickAction | undefined {
  return quickActionsSupported ? QuickActions.initial : undefined;
}

export function subscribeQuickActions(listener: (action: QuickAction) => void) {
  if (!quickActionsSupported) return () => undefined;
  const subscription = QuickActions.addListener(listener);
  return () => subscription.remove();
}
