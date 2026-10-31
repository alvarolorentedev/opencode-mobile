import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { ListRow } from '@/shared/ui/list-row';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { SettingTarget } from '@/shared/ui/settings/settings-panel';
import { formatDataUsage, resetDataUsage, useDataUsage } from '@/shared/network/data-usage';
import { useRequestStats } from '@/shared/network/request-stats';
import type { RecordedJsError } from '@/shared/platform/error-reporting';
import type { NetworkStatus } from '@/shared/network/network-status';
import type { Diagnostics } from '@/shared/protocol/services/diagnostics-service';
import { Palette } from '@/shared/ui/settings/setting-rows';

export function DiagnosticsSection({
  diagnostics,
  eventStreamStatus,
  transport,
  lastJsError,
  onRefresh,
  palette,
}: {
  diagnostics?: Diagnostics;
  eventStreamStatus: 'idle' | 'connecting' | 'connected' | 'error';
  transport: {
    network: NetworkStatus;
    reconnect: { attempt: number; maxAttempts: number; retryAt?: number };
  };
  lastJsError?: RecordedJsError;
  onRefresh: () => void;
  palette: Palette;
}) {
  const { t } = useTranslation();
  const dataUsage = useDataUsage();
  const requestStats = useRequestStats();
  // Diagnostics was previously refreshed during every chat bootstrap. Load it
  // when this section opens instead.
  const refreshRef = useRef(onRefresh);
  useLayoutEffect(() => { refreshRef.current = onRefresh; });
  useEffect(() => { refreshRef.current(); }, []);
  const health = diagnostics?.health.available ? diagnostics.health.data : undefined;
  const mcpCount = diagnostics?.mcp.available ? Object.keys(diagnostics.mcp.data).length : undefined;
  const notAvailable = t('settings:diagnostics.notAvailable');
  const subsystemParts = [t('settings:diagnostics.subsystemsMcp', { value: mcpCount ?? notAvailable })];
  return (
    <View className={cn(stylesClasses.section)}>
        <Text className={cn(stylesClasses.title, "text-foreground")} variant="heading">{t('settings:diagnostics.title')}</Text>
        <SettingTarget label={t('settings:diagnostics.server')}><ListRow title={t('settings:diagnostics.server')} description={health ? t('settings:diagnostics.openCodeVersion', { version: health.version }) : t('settings:diagnostics.healthUnavailable')} right={() => <Badge  variant="secondary"><Text>{health?.healthy ? t('settings:diagnostics.healthy') : t('common:labels.unknown')}</Text></Badge>}></ListRow></SettingTarget>
        <SettingTarget label={t('settings:diagnostics.realtimeUpdates')}><ListRow title={t('settings:diagnostics.realtimeUpdates')} description={eventStreamStatus === 'connected' ? t('settings:diagnostics.eventStreamConnected') : t('settings:diagnostics.pollingFallback')} right={() => <Badge  variant="secondary"><Text>{eventStreamStatus}</Text></Badge>}></ListRow></SettingTarget>
        <SettingTarget label={t('settings:diagnostics.network')}><ListRow title={t('settings:diagnostics.network')} description={t('settings:diagnostics.networkValue', {
            type: transport.network.type,
            state: transport.network.online ? t('settings:diagnostics.networkOnline') : t('settings:diagnostics.networkOffline'),
            generation: transport.network.generation ? ` · ${transport.network.generation}` : '',
          })} right={() => <Badge  variant="secondary"><Text>{transport.network.constrained ? t('settings:diagnostics.networkConstrained') : t('settings:diagnostics.networkNormal')}</Text></Badge>}></ListRow></SettingTarget>
        {transport.reconnect.retryAt ? (
          <ListRow title={t('settings:diagnostics.reconnect')} description={t('settings:diagnostics.reconnectValue', { attempt: transport.reconnect.attempt, max: transport.reconnect.maxAttempts })}></ListRow>
        ) : null}
        <SettingTarget label={t('settings:diagnostics.requestLatency')}><ListRow title={t('settings:diagnostics.requestLatency')} description={t('settings:diagnostics.requestLatencyValue', {
            p50: requestStats.p50Ms,
            p95: requestStats.p95Ms,
            failed: requestStats.failed,
            retries: requestStats.retries,
          })}></ListRow></SettingTarget>
        <ListRow title={t('settings:diagnostics.subsystems')} description={subsystemParts.join(' • ')}></ListRow>
        <Text  variant="title">{t('common:servers.appDiagnostics')}</Text>
        <SettingTarget label={t('settings:diagnostics.networkUsage')}><ListRow title={t('settings:diagnostics.networkUsage')} description={t('settings:diagnostics.networkUsageValue', { requests: dataUsage.requests, size: formatDataUsage(dataUsage.bytes) })}></ListRow></SettingTarget>
        <SettingTarget label={t('settings:diagnostics.lastError')}><ListRow title={t('settings:diagnostics.lastError')} description={lastJsError
            ? t('settings:diagnostics.lastErrorValue', { message: lastJsError.message, time: new Date(lastJsError.at).toLocaleString() })
            : t('settings:diagnostics.lastErrorNone')} right={lastJsError
            ? () => <Badge  variant="secondary"><Text>{lastJsError.isFatal ? t('settings:diagnostics.lastErrorFatal') : t('settings:diagnostics.lastErrorHandled')}</Text></Badge>
            : undefined}></ListRow></SettingTarget>
        <View className={cn(stylesClasses.diagnosticsActions)}>
          <Button onPress={onRefresh} variant="outline"><Text>{t('settings:diagnostics.refresh')}</Text></Button>
          <Button onPress={resetDataUsage} variant="ghost"><Text>{t('settings:diagnostics.networkUsageReset')}</Text></Button>
        </View>
    </View>
  );
}

const stylesClasses = {
  "section": "gap-3.5 pb-2",
  "title": "font-semibold",
  "diagnosticsActions": "flex-row items-center gap-2"
} as const;
