import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text } from 'react-native-paper';

import type { ChatPreferences } from '@/providers/opencode-provider';
import { LanguageSection } from './language-section';
import { SettingSwitchRow, type Palette } from './setting-rows';

export function GeneralSection({ chatPreferences, palette, updateChatPreferences, onResetOnboarding }: {
  chatPreferences: ChatPreferences;
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  onResetOnboarding: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View testID="settings-general-section" style={styles.section}>
      <Text accessibilityRole="header" variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:general.title')}</Text>
      <SettingSwitchRow
        title={t('settings:appearance.slimInterface.title')}
        description={t('settings:appearance.slimInterface.description')}
        onValueChange={(slimInterface) => updateChatPreferences({ slimInterface })}
        palette={palette}
        value={chatPreferences.slimInterface === true}
      />
      <LanguageSection chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} />
      {Platform.OS === 'android' ? <SettingSwitchRow
        title={t('share:widgets.previewsTitle')}
        description={t('share:widgets.previewsDescription')}
        onValueChange={(showWidgetPreviews) => updateChatPreferences({ showWidgetPreviews })}
        palette={palette}
        value={chatPreferences.showWidgetPreviews !== false}
      /> : null}
      <Button mode="outlined" icon="restart" onPress={onResetOnboarding}>{t('settings:general.resetOnboarding')}</Button>
      <HelperText type="info">{t('onboarding:settingsAssistant.summary')}</HelperText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  title: { fontWeight: '600' },
});
