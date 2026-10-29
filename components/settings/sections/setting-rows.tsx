import { useState, type ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, Switch as NativeSwitch, View } from 'react-native';
import { Button as PaperButton, Icon, Text } from 'react-native-paper';

import { NativeSelect, type NativeSelectOption } from '@/components/ui/native-select';
import { NumericSlider } from '@/components/ui/numeric-slider';
import { TextInput } from '@/components/ui/text-input';
import { ControlSize, Shape, Spacing } from '@/constants/design-tokens';
import { Colors } from '@/constants/theme';
import { withAlpha } from '@/lib/color';
import { SettingTarget } from '../settings-panel';

export type Palette = typeof Colors.light;

export function SettingSwitchRow({ description, disabled = false, onValueChange, palette, title, value }: {
  description: string;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  palette: Palette;
  title: string;
  value: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return <SettingTarget label={title}>
    <Pressable accessibilityRole="switch" accessibilityLabel={title} accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }} aria-checked={value} aria-disabled={disabled} disabled={disabled} onPress={() => onValueChange(!value)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.switchRow, { borderColor: focused ? palette.tint : 'transparent', backgroundColor: pressed ? palette.surfaceAlt : 'transparent', opacity: disabled ? 0.55 : 1 }]}>
      <View style={styles.textWrap}>
        <Text variant="bodyLarge" style={{ color: palette.text }}>{title}</Text>
        {description ? <Text variant="bodyMedium" style={{ color: palette.muted }}>{description}</Text> : null}
      </View>
      <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <NativeSwitch accessible={false} disabled={disabled} ios_backgroundColor={palette.border}
          thumbColor={Platform.OS === 'android' ? (value ? palette.tint : palette.surface) : undefined}
          trackColor={{ false: palette.border, true: withAlpha(palette.tint, 0x66 / 255) }} value={value} />
      </View>
    </Pressable>
  </SettingTarget>;
}

export function SettingSelectField<T extends string>({ disabled = false, label, onValueChange, options, palette, searchable = false, selectedValue, testID, valueLabel }: {
  disabled?: boolean;
  label: string;
  onValueChange: (value: T) => void;
  options: NativeSelectOption<T>[];
  palette: Palette;
  searchable?: boolean;
  selectedValue?: T;
  testID?: string;
  valueLabel: string;
}) {
  const [focused, setFocused] = useState(false);
  return <SettingTarget label={label}>
    <NativeSelect disabled={disabled} onValueChange={onValueChange} options={options} searchable={searchable}
      selectedValue={selectedValue} title={label}
      renderTrigger={({ disabled: triggerDisabled, open, openState }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${valueLabel}`}
          accessibilityState={{ disabled: triggerDisabled, expanded: openState }} aria-disabled={triggerDisabled} aria-expanded={openState} disabled={triggerDisabled} onPress={open} testID={testID}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={({ pressed }) => [styles.selectField, { backgroundColor: palette.background, borderColor: openState || focused ? palette.tint : palette.border, opacity: triggerDisabled ? 0.55 : pressed ? 0.82 : 1 }]}>
          <View style={styles.textWrap}>
            <Text variant="labelMedium" style={{ color: palette.muted }}>{label}</Text>
            <Text variant="bodyLarge" style={[styles.value, { color: palette.text }]}>{valueLabel}</Text>
          </View>
          <Icon source="chevron-down" size={24} color={palette.muted} />
        </Pressable>
      )} />
  </SettingTarget>;
}

export function SettingButton({ style, contentStyle, ...props }: ComponentProps<typeof PaperButton>) {
  return <PaperButton {...props} style={[{ borderRadius: Shape.control }, style]} contentStyle={[{ minHeight: ControlSize.target }, contentStyle]} />;
}

export function SettingTextInput(props: ComponentProps<typeof TextInput>) {
  return <SettingTarget label={typeof props.label === 'string' ? props.label : undefined}>
    <TextInput {...props} outlineStyle={[{ borderRadius: Shape.control }, props.outlineStyle]} />
  </SettingTarget>;
}

export function SettingSlider(props: ComponentProps<typeof NumericSlider>) {
  return <SettingTarget label={props.label}><NumericSlider {...props} /></SettingTarget>;
}

const styles = StyleSheet.create({
  switchRow: { minHeight: ControlSize.row, borderRadius: Shape.control, borderWidth: 1, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xs, flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  selectField: { minHeight: ControlSize.field, borderRadius: Shape.control, borderWidth: 1, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  textWrap: { flex: 1, minWidth: 0, gap: Spacing.xs },
  value: { fontWeight: '600' },
});
