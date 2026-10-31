import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Icon } from '@/components/ui/icon';

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


import { SettingTarget } from '../settings-panel';
import { ConnectionProfiles } from '@/components/settings/connection-profiles';
import { formatTimestamp } from '@/lib/opencode/format';
import { Palette } from './setting-rows';

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
    <View className={cn(stylesClasses.section)}>
        <Text className={cn("text-muted-foreground")} variant="description">{connection.message}</Text>
        {connection.checkedAt ? <Text className={cn("text-muted-foreground")} variant="label">{t('settings:connection.lastChecked', { time: formatTimestamp(connection.checkedAt) })}</Text> : null}
        {onReconnect ? <SettingTarget label={t('common:actions.reconnect')}><Button disabled={isReconnecting} onPress={onReconnect} variant="outline">{isReconnecting ? <Spinner size="small" /> : null}<Icon name={"link-variant"} size={20} /><Text>{t('common:actions.reconnect')}</Text></Button></SettingTarget> : null}
        <ConnectionProfiles palette={palette} onManageConnect={onManageConnect} onPair={onPair} />
    </View>
  );
}



const stylesClasses = {
  "section": "gap-3.5 pb-2"
} as const;
