import { Platform, Pressable, StyleSheet, Switch as NativeSwitch, Text as NativeText, View } from 'react-native';
import { List } from 'react-native-paper';

import { NativeSelect, type NativeSelectOption } from '@/components/ui/native-select';
import { Colors, Fonts } from '@/constants/theme';

export type Palette = typeof Colors.light;

export function SettingSwitchRow({
  description,
  onValueChange,
  palette,
  title,
  value,
}: {
  description: string;
  onValueChange: (value: boolean) => void;
  palette: Palette;
  title: string;
  value: boolean;
}) {
  return (
    <List.Item
      accessible={false}
      title={title}
      description={description}
      titleStyle={{ color: palette.text }}
      descriptionStyle={{ color: palette.muted }}
      right={() => (
        <NativeSwitch
          accessibilityLabel={title}
          accessibilityHint={description}
          ios_backgroundColor={palette.border}
          onValueChange={onValueChange}
          thumbColor={Platform.OS === 'android' ? (value ? palette.tint : '#f4f3f4') : undefined}
          trackColor={{ false: palette.border, true: `${palette.tint}66` }}
          value={value}
        />
      )}
    />
  );
}

export function SettingSelectField<T extends string>({
  disabled = false,
  label,
  onValueChange,
  options,
  palette,
  selectedValue,
  testID,
  valueLabel,
}: {
  disabled?: boolean;
  label: string;
  onValueChange: (value: T) => void;
  options: NativeSelectOption<T>[];
  palette: Palette;
  selectedValue?: T;
  testID?: string;
  valueLabel: string;
}) {
  return (
    <NativeSelect
      disabled={disabled}
      onValueChange={onValueChange}
      options={options}
      selectedValue={selectedValue}
      title={label}
      renderTrigger={({ disabled: triggerDisabled, open, openState }) => (
        <Pressable
          accessibilityRole="button"
          disabled={triggerDisabled}
          onPress={open}
          testID={testID}
          style={({ pressed }) => [
            styles.settingSelectField,
            {
              backgroundColor: palette.background,
              borderColor: openState ? palette.tint : palette.border,
              opacity: triggerDisabled ? 0.45 : pressed ? 0.82 : 1,
            },
          ]}>
          <View style={styles.settingSelectFieldContent}>
            <View style={styles.settingSelectTextWrap}>
              <NativeText style={[styles.settingSelectLabel, { color: palette.muted }]}>{label}</NativeText>
              <NativeText numberOfLines={1} style={[styles.settingSelectValue, { color: palette.text }]}>
                {valueLabel}
              </NativeText>
            </View>
            <NativeText style={[styles.settingSelectChevron, { color: palette.muted }]}>v</NativeText>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  settingSelectField: { borderRadius: 14, borderWidth: 1 },
  settingSelectFieldContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 54, paddingHorizontal: 14, paddingVertical: 10 },
  settingSelectTextWrap: { flex: 1, gap: 2 },
  settingSelectLabel: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
  settingSelectValue: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '600' },
  settingSelectChevron: { fontFamily: Fonts.mono, fontSize: 16, fontWeight: '700' },
});
