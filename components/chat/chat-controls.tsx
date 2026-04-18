import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { NativeSelect, type NativeSelectOption } from '@/components/ui/native-select';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function SelectControl<T extends string>({
  disabled = false,
  icon,
  iconName,
  label,
  maxWidth,
  onValueChange,
  options,
  selectedValue,
  title,
}: {
  disabled?: boolean;
  icon?: (props: { size: number; color: string }) => ReactNode;
  iconName?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  maxWidth?: number;
  onValueChange: (value: T) => void;
  options: NativeSelectOption<T>[];
  selectedValue?: T;
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
          active={openState}
          disabled={triggerDisabled}
          icon={icon}
          iconName={iconName}
          maxWidth={maxWidth}
          onPress={open}>
          {label}
        </ControlButton>
      )}
    />
  );
}

export function ControlButton({
  active = false,
  children,
  disabled = false,
  icon,
  iconName,
  iconOnly = false,
  loading = false,
  maxWidth,
  onPress,
}: {
  active?: boolean;
  children: string;
  disabled?: boolean;
  icon?: (props: { size: number; color: string }) => ReactNode;
  iconName?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  iconOnly?: boolean;
  loading?: boolean;
  maxWidth?: number;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const textColor = active ? palette.tint : palette.text;
  const borderColor = active ? 'transparent' : palette.border;
  const backgroundColor = active ? `${palette.tint}18` : palette.surface;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlButton,
        iconOnly ? styles.controlButtonIconOnly : styles.controlButtonText,
        !iconOnly && maxWidth ? { maxWidth } : null,
        { borderColor, backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
      ]}>
      <View style={[styles.controlButtonInner, iconOnly && styles.controlButtonInnerIconOnly]}>
        {loading ? <ActivityIndicator size={16} color={textColor} /> : null}
        {!loading && icon ? icon({ size: 16, color: textColor }) : null}
        {!loading && !icon && iconName ? <MaterialCommunityIcons name={iconName} size={16} color={textColor} /> : null}
        {!iconOnly ? (
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.controlButtonLabel, { color: textColor }]}>
            {children}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function TopTab({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Pressable accessibilityRole="tab" style={styles.topTab} onPress={onPress}>
      <View style={[styles.topTabInner, active && { borderBottomColor: palette.tint, borderBottomWidth: 2 }]}> 
        <Text style={[styles.topTabLabel, { color: active ? palette.text : palette.muted, fontWeight: active ? '700' : '500' }]}> 
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
  controlButtonIconOnly: {
    width: 40,
    height: 40,
  },
  controlButtonText: {
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
