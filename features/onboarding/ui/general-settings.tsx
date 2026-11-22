import { PromptDeliveryField } from '@/features/chat/index';
import { LanguageSection } from '@/shared/i18n/language-section';
import { useConnection } from '@/features/connections/context';
import { useWorkspacePreferences } from '@/runtime/workspace';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { OpeningScreenField } from '@/features/sessions/index';
import { useUpdates } from '@/features/updates/context';

export function OnboardingGeneralSettings() {
  const palette = usePalette();
  const { block } = useUpdates();
  const { chatPreferences, updateChatPreferences } = useWorkspacePreferences();
  const { connection, serverCapabilities } = useConnection();
  const connected = connection.status === 'connected';

  return (
    <>
      <LanguageSection block={block} showDescription={false} chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} />
      <OpeningScreenField value={chatPreferences.openingScreen} onChange={(openingScreen) => updateChatPreferences({ openingScreen })} />
      {connected && serverCapabilities.promptDeliveryAvailable ? <PromptDeliveryField chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} /> : null}
    </>
  );
}
