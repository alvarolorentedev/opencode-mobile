import type { Palette } from '@/shared/ui/theme/theme';
import { useAppearance } from '@/shared/ui/theme/appearance-context';

export function usePalette(): Palette {
  return useAppearance().palette;
}
