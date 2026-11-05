import { PromptDeliveryField } from '@/features/chat/index';
import { LanguageSection } from '@/shared/i18n/language-section';
import { useConnection } from '@/features/connections/context';
import { usePreferences } from '@/shared/preferences/context';
import { usePalette } from '@/shared/ui/theme/use-palette';

export function OnboardingGeneralSettings() {
  const palette = usePalette();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const { connection, serverCapabilities } = useConnection();
  const connected = connection.status === 'connected';

  return (
    <>
      <LanguageSection showDescription={false} chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} />
      {connected && serverCapabilities.promptDeliveryAvailable ? <PromptDeliveryField chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} /> : null}
    </>
  );
}
