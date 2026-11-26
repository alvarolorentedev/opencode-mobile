import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/shared/ui/theme/design-tokens';

/**
 * Width for a floating panel rendered in a native portal.
 *
 * A percentage width (`w-full`, `width: '100%'`) inside the portal overlay
 * collapses to the panel padding on some Android devices, so native panels take
 * an explicit width from the window instead. Pass `maxWidth` for panels that
 * need a cap; popovers use the available width.
 */
export function useOverlayWidth(maxWidth = Infinity) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return Math.min(width - insets.left - insets.right - Spacing.lg, maxWidth);
}
