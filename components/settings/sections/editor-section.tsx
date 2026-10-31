import { cn } from '@/lib/utils';
import { FieldDescription } from '@/components/ui/text-field';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


import { PromptDeliveryField, TimelineDetailField } from './chat-preference-fields';
import { SettingSlider as NumericSlider, SettingSwitchRow, type Palette } from './setting-rows';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { normalizeTranscriptFontSize, TRANSCRIPT_FONT_SIZE_MAX, TRANSCRIPT_FONT_SIZE_MIN } from '@/providers/opencode-preferences';


export function EditorSection({
  chatPreferences,
  promptDeliveryAvailable,
  palette,
  updateChatPreferences,
}: {
  chatPreferences: ChatPreferences;
  promptDeliveryAvailable: boolean;
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
}) {
  const { t } = useTranslation();
  const fontSize = normalizeTranscriptFontSize(chatPreferences.transcriptFontSize);

  return (
    <View testID="settings-editor-section" className={cn(stylesClasses.section)}>
      <TimelineDetailField chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} />
      <NumericSlider
        label={t('settings:appearance.chatTextSize')}
        minimum={TRANSCRIPT_FONT_SIZE_MIN}
        maximum={TRANSCRIPT_FONT_SIZE_MAX}
        step={1}
        value={fontSize}
        valueLabel={`${fontSize} px`}
        onValueChange={(transcriptFontSize) => updateChatPreferences({ transcriptFontSize })}
        palette={palette}
      />
      <FieldDescription  invalid={false}>{t('settings:appearance.chatTextSizeDescription')}</FieldDescription>
      {promptDeliveryAvailable ? <PromptDeliveryField chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} /> : null}
      <SettingSwitchRow
        title={t('settings:appearance.flatThread.title')}
        description={t('settings:appearance.flatThread.description')}
        onValueChange={(flatTranscript) => updateChatPreferences({ flatTranscript })}
        palette={palette}
        value={chatPreferences.flatTranscript === true}
      />
    </View>
  );
}



const stylesClasses = {
  "section": "gap-3.5 pb-2"
} as const;
