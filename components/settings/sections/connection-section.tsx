import { SettingButton as Button } from './setting-rows';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { SettingTarget } from '../settings-panel';
import { ConnectionProfiles } from '@/components/settings/connection-profiles';
import { formatTimestamp } from '@/lib/opencode/format';
import type { Palette } from './setting-rows';

type ConnectionSectionProps = {
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string; checkedAt?: number };
  palette: Palette;
  onReconnect?: () => void;
  isReconnecting?: boolean;
  onPair?: () => void;
  onManageConnect?: () => void;
};

export function ConnectionSection({ connection, palette, onPair, onManageConnect, onReconnect, isReconnecting }: ConnectionSectionProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
        {connection.checkedAt ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:connection.lastChecked', { time: formatTimestamp(connection.checkedAt) })}</Text> : null}
        {onReconnect ? <SettingTarget label={t('common:actions.reconnect')}><Button mode="outlined" icon="refresh" loading={isReconnecting} disabled={isReconnecting} onPress={onReconnect}>{t('common:actions.reconnect')}</Button></SettingTarget> : null}
        <ConnectionProfiles palette={palette} onManageConnect={onManageConnect} onPair={onPair} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
});
