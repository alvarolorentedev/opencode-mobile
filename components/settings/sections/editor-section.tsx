import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';

import { NumericSlider } from '@/components/ui/numeric-slider';
import type { ServerContract } from '@/lib/opencode/client';
import { TRANSCRIPT_VERBOSITIES } from '@/lib/opencode/transcript';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { normalizeTranscriptFontSize, TRANSCRIPT_FONT_SIZE_MAX, TRANSCRIPT_FONT_SIZE_MIN } from '@/providers/opencode-preferences';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';

export function EditorSection({
  chatPreferences,
  contract,
  palette,
  updateChatPreferences,
}: {
  chatPreferences: ChatPreferences;
  contract: ServerContract;
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
}) {
  const { t } = useTranslation();
  const fontSize = normalizeTranscriptFontSize(chatPreferences.transcriptFontSize);

  return (
    <View testID="settings-editor-section" style={styles.section}>
      <Text accessibilityRole="header" variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:editor.title')}</Text>
      {contract === 'v2' ? <SettingSelectField
        label={t('settings:providers.promptDelivery.label')}
        valueLabel={t(`settings:providers.promptDelivery.${chatPreferences.promptDelivery || 'steer'}.label`)}
        selectedValue={chatPreferences.promptDelivery || 'steer'}
        options={(['steer', 'queue'] as const).map((value) => ({ value, label: t(`settings:providers.promptDelivery.${value}.label`), description: t(`settings:providers.promptDelivery.${value}.description`) }))}
        onValueChange={(promptDelivery) => updateChatPreferences({ promptDelivery })}
        palette={palette}
      /> : null}
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
      <SettingSelectField
        label={t('settings:appearance.transcriptVerbosity.label')}
        valueLabel={t(`settings:appearance.transcriptVerbosity.${chatPreferences.transcriptVerbosity || 'basic'}.label`)}
        selectedValue={chatPreferences.transcriptVerbosity || 'basic'}
        options={TRANSCRIPT_VERBOSITIES.map((value) => ({
          value,
          label: t(`settings:appearance.transcriptVerbosity.${value}.label`),
          description: t(`settings:appearance.transcriptVerbosity.${value}.description`),
        }))}
        onValueChange={(transcriptVerbosity) => updateChatPreferences({ transcriptVerbosity })}
        palette={palette}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  title: { fontWeight: '600' },
});
