import { useMemo } from 'react';
import type { CartesianChartTheme } from 'react-native-chart-kit/v2';

import { usePalette } from '@/shared/ui/theme/use-palette';

export function useMissionChartTheme(): CartesianChartTheme {
  const palette = usePalette();
  return useMemo(() => ({
    background: 'transparent',
    plotBackground: 'transparent',
    grid: palette.border,
    axis: palette.border,
    text: palette.text,
    mutedText: palette.muted,
    series: [palette.tint],
    typography: { axisLabelSize: 11, legendLabelSize: 11 },
    tooltip: {
      background: palette.surfaceAlt,
      border: palette.border,
      text: palette.text,
      mutedText: palette.muted,
    },
  }), [palette]);
}
