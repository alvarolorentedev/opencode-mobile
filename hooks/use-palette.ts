import type { Palette } from '@/constants/theme';
import { useAppearance } from '@/providers/appearance-context';

export function usePalette(): Palette {
  return useAppearance().palette;
}
