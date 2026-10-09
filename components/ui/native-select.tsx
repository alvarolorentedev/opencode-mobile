import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionSheetIOS,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { TextInput } from '@/components/ui/text-input';

export type NativeSelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  leadingIcon?: (props: { size: number; color: string; selected: boolean }) => ReactNode;
};

type NativeSelectProps<T extends string> = {
  disabled?: boolean;
  onValueChange: (value: T) => void;
  options: NativeSelectOption<T>[];
  renderTrigger: (props: {
    disabled: boolean;
    open: () => void;
    openState: boolean;
    selectedOption?: NativeSelectOption<T>;
  }) => ReactNode;
  searchable?: boolean;
  selectedValue?: T;
  title?: string;
};

export function NativeSelect<T extends string>({
  disabled = false,
  onValueChange,
  options,
  renderTrigger,
  searchable = false,
  selectedValue,
  title,
}: NativeSelectProps<T>) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  useUpdateBlocker(visible);
  const keyboardHeight = useKeyboardHeight(visible && searchable);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === selectedValue),
    [options, selectedValue],
  );
  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  }, [options, query]);

  const close = useCallback(() => {
    setVisible(false);
    setQuery('');
  }, []);

  const handleSelect = useCallback(
    (value: T) => {
      setVisible(false);
      setQuery('');
      onValueChange(value);
    },
    [onValueChange],
  );

  const open = useCallback(() => {
    if (disabled || options.length === 0) {
      return;
    }

    if (Platform.OS === 'ios' && !searchable) {
      setVisible(true);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: options.length,
          options: [...options.map((option) => option.label), t('common:actions.cancel')],
          title,
          userInterfaceStyle: colorScheme,
        },
        (buttonIndex) => {
          setVisible(false);
          if (buttonIndex >= 0 && buttonIndex < options.length) {
            onValueChange(options[buttonIndex].value);
          }
        },
      );
      return;
    }

    setVisible(true);
  }, [colorScheme, disabled, onValueChange, options, searchable, t, title]);

  return (
    <>
      {renderTrigger({
        disabled: disabled || options.length === 0,
        open,
        openState: visible,
        selectedOption,
      })}
      {Platform.OS === 'ios' && !searchable ? null : (
        <Modal animationType="fade" transparent visible={visible} onRequestClose={close}>
          <View style={[styles.overlay, { paddingBottom: keyboardHeight }]}>
            <Pressable style={styles.backdrop} onPress={close} />
            <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
              <View style={[styles.sheetHeader, { borderBottomColor: palette.border }]}> 
                <Text numberOfLines={1} style={[styles.sheetTitle, { color: palette.text }]}>
                  {title || t('common:select.chooseOption')}
                </Text>
                <Pressable onPress={close} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                  <Text style={[styles.closeButtonLabel, { color: palette.tint }]}>{t('common:actions.close')}</Text>
                </Pressable>
              </View>
              {searchable ? (
                <View style={styles.searchWrap}>
                  <TextInput
                    mode="outlined"
                    dense
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={query}
                    onChangeText={setQuery}
                    placeholder={title}
                  />
                </View>
              ) : null}
              <ScrollView style={styles.optionScroll} contentContainerStyle={styles.optionList} keyboardShouldPersistTaps="handled">
                {visibleOptions.map((option) => {
                  const selected = option.value === selectedValue;
                  const color = selected ? palette.tint : palette.muted;

                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      onPress={() => handleSelect(option.value)}
                      style={({ pressed }) => [
                        styles.option,
                        {
                          backgroundColor: selected ? palette.background : palette.surface,
                          borderColor: selected ? palette.tint : palette.border,
                        },
                        pressed && styles.pressed,
                      ]}>
                      <View style={styles.optionBody}>
                        {option.leadingIcon ? (
                          <View style={[styles.optionIcon, { backgroundColor: `${color}14` }]}>
                            {option.leadingIcon({ color, selected, size: 18 })}
                          </View>
                        ) : null}
                        <View style={styles.optionTextWrap}>
                          <Text style={[styles.optionLabel, { color: palette.text }]}>{option.label}</Text>
                          {option.description ? (
                            <Text style={[styles.optionDescription, { color: palette.muted }]}>{option.description}</Text>
                          ) : null}
                        </View>
                        {selected ? <MaterialCommunityIcons name="check" size={20} color={palette.tint} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    flexShrink: 1,
    maxHeight: '72%',
    overflow: 'hidden',
  },
  sheetHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sheetTitle: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    borderRadius: 999,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  closeButtonLabel: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    fontWeight: '600',
  },
  searchWrap: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  optionScroll: {
    flexShrink: 1,
  },
  optionList: {
    gap: 8,
    padding: 12,
    paddingBottom: 24,
  },
  option: {
    borderRadius: 16,
    borderWidth: 1,
  },
  optionBody: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  optionLabel: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '600',
  },
  optionDescription: {
    fontFamily: Fonts.sans,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.82,
  },
});
