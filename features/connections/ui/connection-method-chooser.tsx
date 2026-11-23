import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { cn } from '@/shared/ui/cn';
import { ListRow } from '@/shared/ui/list-row';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';

import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, View } from 'react-native';

import { CONNECT_LEARN_MORE_URL } from '@/shared/contracts/cloud-link';
import { useConnection } from '@/features/connections/context';
import { usePalette } from '@/shared/ui/theme/use-palette';

export function ConnectionMethodChooser({ workspace, onScan, onManual, onPair }: { workspace?: WorkspaceTarget; onScan: () => void; onManual: () => void; onPair: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const choiceStyle = { minHeight: 96, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface };
  const titleStyle = { color: palette.text, fontWeight: '600' as const };
  const descriptionStyle = { color: palette.muted };
  const { connectSetup } = useConnection(workspace);
  const foss = Constants.expoConfig?.extra?.foss === true;
  const scanAvailable = (Platform.OS === 'ios' || Platform.OS === 'android') && !foss;
  return <View testID="connection-method-chooser" className={cn("gap-3")}>
    {foss ? null : <ListRow accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-scan" title={t('settings:connect.scanLocal')} description={t('settings:connect.scanLocalHint')} left={(props) => <Icon {...props} color={palette.text} name={"qrcode-scan"}></Icon>} right={(props) => <Icon {...props} color={palette.muted} name={"chevron-right"}></Icon>} onPress={onScan} disabled={!scanAvailable} accessibilityState={{ disabled: !scanAvailable }}></ListRow>}
    <ListRow accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-manual" title={t('settings:connect.manual')} description={t('settings:connect.manualHint')} left={(props) => <Icon {...props} color={palette.text} name={"server"}></Icon>} right={(props) => <Icon {...props} color={palette.muted} name={"chevron-right"}></Icon>} onPress={onManual}></ListRow>
    {foss ? null : <ListRow accessibilityRole="button" style={choiceStyle} titleStyle={titleStyle} descriptionStyle={descriptionStyle} testID="connection-method-connect" title={t('settings:connect.entry')} description={t('settings:connect.scanHint')} left={(props) => <Icon {...props} color={palette.text} name={"cloud-outline"}></Icon>} right={(props) => <Icon {...props} color={palette.muted} name={"chevron-right"}></Icon>} onPress={onPair} disabled={!connectSetup.enabled} accessibilityState={{ disabled: !connectSetup.enabled }}></ListRow>}
    {foss || connectSetup.enabled ? null : <Text className={cn("text-muted-foreground")} variant="label">{t('settings:connect.nativeOnly')}</Text>}
    {foss ? null : <Button testID="connect-learn-more" onPress={() => void Linking.openURL(CONNECT_LEARN_MORE_URL).catch(() => undefined)} variant={"ghost"} className={cn("self-start")} style={[undefined, undefined]}><Icon name={"open-in-new"} size={20} /><Text>{t('settings:connect.learnMore')}</Text></Button>}
  </View>;
}
