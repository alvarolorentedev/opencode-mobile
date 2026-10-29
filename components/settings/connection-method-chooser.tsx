import { SettingButton as Button } from './sections/setting-rows';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, View } from 'react-native';
import { List, Text } from 'react-native-paper';

import { CONNECT_LEARN_MORE_URL } from '@/lib/connect';
import { useConnection } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

export function ConnectionMethodChooser({ onScan, onManual, onPair }: { onScan: () => void; onManual: () => void; onPair: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const choiceStyle = { minHeight: 96, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface };
  const titleStyle = { color: palette.text, fontWeight: '600' as const };
  const descriptionStyle = { color: palette.muted };
  const { connectSetup } = useConnection();
  const scanAvailable = (Platform.OS === 'ios' || Platform.OS === 'android') && !Constants.expoConfig?.extra?.foss;
  return <View testID="connection-method-chooser" style={{ gap: 12 }}>
    <List.Item accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-scan" title={t('settings:connect.scanLocal')} description={t('settings:connect.scanLocalHint')} left={(props) => <List.Icon {...props} icon="qrcode-scan" color={palette.tint} />} right={(props) => <List.Icon {...props} icon="chevron-right" color={palette.muted} />} onPress={onScan} disabled={!scanAvailable} accessibilityState={{ disabled: !scanAvailable }} />
    <List.Item accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-manual" title={t('settings:connect.manual')} description={t('settings:connect.manualHint')} left={(props) => <List.Icon {...props} icon="server" color={palette.tint} />} right={(props) => <List.Icon {...props} icon="chevron-right" color={palette.muted} />} onPress={onManual} />
    <List.Item accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-connect" title={t('settings:connect.entry')} description={t('settings:connect.scanHint')} left={(props) => <List.Icon {...props} icon="cloud-outline" color={palette.tint} />} right={(props) => <List.Icon {...props} icon="chevron-right" color={palette.muted} />} onPress={onPair} disabled={!connectSetup.enabled} accessibilityState={{ disabled: !connectSetup.enabled }} />
    {!connectSetup.enabled ? <Text style={{ color: palette.muted }} variant="bodySmall">{t('settings:connect.nativeOnly')}</Text> : null}
    <Button testID="connect-learn-more" mode="text" icon="open-in-new" style={{ alignSelf: 'flex-start' }} onPress={() => void Linking.openURL(CONNECT_LEARN_MORE_URL).catch(() => undefined)}>{t('settings:connect.learnMore')}</Button>
  </View>;
}
