import { SettingButton as Button } from './setting-rows';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Chip, List, Text } from 'react-native-paper';

import { SettingTarget } from '../settings-panel';
import { formatDataUsage, resetDataUsage, useDataUsage } from '@/lib/opencode/data-usage';
import { useRequestStats } from '@/lib/opencode/request-stats';
import type { RecordedJsError } from '@/lib/error-reporting';
import type { NetworkStatus } from '@/lib/network-status';
import type { Diagnostics } from '@/providers/services/diagnostics-service';
import type { Palette } from './setting-rows';

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
    <View style={styles.section}>
        <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:diagnostics.title')}</Text>
        <SettingTarget label={t('settings:diagnostics.server')}><List.Item title={t('settings:diagnostics.server')} description={health ? t('settings:diagnostics.openCodeVersion', { version: health.version }) : t('settings:diagnostics.healthUnavailable')} right={() => <Chip compact>{health?.healthy ? t('settings:diagnostics.healthy') : t('common:labels.unknown')}</Chip>} /></SettingTarget>
        <SettingTarget label={t('settings:diagnostics.realtimeUpdates')}><List.Item title={t('settings:diagnostics.realtimeUpdates')} description={eventStreamStatus === 'connected' ? t('settings:diagnostics.eventStreamConnected') : t('settings:diagnostics.pollingFallback')} right={() => <Chip compact>{eventStreamStatus}</Chip>} /></SettingTarget>
        <SettingTarget label={t('settings:diagnostics.network')}><List.Item
          title={t('settings:diagnostics.network')}
          description={t('settings:diagnostics.networkValue', {
            type: transport.network.type,
            state: transport.network.online ? t('settings:diagnostics.networkOnline') : t('settings:diagnostics.networkOffline'),
            generation: transport.network.generation ? ` · ${transport.network.generation}` : '',
          })}
          right={() => <Chip compact>{transport.network.constrained ? t('settings:diagnostics.networkConstrained') : t('settings:diagnostics.networkNormal')}</Chip>}
        /></SettingTarget>
        {transport.reconnect.retryAt ? (
          <List.Item
            title={t('settings:diagnostics.reconnect')}
            description={t('settings:diagnostics.reconnectValue', { attempt: transport.reconnect.attempt, max: transport.reconnect.maxAttempts })}
          />
        ) : null}
        <SettingTarget label={t('settings:diagnostics.requestLatency')}><List.Item
          title={t('settings:diagnostics.requestLatency')}
          description={t('settings:diagnostics.requestLatencyValue', {
            p50: requestStats.p50Ms,
            p95: requestStats.p95Ms,
            failed: requestStats.failed,
            retries: requestStats.retries,
          })}
        /></SettingTarget>
        <List.Item title={t('settings:diagnostics.subsystems')} description={subsystemParts.join(' • ')} />
        <Text variant="titleMedium">{t('common:servers.appDiagnostics')}</Text>
        <SettingTarget label={t('settings:diagnostics.networkUsage')}><List.Item
          title={t('settings:diagnostics.networkUsage')}
          description={t('settings:diagnostics.networkUsageValue', { requests: dataUsage.requests, size: formatDataUsage(dataUsage.bytes) })}
        /></SettingTarget>
        <SettingTarget label={t('settings:diagnostics.lastError')}><List.Item
          title={t('settings:diagnostics.lastError')}
          description={lastJsError
            ? t('settings:diagnostics.lastErrorValue', { message: lastJsError.message, time: new Date(lastJsError.at).toLocaleString() })
            : t('settings:diagnostics.lastErrorNone')}
          right={lastJsError
            ? () => <Chip compact>{lastJsError.isFatal ? t('settings:diagnostics.lastErrorFatal') : t('settings:diagnostics.lastErrorHandled')}</Chip>
            : undefined}
        /></SettingTarget>
        <View style={styles.diagnosticsActions}>
          <Button mode="outlined" onPress={onRefresh}>{t('settings:diagnostics.refresh')}</Button>
          <Button mode="text" onPress={resetDataUsage}>{t('settings:diagnostics.networkUsageReset')}</Button>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  diagnosticsActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontWeight: '600' },
});
