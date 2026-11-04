import { cn } from '@/shared/ui/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { ListRow } from '@/shared/ui/list-row';
import { Text } from '@/shared/ui/text';
import { SettingSelectField, SettingSwitchRow } from '@/shared/ui/settings/setting-rows';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { shareDiagnosticReport } from '@/shared/platform/diagnostics-share';
import { useObservabilitySnapshot, observability } from '@/shared/observability';
import { usePreferences } from '@/shared/preferences/context';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function metricValue(name: string, p95: number) {
  if (name.includes('startup')) return `${Math.round(p95)} ms`;
  if (name.includes('duration')) return `${Math.round(p95)} ms`;
  return String(Math.round(p95));
}

export function AppDiagnosticsSection() {
  const { t } = useTranslation();
  const palette = usePalette();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const snapshot = useObservabilitySnapshot();
  const { confirmAction, confirmation } = useConfirmation();
  const [severity, setSeverity] = useState<'all' | 'warn' | 'error'>('all');
  const [includeDetails, setIncludeDetails] = useState(true);
  const [busy, setBusy] = useState<'export' | 'clear' | undefined>(undefined);
  const [feedback, setFeedback] = useState<string>();

  const remote = snapshot.remoteAvailable;
  const logs = [...snapshot.recent.logs, ...snapshot.recent.errors]
    .sort((a, b) => b.ts - a.ts)
    .filter((entry) => severity === 'all' || (severity === 'warn' ? entry.level === 'warn' || entry.level === 'error' : entry.level === 'error'))
    .slice(0, 6);
  const histograms = snapshot.metrics
    .filter((entry) => entry.attrs?.metricType === 'histogram' && typeof entry.value === 'number')
    .sort((a, b) => (Number(b.attrs?.count) || 0) - (Number(a.attrs?.count) || 0))
    .slice(0, 3);

  async function exportReport() {
    setBusy('export');
    setFeedback(undefined);
    try {
      const result = await observability.exportReport({ includeDetails });
      const shared = await shareDiagnosticReport(result.uri, result.fileName);
      setFeedback(shared ? t('settings:diagnostics.exportShared') : t('settings:diagnostics.exportReady'));
    } catch {
      setFeedback(t('settings:diagnostics.exportFailed'));
    } finally {
      setBusy(undefined);
    }
  }

  function clearHistory() {
    confirmAction(
      t('settings:diagnostics.clearTitle'),
      t('settings:diagnostics.clearMessage'),
      t('settings:diagnostics.clearAction'),
      t('common:actions.cancel'),
      () => {
        setBusy('clear');
        void observability.clearLocal()
          .then(() => setFeedback(t('settings:diagnostics.cleared')))
          .catch(() => setFeedback(t('settings:diagnostics.clearFailed')))
          .finally(() => setBusy(undefined));
      },
    );
  }

  return (
    <View className={cn(stylesClasses.section)} testID="app-diagnostics-section">
      <Text className={cn('text-foreground')} variant="title">{t('settings:diagnostics.appTitle')}</Text>
      <Text className="text-muted-foreground" variant="description">{t('settings:diagnostics.appDescription')}</Text>
      <SettingSwitchRow
        title={t('settings:diagnostics.localTitle')}
        description={t('settings:diagnostics.localDescription')}
        value={chatPreferences.diagnosticsEnabled !== false}
        palette={palette}
        onValueChange={(diagnosticsEnabled) => updateChatPreferences({ diagnosticsEnabled })}
      />
      <SettingSelectField
        label={t('settings:diagnostics.levelLabel')}
        valueLabel={chatPreferences.diagnosticsLevel === 'verbose' ? t('settings:diagnostics.levelVerbose') : t('settings:diagnostics.levelNormal')}
        selectedValue={chatPreferences.diagnosticsLevel === 'verbose' ? 'verbose' : 'normal'}
        options={[
          { value: 'normal', label: t('settings:diagnostics.levelNormal') },
          { value: 'verbose', label: t('settings:diagnostics.levelVerbose') },
        ]}
        onValueChange={(value) => updateChatPreferences({ diagnosticsLevel: value === 'verbose' ? 'verbose' : 'normal' })}
        palette={palette}
        testID="settings-diagnostics-level"
      />
      <ListRow
        title={t('settings:diagnostics.storageTitle')}
        description={t('settings:diagnostics.storageValue', {
          size: formatBytes(snapshot.storage.bytes),
          files: snapshot.storage.files,
          days: snapshot.storage.retentionDays,
        })}
        right={() => <Badge variant="secondary"><Text>{formatBytes(snapshot.storage.bytes)}</Text></Badge>}
      />
      <ListRow
        title={t('settings:diagnostics.retentionTitle')}
        description={t('settings:diagnostics.retentionValue', { days: snapshot.storage.retentionDays, size: formatBytes(snapshot.storage.maxBytes) })}
      />

      {remote ? (
        <>
          <Text className={cn('text-foreground')} variant="title">{t('settings:diagnostics.remoteTitle')}</Text>
          <Text className="text-muted-foreground" variant="description">{t('settings:diagnostics.remoteDescription')}</Text>
          <SettingSwitchRow
            title={t('settings:diagnostics.remoteMasterTitle')}
            description={t('settings:diagnostics.remoteMasterDescription')}
            value={chatPreferences.remoteTelemetryEnabled !== false}
            palette={palette}
            onValueChange={(remoteTelemetryEnabled) => updateChatPreferences({
              remoteTelemetryEnabled,
              ...(remoteTelemetryEnabled ? {} : { remoteCrashReports: false, remotePerformance: false }),
            })}
          />
          <SettingSwitchRow
            title={t('settings:diagnostics.remoteCrashTitle')}
            description={t('settings:diagnostics.remoteCrashDescription')}
            value={chatPreferences.remoteTelemetryEnabled !== false && chatPreferences.remoteCrashReports !== false}
            disabled={chatPreferences.remoteTelemetryEnabled === false}
            palette={palette}
            onValueChange={(remoteCrashReports) => updateChatPreferences({ remoteCrashReports })}
          />
          <SettingSwitchRow
            title={t('settings:diagnostics.remotePerformanceTitle')}
            description={t('settings:diagnostics.remotePerformanceDescription')}
            value={chatPreferences.remoteTelemetryEnabled !== false && chatPreferences.remotePerformance !== false}
            disabled={chatPreferences.remoteTelemetryEnabled === false}
            palette={palette}
            onValueChange={(remotePerformance) => updateChatPreferences({ remotePerformance })}
          />
        </>
      ) : null}

      <Text className={cn('text-foreground')} variant="title">{t('settings:diagnostics.previewTitle')}</Text>
      <SettingSelectField
        compact
        label={t('settings:diagnostics.filterLabel')}
        valueLabel={severity === 'all' ? t('settings:diagnostics.filterAll') : severity === 'warn' ? t('settings:diagnostics.filterWarnings') : t('settings:diagnostics.filterErrors')}
        selectedValue={severity}
        options={[
          { value: 'all', label: t('settings:diagnostics.filterAll') },
          { value: 'warn', label: t('settings:diagnostics.filterWarnings') },
          { value: 'error', label: t('settings:diagnostics.filterErrors') },
        ]}
        onValueChange={setSeverity}
        palette={palette}
        testID="settings-diagnostics-filter"
      />
      {logs.length === 0 ? <Text className="text-muted-foreground" variant="description">{t('settings:diagnostics.previewEmpty')}</Text> : logs.map((entry) => (
        <View key={`${entry.ts}-${entry.name}`} className={cn(stylesClasses.logRow)}>
          <Badge variant="secondary"><Text>{entry.level ?? entry.kind}</Text></Badge>
          <Text className="flex-1 text-muted-foreground" variant="description" numberOfLines={2}>
            {entry.message ?? entry.name}
            {entry.attrs?.operation === 'voice.recognition' || entry.attrs?.operation === 'voice.enrollment'
              ? ` · ${entry.attrs.source} · ${entry.attrs.reason}` : ''}
          </Text>
        </View>
      ))}
      {histograms.length > 0 ? (
        <View className={cn(stylesClasses.metrics)}>
          {histograms.map((metric) => (
            <ListRow
              key={`${metric.name}-${metric.ts}`}
              title={metric.name}
              description={t('settings:diagnostics.metricValue', {
                value: metricValue(metric.name, metric.value ?? 0),
                count: Number(metric.attrs?.count) || 1,
              })}
            />
          ))}
        </View>
      ) : null}
      {snapshot.lastFailure ? (
        <ListRow
          title={t('settings:diagnostics.recentFailure')}
          description={snapshot.lastFailure.message ?? snapshot.lastFailure.name}
        />
      ) : null}

      <SettingSwitchRow
        title={t('settings:diagnostics.includeDetailsTitle')}
        description={t('settings:diagnostics.includeDetailsDescription')}
        value={includeDetails}
        palette={palette}
        onValueChange={setIncludeDetails}
      />
      <View className={cn(stylesClasses.actions)}>
        <Button testID="settings-diagnostics-export" disabled={Boolean(busy)} onPress={() => void exportReport()} variant="outline">
          <Text>{busy === 'export' ? t('settings:diagnostics.exporting') : t('settings:diagnostics.exportAction')}</Text>
        </Button>
        <Button testID="settings-diagnostics-clear" disabled={Boolean(busy)} onPress={clearHistory} variant="ghost">
          <Text>{busy === 'clear' ? t('settings:diagnostics.clearing') : t('settings:diagnostics.clearAction')}</Text>
        </Button>
      </View>
      {feedback ? <Text className="text-muted-foreground" variant="description" testID="settings-diagnostics-feedback">{feedback}</Text> : null}
      {confirmation}
    </View>
  );
}

const stylesClasses = {
  section: 'gap-3.5 pb-2',
  logRow: 'flex-row items-start gap-2',
  metrics: 'gap-1',
  actions: 'flex-row flex-wrap items-center gap-2',
} as const;
