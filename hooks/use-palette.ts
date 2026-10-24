import { useMemo } from 'react';

import { getColors, type Palette } from '@/constants/theme';
import { useAppearance } from '@/providers/appearance-context';

export function usePalette(): Palette {
  const { scheme, accent } = useAppearance();
  return useMemo(() => getColors(scheme, accent), [scheme, accent]);
}
