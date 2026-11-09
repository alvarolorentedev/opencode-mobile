import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useChartSize } from '@/features/sessions/ui/use-chart-size';
import type { SessionStatsActivityDay } from '@/shared/protocol/services/session-stats';
import { Skeleton } from '@/shared/ui/skeleton';
import { Text } from '@/shared/ui/text';
import { withAlpha } from '@/shared/ui/theme/color';
import { usePalette } from '@/shared/ui/theme/use-palette';

const DAYS = 30;
const COLUMNS = 10;
const GAP = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export function MissionContributionChart({ days, endDate, loading, unavailable, partial }: {
  days: SessionStatsActivityDay[];
  endDate: number;
  loading: boolean;
  unavailable: boolean;
  partial: boolean;
}) {
  const { t, i18n } = useTranslation('chat');
  const locale = i18n.resolvedLanguage || i18n.language;
  const palette = usePalette();
  const { width, onLayout } = useChartSize();
  const cells = useMemo(() => {
    const byDate = new Map(days.map(({ date, steps }) => [date, steps]));
    const anchor = new Date(endDate);
    anchor.setHours(12, 0, 0, 0);
    return Array.from({ length: DAYS }, (_, index) => {
      const date = new Date(anchor.getTime() - (DAYS - 1 - index) * DAY_MS);
      const key = localDateKey(date);
      return { date, key, steps: byDate.get(key) ?? 0 };
    });
  }, [days, endDate]);
  const activeDays = cells.filter(({ steps }) => steps > 0).length;
  const steps = cells.reduce((total, day) => total + day.steps, 0);
  const peak = Math.max(1, ...cells.map((day) => day.steps));
  const size = width > 0 ? Math.max(1, Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS)) : 0;
  const total = (value: number) => {
    try {
      return new Intl.NumberFormat(locale).format(value);
    } catch {
      return String(value);
    }
  };
  const fill = (value: number) => {
    if (value <= 0) return palette.surfaceAlt;
    const level = value / peak;
    if (level <= 0.34) return withAlpha(palette.tint, 0x40 / 255);
    if (level <= 0.67) return withAlpha(palette.tint, 0x80 / 255);
    return palette.tint;
  };
  const ready = !loading && !unavailable && size > 0;

  return <View className="gap-2 rounded-control border border-border bg-card p-3" testID="mission-contributions">
    <View className="flex-row items-center justify-between gap-2">
      <Text variant="label" className="font-semibold text-foreground">{t('mission.contributions')}</Text>
      <Text variant="label" className="text-muted-foreground">{t('mission.contributionsCaption')}</Text>
    </View>
    <View onLayout={onLayout}>
      {ready ? <View
        className="flex-row flex-wrap"
        style={{ gap: GAP }}
        accessible
        accessibilityLabel={t('mission.contributionsSummary', { steps: total(steps), days: total(activeDays) })}
        testID="mission-contributions-chart"
      >
        {cells.map(({ key, steps: value }) => <View key={key} className="rounded-[4px]"
          accessible={false}
          style={{ width: size, height: size, backgroundColor: fill(value) }}
          testID={`mission-contribution-day-${key}`} />)}
      </View> : loading || size === 0 ? <Skeleton testID="mission-contributions-loading" className="h-[100px] w-full" />
        : <View className="h-[100px] items-center justify-center px-2" accessibilityLiveRegion="polite">
          <Text variant="description" className="text-muted-foreground">{t('mission.activityUnavailable')}</Text>
        </View>}
    </View>
    {ready && partial ? <Text variant="description" className="text-warning" accessibilityLiveRegion="polite">
      {t('mission.activityPartial')}
    </Text> : null}
  </View>;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
