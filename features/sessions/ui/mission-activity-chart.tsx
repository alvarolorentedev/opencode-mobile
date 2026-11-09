import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { MISSION_STATS_RANGES, type MissionStatsHours } from '@/features/sessions/model/mission-stats';
import { formatMessageTime, formatTimestamp } from '@/shared/presentation/format';
import { formatEstimatedCost, formatTokenCount } from '@/shared/presentation/usage';
import type { SessionStats, SessionStatsRange } from '@/shared/protocol/services/session-stats';
import type { SessionStatsSeries } from '@/shared/server-data/session-stats';
import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';

const METRICS = ['conversations', 'tokens', 'cost'] as const satisfies readonly (keyof SessionStats)[];

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
  const rangeLabel = (value: number, width: 'long' | 'narrow') => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'unit', unit: value <= 24 ? 'hour' : 'day', unitDisplay: width,
      }).format(value <= 24 ? value : value / 24);
    } catch {
      return value <= 24 ? `${value}h` : `${value / 24}d`;
    }
  };
  const end = buckets.at(-1)?.to ?? 0;
  const axisLabel = (value: number) => {
    try {
      const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
      if (value === 0) return relative.format(0, 'second');
      return value < 1 ? relative.format(-value * 60, 'minute')
        : relative.format(value <= 24 ? -value : -value / 24, value <= 24 ? 'hour' : 'day');
    } catch {
      return formatMessageTime(end - value * 3_600_000);
    }
  };
  const values = series?.buckets.map((bucket) => bucket[metric]) ?? [];
  const peak = Math.max(0, ...values);
  const step = peak ? 10 ** Math.floor(Math.log10(peak)) : 1;
  const ceiling = 2 * step * Math.ceil(peak / (2 * step)) || 2;
  const format = (value: number, detailed = false) => {
    if (metric === 'cost') return formatEstimatedCost(value, 'USD', locale);
    try {
      return new Intl.NumberFormat(locale, detailed ? undefined : { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    } catch {
      return detailed ? String(value) : formatTokenCount(value);
    }
  };
  const choice = (selected: boolean) => cn('min-h-target flex-1 min-w-0 items-center justify-center rounded-control px-1 py-1', selected && 'bg-primary');
  const label = (selected: boolean) => selected ? 'text-center text-primary-foreground' : 'text-center text-muted-foreground';
  const selection = (selected: boolean) => ({ accessibilityState: { selected },
    ...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {}) });

  return <View className="gap-3 rounded-control border border-border bg-card p-3" testID="mission-activity-chart">
    <Text variant="heading" accessibilityRole="header">{t('mission.activity')}</Text>
    <View className="flex-row rounded-control border border-border p-0.5">
      {METRICS.map((key) => <Pressable key={key} className={choice(key === metric)}
        accessibilityRole="button" {...selection(key === metric)} onPress={() => setMetric(key)}>
        <Text variant="label" className={label(key === metric)}>{t(`mission.metric.${key}`)}</Text>
      </Pressable>)}
    </View>
    {series ? <>
      <View accessible accessibilityLabel={`${format(series.total[metric], true)} ${t(`mission.metricTotal.${metric}`)}`}>
        <Text variant="display" className="text-primary" testID="mission-activity-total">{format(series.total[metric])}</Text>
        <Text variant="description" className="text-muted-foreground">{t(`mission.metricTotal.${metric}`)}</Text>
      </View>
      <View className="gap-1">
        <View className="flex-row gap-2">
          <View className="items-end justify-between" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {[ceiling, ceiling / 2, 0].map((value) => <Text key={value} variant="description" className="text-muted-foreground">{format(value)}</Text>)}
          </View>
          <View className="relative h-36 flex-1">
            <View className="absolute inset-0 justify-between py-2" pointerEvents="none">
              {[0, 1, 2].map((line) => <View key={line} className="border-t border-border" />)}
            </View>
            <View className="flex-1 flex-row gap-2 px-2 py-2">
              {buckets.map(({ from, to }, index) => <View key={from} className="flex-1 justify-end" accessible accessibilityRole="text"
                accessibilityLabel={t('mission.chartPoint', { from: formatTimestamp(from, locale), to: formatTimestamp(to, locale), value: format(values[index], true) })}>
                <View className="rounded-t-sm bg-primary" style={{ height: `${100 * values[index] / ceiling}%` }} />
              </View>)}
            </View>
          </View>
        </View>
        <View className="flex-row justify-between gap-1" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {[hours, hours / 2, 0].map((offset) => <Text key={offset} variant="description" className="text-muted-foreground">{axisLabel(offset)}</Text>)}
        </View>
      </View>
    </> : <View className="min-h-[120px] justify-center" accessibilityLiveRegion="polite">
      <Text variant="description" className="text-muted-foreground">{t(loading ? 'mission.checking' : 'mission.activityUnavailable')}</Text>
    </View>}
    <View className="flex-row flex-wrap rounded-control border border-border p-0.5">
      {MISSION_STATS_RANGES.map(({ hours: value }) => <Pressable key={value} className={choice(value === hours)}
        style={{ flexBasis: 39 }} accessibilityRole="button" accessibilityLabel={rangeLabel(value, 'long')}
        {...selection(value === hours)} onPress={() => onRangeChange(value)}>
        <Text variant="description" className={label(value === hours)}>{rangeLabel(value, 'narrow')}</Text>
      </Pressable>)}
    </View>
    {total > 0 ? <Text variant="description" className="text-muted-foreground" accessibilityLiveRegion="polite">
      {t('mission.usageCoverage', { checked, total })}
    </Text> : null}
    {metric === 'cost' && series ? <Text variant="description" className="text-muted-foreground">{t('mission.recordedCostNote')}</Text> : null}
  </View>;
}
