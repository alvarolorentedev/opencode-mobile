import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';

import { PromptDeliveryField } from './chat-preference-fields';
import { NumericSlider } from '@/components/ui/numeric-slider';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { normalizeTranscriptFontSize, TRANSCRIPT_FONT_SIZE_MAX, TRANSCRIPT_FONT_SIZE_MIN } from '@/providers/opencode-preferences';
import { SettingSwitchRow, type Palette } from './setting-rows';

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
    <View testID="settings-editor-section" style={styles.section}>
      <Text accessibilityRole="header" variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:editor.title')}</Text>
      {promptDeliveryAvailable ? <PromptDeliveryField chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} /> : null}
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
      <HelperText type="info">{t('settings:appearance.chatTextSizeDescription')}</HelperText>
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

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  title: { fontWeight: '600' },
});
