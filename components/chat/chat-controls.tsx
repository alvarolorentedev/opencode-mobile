import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

export function ControlButton({
  active = false,
  accessibilityLabel,
  children,
  disabled = false,
  grow = false,
  icon,
  iconName,
  iconOnly = false,
  loading = false,
  maxWidth,
  onPress,
  slim = false,
  testID,
}: {
  active?: boolean;
  accessibilityLabel?: string;
  children: string;
  disabled?: boolean;
  grow?: boolean;
  icon?: (props: { size: number; color: string }) => ReactNode;
  iconName?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  iconOnly?: boolean;
  loading?: boolean;
  maxWidth?: number;
  onPress: () => void;
  slim?: boolean;
  testID?: string;
}) {
  const palette = usePalette();
  const textColor = active ? palette.tint : palette.text;
  const borderColor = active ? 'transparent' : palette.border;
  const backgroundColor = active ? `${palette.tint}18` : palette.surface;
  const iconSize = slim ? 14 : 16;
  const controlSize = slim ? 32 : 40;
  const innerHeight = slim ? 30 : 38;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || children}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.controlButton,
        grow && !iconOnly ? styles.controlButtonGrow : null,
        iconOnly ? styles.controlButtonIconOnly : styles.controlButtonText,
        slim && (iconOnly ? { width: controlSize, height: controlSize } : { minHeight: controlSize, paddingHorizontal: 8 }),
        !iconOnly && maxWidth ? { maxWidth } : null,
        { borderColor, backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
      ]}>
      <View style={[styles.controlButtonInner, iconOnly && styles.controlButtonInnerIconOnly, slim && { minHeight: innerHeight, gap: 6 }]}>
        {loading ? <ActivityIndicator size={iconSize} color={textColor} /> : null}
        {!loading && icon ? icon({ size: iconSize, color: textColor }) : null}
        {!loading && !icon && iconName ? <MaterialCommunityIcons name={iconName} size={iconSize} color={textColor} /> : null}
        {!iconOnly ? (
          <Text maxFontSizeMultiplier={1.5} numberOfLines={1} ellipsizeMode="tail" style={[styles.controlButtonLabel, slim && { fontSize: 13 }, { color: textColor }]}>
            {children}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  controlButton: {
    borderRadius: 999,
    borderWidth: 1,
  },
  controlButtonGrow: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  controlButtonIconOnly: {
    width: 40,
    height: 40,
  },
  controlButtonText: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  controlButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 38,
  },
  controlButtonInnerIconOnly: {
    gap: 0,
    minHeight: 40,
  },
  controlButtonLabel: {
    flexShrink: 1,
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
  },
});
