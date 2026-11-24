import type { ComponentProps, ReactNode } from 'react';
import { View, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/shared/ui/text';
import { Fonts } from '@/shared/ui/theme/theme';

// Compact app-bar height. minHeight lets large text grow the header instead of clipping it.
export const SCREEN_HEADER_HEIGHT = 52;

export const APP_HEADER_TITLE_STYLE = {
  fontFamily: Fonts.display,
  fontSize: 16,
  fontWeight: '700',
  lineHeight: 24,
} as const;

export function ScreenHeader({ safeArea = true, style, ...props }: ComponentProps<typeof View> & { safeArea?: boolean }) {
  const insets = useSafeAreaInsets();
  return <View {...props} className="flex-row items-center bg-surface px-1" style={[{ minHeight: SCREEN_HEADER_HEIGHT + (safeArea ? insets.top : 0) }, safeArea && { paddingTop: insets.top }, style]} />;
}

export function HeaderTitle({ title, subtitle, textStyle, maxFontSizeMultiplier = 1.5 }: {
  title: ReactNode; subtitle?: ReactNode; textStyle?: StyleProp<TextStyle>; maxFontSizeMultiplier?: number;
}) {
  return <View className="flex-1 min-w-0 px-3">
    <Text variant="heading" maxFontSizeMultiplier={maxFontSizeMultiplier} style={textStyle}>{title}</Text>
    {subtitle ? <Text variant="description" className="text-muted-foreground">{subtitle}</Text> : null}
  </View>;
}
