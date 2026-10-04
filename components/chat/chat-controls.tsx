import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { NativeSelect, type NativeSelectOption } from '@/components/ui/native-select';
import { Fonts } from '@/constants/theme';
import { useAppTheme } from '@/providers/theme-provider';
export function SelectControl<T extends string>({
  disabled = false,
  grow = false,
  icon,
  iconName,
  label,
  maxWidth,
  onValueChange,
  options,
  selectedValue,
  slim = false,
  title,
}: {
  disabled?: boolean;
  grow?: boolean;
  icon?: (props: { size: number; color: string }) => ReactNode;
  iconName?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  maxWidth?: number;
  onValueChange: (value: T) => void;
  options: NativeSelectOption<T>[];
  selectedValue?: T;
  slim?: boolean;
  title?: string;
}) {
  return (
    <NativeSelect
      disabled={disabled}
      onValueChange={onValueChange}
      options={options}
      selectedValue={selectedValue}
      title={title}
      renderTrigger={({ disabled: triggerDisabled, open, openState }) => (
        <ControlButton
          accessibilityLabel={`${title || label}: ${label}`}
          active={openState}
          disabled={triggerDisabled}
          grow={grow}
          icon={icon}
          iconName={iconName}
          maxWidth={maxWidth}
          onPress={open}
          slim={slim}>
          {label}
        </ControlButton>
      )}
    />
  );
}

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
  const { palette } = useAppTheme();
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

export function TopTab({ active, label, onPress, slim = false }: { active: boolean; label: string; onPress: () => void; slim?: boolean }) {
  const { palette } = useAppTheme();

  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} aria-selected={active} style={styles.topTab} onPress={onPress}>
      <View style={[styles.topTabInner, active && { borderBottomColor: palette.tint, borderBottomWidth: 2 }, slim && { paddingVertical: 8 }]}>
        <Text maxFontSizeMultiplier={1.5} style={[styles.topTabLabel, slim && { fontSize: 14 }, { color: active ? palette.text : palette.muted, fontWeight: active ? '700' : '500' }]}>
          {label}
        </Text>
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
  topTab: { flex: 1 },
  topTabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  topTabLabel: {
    fontFamily: Fonts.sans,
    fontSize: 16,
  },
});
