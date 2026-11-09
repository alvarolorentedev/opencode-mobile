import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';
import { BarChart } from 'react-native-chart-kit/v2';

import { MISSION_STATS_RANGES, type MissionStatsHours } from '@/features/sessions/model/mission-stats';
import { useChartSize } from '@/features/sessions/ui/use-chart-size';
import { useMissionChartTheme } from '@/features/sessions/ui/use-mission-chart-theme';
import { formatEstimatedCost, formatTokenCount } from '@/shared/presentation/usage';
import type { SessionStatsRange } from '@/shared/protocol/services/session-stats';
import type { SessionStatsSeries } from '@/shared/server-data/session-stats';
import { cn } from '@/shared/ui/cn';
import { Skeleton } from '@/shared/ui/skeleton';
import { Text } from '@/shared/ui/text';

const METRICS = ['tokens', 'cost'] as const;
const SKELETON_BARS = [44, 72, 56, 88, 64, 48, 76];

export function MissionActivityChart({ hours, onRangeChange, buckets, series, checked, total, loading }: {
  hours: MissionStatsHours;
  onRangeChange: (hours: MissionStatsHours) => void;
  buckets: SessionStatsRange[];
  series?: SessionStatsSeries;
  checked: number;
  total: number;
  loading: boolean;
}) {
  const { t, i18n } = useTranslation('chat');
  const locale = i18n.resolvedLanguage || i18n.language;
  const [metric, setMetric] = useState<typeof METRICS[number]>('tokens');
  const theme = useMissionChartTheme();
  const { width, height, onLayout } = useChartSize();
  const rangeLabel = (value: number) => value <= 24 ? `${value}h` : `${value / 24}d`;
  const shown = series && !loading ? series : undefined;
  const ready = Boolean(shown);
  const tickLabel = (from: number) => {
    const options: Intl.DateTimeFormatOptions = hours <= 24
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric' };
    try {
      return new Intl.DateTimeFormat(locale, options).format(from);
    } catch {
      return hours <= 24 ? new Date(from).toLocaleTimeString() : new Date(from).toLocaleDateString();
    }
  };
  const format = (value: number, detailed = false) => {
    if (metric === 'cost') return formatEstimatedCost(value, 'USD', locale);
    if (detailed) {
      try {
        return new Intl.NumberFormat(locale).format(value);
      } catch {
        return String(value);
      }
    }
    return formatTokenCount(value, locale);
  };
  const choice = (selected: boolean) => cn('min-h-target flex-1 min-w-0 items-center justify-center rounded-control px-1 py-1', selected && 'bg-primary');
  const label = (selected: boolean) => selected ? 'text-center text-primary-foreground' : 'text-center text-muted-foreground';
  const selection = (selected: boolean) => ({ accessibilityState: { selected },
    ...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {}) });
  const data = buckets.map(({ from }, index) => ({ label: tickLabel(from), value: shown?.buckets[index]?.[metric] ?? 0 }));
  const summary = shown ? `${format(shown.total[metric], true)} ${t(`mission.metricTotal.${metric}`)}` : undefined;

  return <View className="flex-1 min-h-[300px] gap-2 rounded-control border border-border bg-card p-3" testID="mission-activity-chart">
    <View className="flex-row rounded-control border border-border p-0.5">
      {METRICS.map((key) => <Pressable key={key} className={choice(key === metric)}
        accessibilityRole="button" {...selection(key === metric)} onPress={() => setMetric(key)}>
        <Text variant="label" className={label(key === metric)}>{t(`mission.metric.${key}`)}</Text>
      </Pressable>)}
    </View>
    <View accessible={ready || loading} className="flex-row items-baseline gap-2"
      accessibilityLabel={loading ? t('mission.checking') : summary}
      accessibilityLiveRegion={loading ? 'polite' : undefined}>
      {shown ? <Text variant="display" className="text-primary" testID="mission-activity-total">{format(shown.total[metric])}</Text>
        : loading ? <Skeleton className="h-8 w-28" /> : <Text variant="display" className="text-muted-foreground">—</Text>}
      <Text variant="description" className="text-muted-foreground">{t(`mission.metricTotal.${metric}`)}</Text>
    </View>
    <View className="flex-1 min-h-[140px]" onLayout={onLayout}>
      {ready && width > 0 && height > 0 ? <BarChart
        data={data}
        xKey="label"
        yKey="value"
        width={width}
        height={height}
        theme={theme}
        barRadius={6}
        barWidthRatio={0.6}
        showHorizontalGridLines
        yTickCount={3}
        labelStrategy="auto"
        interaction="tap"
        tooltip
        formatYLabel={format}
        accessibilityLabel={summary}
        testID="mission-activity-bar-chart"
      /> : loading || width === 0 || height === 0 ? <View testID="mission-activity-loading" className="h-full flex-row items-end gap-2 px-3 pb-7"
        importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {buckets.map(({ from }, index) => <Skeleton key={from} className="flex-1 rounded-t-md"
          style={{ height: `${SKELETON_BARS[index % SKELETON_BARS.length]}%` }} />)}
      </View> : <View className="h-full items-center justify-center px-2" accessibilityLiveRegion="polite">
        <Text variant="description" className="text-muted-foreground">{t('mission.activityUnavailable')}</Text>
      </View>}
    </View>
    <View className="flex-row flex-wrap rounded-control border border-border p-0.5">
      {MISSION_STATS_RANGES.map(({ hours: value }) => <Pressable key={value} className={choice(value === hours)}
        accessibilityRole="button" accessibilityLabel={rangeLabel(value)}
        {...selection(value === hours)} onPress={() => onRangeChange(value)}>
        <Text variant="description" className={label(value === hours)}>{rangeLabel(value)}</Text>
      </Pressable>)}
    </View>
    <View className="min-h-5">
      {ready && metric === 'cost' ? <Text variant="description" className="text-muted-foreground">{t('mission.recordedCostNote')}</Text> : null}
    </View>
    {ready && checked < total ? <Text variant="description" className="text-warning" accessibilityLiveRegion="polite">
      {t('mission.activityPartial')}
    </Text> : null}
  </View>;
}
