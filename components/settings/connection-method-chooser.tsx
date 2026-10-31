import { cn } from '@/lib/utils';
import { ListRow } from '@/components/ui/list-row';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';

import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, View } from 'react-native';


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
  return <View testID="connection-method-chooser" className={cn("gap-3")}>
    <ListRow accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-scan" title={t('settings:connect.scanLocal')} description={t('settings:connect.scanLocalHint')} left={(props) => <Icon {...props} color={palette.tint} name={"qrcode-scan"}></Icon>} right={(props) => <Icon {...props} color={palette.muted} name={"chevron-right"}></Icon>} onPress={onScan} disabled={!scanAvailable} accessibilityState={{ disabled: !scanAvailable }}></ListRow>
    <ListRow accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-manual" title={t('settings:connect.manual')} description={t('settings:connect.manualHint')} left={(props) => <Icon {...props} color={palette.tint} name={"server"}></Icon>} right={(props) => <Icon {...props} color={palette.muted} name={"chevron-right"}></Icon>} onPress={onManual}></ListRow>
    <ListRow accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-connect" title={t('settings:connect.entry')} description={t('settings:connect.scanHint')} left={(props) => <Icon {...props} color={palette.tint} name={"cloud-outline"}></Icon>} right={(props) => <Icon {...props} color={palette.muted} name={"chevron-right"}></Icon>} onPress={onPair} disabled={!connectSetup.enabled} accessibilityState={{ disabled: !connectSetup.enabled }}></ListRow>
    {!connectSetup.enabled ? <Text className={cn("text-muted-foreground")} variant="label">{t('settings:connect.nativeOnly')}</Text> : null}
    <Button testID="connect-learn-more" onPress={() => void Linking.openURL(CONNECT_LEARN_MORE_URL).catch(() => undefined)} variant={"ghost"} className={cn("self-start")} style={[undefined, undefined]}><Icon name={"open-in-new"} size={20} /><Text>{t('settings:connect.learnMore')}</Text></Button>
  </View>;
}
