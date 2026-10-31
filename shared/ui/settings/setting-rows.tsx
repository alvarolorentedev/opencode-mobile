import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { CatalogSelect, type CatalogOption } from '@/shared/ui/catalog-select';
import { NumericSlider } from '@/shared/ui/numeric-slider';
import { TextField } from '@/shared/ui/text-field';
import { Switch } from '@/shared/ui/switch';
import { Text } from '@/shared/ui/text';
import { Icon } from '@/shared/ui/icon';
import type { Palette } from '@/shared/ui/theme/theme';
import { cn } from '@/shared/ui/cn';
import { SettingTarget } from '@/shared/ui/settings/settings-panel';
export type { Palette } from '@/shared/ui/theme/theme';

export function SettingSwitchRow({ description, disabled = false, onValueChange, title, value }: {
  description: string; disabled?: boolean; onValueChange: (value: boolean) => void; palette: Palette; title: string; value: boolean;
}) {
  return <SettingTarget label={title}>
    <Pressable accessibilityRole="switch" accessibilityLabel={title} accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }} aria-checked={value} disabled={disabled} onPress={() => onValueChange(!value)}
      className={cn('min-h-row flex-row items-center gap-4 rounded-control py-3 px-1 active:bg-accent web:focus-visible:outline-2 web:focus-visible:outline-ring', disabled && 'opacity-55')}>
      <View className="flex-1 min-w-0 gap-1"><Text>{title}</Text>{description ? <Text variant="description" className="text-muted-foreground">{description}</Text> : null}</View>
      <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch onCheckedChange={() => {}} accessible={false} disabled={disabled} checked={value} />
      </View>
    </Pressable>
  </SettingTarget>;
}

export function SettingSelectField<T extends string>({ compact = false, disabled = false, label, onValueChange, options, searchable = false, selectedValue, testID, valueLabel }: {
  compact?: boolean; disabled?: boolean; label: string; onValueChange: (value: T) => void; options: CatalogOption<T>[]; palette: Palette;
  searchable?: boolean; selectedValue?: T; testID?: string; valueLabel: string;
}) {
  return <SettingTarget label={label}>
    <CatalogSelect disabled={disabled} onValueChange={onValueChange} options={options} searchable={searchable} selectedValue={selectedValue} title={label}
      renderTrigger={({ disabled: blocked, open, openState }) => <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${valueLabel}`}
        accessibilityState={{ disabled: blocked, expanded: openState }} disabled={blocked} onPress={open} testID={testID}
        className={cn('min-h-field flex-row items-center gap-3 rounded-control border border-input bg-background p-3 active:bg-accent web:focus-visible:outline-2 web:focus-visible:outline-ring', blocked && 'opacity-55')}>
        <View className={cn('flex-1 min-w-0 gap-1', compact && 'flex-row items-center justify-between gap-3')}>
          <Text variant="label" className={cn('text-muted-foreground', compact && 'shrink max-w-[40%]')}>{label}</Text>
          <Text className={cn('font-semibold', compact && 'flex-1 text-right')}>{valueLabel}</Text>
        </View><Icon name="chevron-down" size={24} />
      </Pressable>} />
  </SettingTarget>;
}

export function SettingField(props: ComponentProps<typeof TextField>) {
  return <SettingTarget label={props.label}><TextField {...props} /></SettingTarget>;
}
export function SettingSlider(props: ComponentProps<typeof NumericSlider>) {
  return <SettingTarget label={props.label}><NumericSlider {...props} /></SettingTarget>;
}
