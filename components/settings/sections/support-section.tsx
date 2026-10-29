import { SettingButton as Button } from './setting-rows';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { SettingTarget } from '../settings-panel';
import * as Linking from 'expo-linking';
import * as StoreReview from 'expo-store-review';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { canRateApp, FEEDBACK_URL, hasPlayStoreRating, PLAY_STORE_URL, SUPPORT_URL } from '@/lib/support';
import type { Palette } from './setting-rows';

function open(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

async function requestReview() {
  const available = await StoreReview.hasAction().catch(() => false);
  if (!available) {
    if (hasPlayStoreRating()) open(PLAY_STORE_URL);
    return;
  }

  await StoreReview.requestReview().catch(() => {
    if (hasPlayStoreRating()) open(PLAY_STORE_URL);
  });
}

export function SupportSection({ palette }: { palette: Palette }) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text variant="bodyMedium" style={{ color: palette.muted }}>OpenCode Mobile {Application.nativeApplicationVersion ?? Constants.expoConfig?.version}</Text>
      <Text variant="titleSmall" style={[styles.title, { color: palette.text }]}>{t('settings:support.title')}</Text>
      <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:support.description')}</Text>
      {canRateApp() ? (
        <Button mode="contained" icon="star" onPress={() => void requestReview()}>{t('settings:support.rate')}</Button>
      ) : null}
      <SettingTarget label={t('settings:support.feedback')}><Button mode="outlined" icon="message-text-outline" onPress={() => open(FEEDBACK_URL)}>{t('settings:support.feedback')}</Button></SettingTarget>
      <SettingTarget label={t('settings:support.openSupport')}><Button mode="outlined" icon="open-in-new" onPress={() => open(SUPPORT_URL)}>{t('settings:support.openSupport')}</Button></SettingTarget>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  title: { fontWeight: '600' },
});
