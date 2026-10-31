import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { OverlaySheet } from './overlay-sheet';
import { Input } from './input';
import { Text } from './text';
import { Icon } from './icon';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from './select';
import { useDismissKeyboardOnOpen } from '@/hooks/use-dismiss-keyboard-on-open';
import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { usePalette } from '@/hooks/use-palette';

export type CatalogOption<T extends string = string> = {
  value: T; label: string; description?: string;
  leadingIcon?: (props: { size: number; color: string; selected: boolean }) => ReactNode;
};

export function CatalogSelect<T extends string>({ disabled = false, onValueChange, options, renderTrigger, searchable = false, selectedValue, title }: {
  disabled?: boolean; onValueChange: (value: T) => void; options: CatalogOption<T>[];
  selectedValue?: T; title?: string; searchable?: boolean;
  renderTrigger: (props: { disabled: boolean; open: () => void; openState: boolean; selectedOption?: CatalogOption<T> }) => ReactNode;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.value === selectedValue);
  const blocked = disabled || options.length === 0;
  useUpdateBlocker(open);
  useDismissKeyboardOnOpen(open);
  const filtered = useMemo(() => options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [options, query]);
  function changeOpen(value: boolean) { setOpen(value); if (!value) setQuery(''); }
  function choose(value: T) { changeOpen(false); onValueChange(value); }
  const trigger = renderTrigger({ disabled: blocked, open: () => { if (!blocked) changeOpen(true); }, openState: open, selectedOption: selected });
  if (!searchable) return <Select onOpenChange={changeOpen} value={selected} onValueChange={(option) => { if (option) choose(option.value as T); }}>
    <SelectTrigger asChild disabled={blocked}>{trigger}</SelectTrigger>
    <SelectContent><SelectGroup>{options.map((option) => <SelectItem key={option.value} value={option.value} label={option.label} accessibilityLabel={option.label} description={option.description} leadingIcon={option.leadingIcon?.({ size: 18, color: palette.tint, selected: option.value === selectedValue })} />)}</SelectGroup></SelectContent>
  </Select>;
  return <>{trigger}<OverlaySheet visible={open} title={title || t('common:select.chooseOption')} onClose={() => changeOpen(false)} fitContent>
    <Input value={query} onChangeText={setQuery} accessibilityLabel={title || t('common:select.chooseOption')} placeholder={title} autoCapitalize="none" autoCorrect={false} />
    {filtered.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
      accessibilityState={{ checked: option.value === selectedValue }} className="min-h-field flex-row items-center gap-3 rounded-control p-3 active:bg-accent" onPress={() => choose(option.value)}>
      {option.leadingIcon?.({ size: 18, color: palette.tint, selected: option.value === selectedValue })}
      <View className="flex-1 min-w-0"><Text>{option.label}</Text>{option.description ? <Text variant="description" className="text-muted-foreground">{option.description}</Text> : null}</View>
      {option.value === selectedValue ? <Icon name="check" /> : null}
    </Pressable>)}
  </OverlaySheet></>;
}
