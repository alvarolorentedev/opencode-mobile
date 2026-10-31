import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

export type PreferencesContextValue = {
  chatPreferences: ChatPreferences;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
};
