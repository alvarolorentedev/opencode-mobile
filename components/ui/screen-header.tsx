import type { ComponentProps, ReactNode } from 'react';
import { View, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './text';

export function ScreenHeader({ safeArea = true, style, ...props }: ComponentProps<typeof View> & { safeArea?: boolean }) {
  const insets = useSafeAreaInsets();
  return <View {...props} className="min-h-16 flex-row items-center bg-surface px-1" style={[safeArea && { paddingTop: insets.top }, style]} />;
}

export function HeaderTitle({ title, subtitle, textStyle, maxFontSizeMultiplier = 1.5 }: {
  title: ReactNode; subtitle?: ReactNode; textStyle?: StyleProp<TextStyle>; maxFontSizeMultiplier?: number;
}) {
  return <View className="flex-1 min-w-0 px-3">
    <Text variant="heading" maxFontSizeMultiplier={maxFontSizeMultiplier} style={textStyle}>{title}</Text>
    {subtitle ? <Text variant="description" className="text-muted-foreground">{subtitle}</Text> : null}
  </View>;
}
