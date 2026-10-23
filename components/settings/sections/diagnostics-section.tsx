import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, List, Text } from 'react-native-paper';

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
  formatterAvailable = true,
  lastJsError,
  lspAvailable = true,
  onRefresh,
  palette,
}: {
  diagnostics?: Diagnostics;
  eventStreamStatus: 'idle' | 'connecting' | 'connected' | 'error';
  transport: {
    network: NetworkStatus;
    reconnect: { attempt: number; maxAttempts: number; retryAt?: number };
  };
  formatterAvailable?: boolean;
  lastJsError?: RecordedJsError;
  lspAvailable?: boolean;
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
  const lspCount = lspAvailable && diagnostics?.lsp.available ? diagnostics.lsp.data.length : undefined;
  const formatterCount = formatterAvailable && diagnostics?.formatter.available ? diagnostics.formatter.data.length : undefined;
  const notAvailable = t('settings:diagnostics.notAvailable');
  const subsystemParts = [t('settings:diagnostics.subsystemsMcp', { value: mcpCount ?? notAvailable })];
  if (lspAvailable) subsystemParts.push(t('settings:diagnostics.subsystemsLsp', { value: lspCount ?? notAvailable }));
  if (formatterAvailable) subsystemParts.push(t('settings:diagnostics.subsystemsFormatters', { value: formatterCount ?? notAvailable }));
  return (
    <View style={styles.section}>
        <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:diagnostics.title')}</Text>
        <List.Item title={t('settings:diagnostics.server')} description={health ? t('settings:diagnostics.openCodeVersion', { version: health.version }) : t('settings:diagnostics.healthUnavailable')} right={() => <Chip compact>{health?.healthy ? t('settings:diagnostics.healthy') : t('common:labels.unknown')}</Chip>} />
        <List.Item title={t('settings:diagnostics.realtimeUpdates')} description={eventStreamStatus === 'connected' ? t('settings:diagnostics.eventStreamConnected') : t('settings:diagnostics.pollingFallback')} right={() => <Chip compact>{eventStreamStatus}</Chip>} />
        <List.Item
          title={t('settings:diagnostics.network')}
          description={t('settings:diagnostics.networkValue', {
            type: transport.network.type,
            state: transport.network.online ? t('settings:diagnostics.networkOnline') : t('settings:diagnostics.networkOffline'),
            generation: transport.network.generation ? ` · ${transport.network.generation}` : '',
          })}
          right={() => <Chip compact>{transport.network.constrained ? t('settings:diagnostics.networkConstrained') : t('settings:diagnostics.networkNormal')}</Chip>}
        />
        {transport.reconnect.retryAt ? (
          <List.Item
            title={t('settings:diagnostics.reconnect')}
            description={t('settings:diagnostics.reconnectValue', { attempt: transport.reconnect.attempt, max: transport.reconnect.maxAttempts })}
          />
        ) : null}
        <List.Item
          title={t('settings:diagnostics.requestLatency')}
          description={t('settings:diagnostics.requestLatencyValue', {
            p50: requestStats.p50Ms,
            p95: requestStats.p95Ms,
            failed: requestStats.failed,
            retries: requestStats.retries,
          })}
        />
        <List.Item title={t('settings:diagnostics.subsystems')} description={subsystemParts.join(' • ')} />
        <Text variant="titleMedium">{t('common:servers.appDiagnostics')}</Text>
        <List.Item
          title={t('settings:diagnostics.networkUsage')}
          description={t('settings:diagnostics.networkUsageValue', { requests: dataUsage.requests, size: formatDataUsage(dataUsage.bytes) })}
        />
        <List.Item
          title={t('settings:diagnostics.lastError')}
          description={lastJsError
            ? t('settings:diagnostics.lastErrorValue', { message: lastJsError.message, time: new Date(lastJsError.at).toLocaleString() })
            : t('settings:diagnostics.lastErrorNone')}
          right={lastJsError
            ? () => <Chip compact>{lastJsError.isFatal ? t('settings:diagnostics.lastErrorFatal') : t('settings:diagnostics.lastErrorHandled')}</Chip>
            : undefined}
        />
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
