import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { List, Text } from 'react-native-paper';

import { usePalette } from '@/providers/theme-provider';
import { useConnection } from '@/providers/opencode-contexts';

export function ConnectionMethodChooser({ onPair, onManual }: { onPair: () => void; onManual: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const choiceStyle = { minHeight: 96, borderRadius: 12, backgroundColor: palette.surface };
  const titleStyle = { color: palette.text };
  const descriptionStyle = { color: palette.muted };
  const { connectSetup } = useConnection();
  return <View testID="connection-method-chooser" style={{ gap: 16 }}>
    <List.Item accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-connect" title={t('settings:connect.entry')} description={t('settings:connect.scanHint')} left={(props) => <List.Icon {...props} icon="qrcode-scan" color={palette.tint} />} right={(props) => <List.Icon {...props} icon="chevron-right" color={palette.muted} />} onPress={onPair} disabled={!connectSetup.enabled} accessibilityState={{ disabled: !connectSetup.enabled }} />
    {!connectSetup.enabled ? <Text style={{ color: palette.muted }} variant="bodySmall">{t('settings:connect.nativeOnly')}</Text> : null}
    <List.Item accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-manual" title={t('settings:connect.manual')} description={t('settings:connect.manualHint')} left={(props) => <List.Icon {...props} icon="server" color={palette.tint} />} right={(props) => <List.Icon {...props} icon="chevron-right" color={palette.muted} />} onPress={onManual} />
  </View>;
}
