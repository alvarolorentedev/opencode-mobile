import { Button } from '@/components/ui/button';
import { Text as UiText } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { withAlpha } from '@/lib/color';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Keyboard, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { NumericSlider } from '@/components/ui/numeric-slider';
import { getModelVariantLabel } from '@/components/chat/chat-view-utils';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import { Fonts } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';
import type { ModelOption } from '@/providers/opencode-provider';

type ModelPickerProps = {
  disabled?: boolean;
  compact?: boolean;
  reasoningLabel?: string;
  selectedVariant?: string;
  onVariantChange?: (value: string | undefined) => void;
  models: ModelOption[];
  onSelect: (model: ModelOption) => void;
  recentModelIds?: string[];
  selectedModelId?: string;
  slim?: boolean;
  autoRoutingEnabled?: boolean;
  autoRoutingAvailable?: boolean;
  onAutoRoutingChange?: (enabled: boolean) => void;
};

function getSelectedModelLabel(models: ModelOption[], selectedModelId: string | undefined, fallback: string) {
  const selected = models.find((model) => model.id === selectedModelId);
  return selected ? `${selected.label} · ${selected.providerLabel}` : fallback;
}

export function ModelPicker({ disabled = false, models, onSelect, recentModelIds, selectedModelId, slim = false, compact = false, reasoningLabel, selectedVariant, onVariantChange, autoRoutingEnabled = false, autoRoutingAvailable = false, onAutoRoutingChange }: ModelPickerProps) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  useUpdateBlocker(visible);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingModels = useMemo(
    () => models.filter((model) => {
      if (!normalizedQuery) {
        return true;
      }

      return [model.label, model.modelID, model.providerLabel, model.providerID].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    }),
    [models, normalizedQuery],
  );
  const providerGroups = useMemo(() => {
    const groups = new Map<string, { label: string; models: ModelOption[] }>();

    matchingModels.forEach((model) => {
      const group = groups.get(model.providerID);
      if (group) {
        group.models.push(model);
        return;
      }

      groups.set(model.providerID, { label: model.providerLabel, models: [model] });
    });

    return [...groups.entries()].map(([providerID, group]) => ({ providerID, ...group }));
  }, [matchingModels]);

  useEffect(() => {
    if (!visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the search when the picker closes.
      setQuery('');
    }
  }, [visible]);

  const close = () => setVisible(false);
  const select = (model: ModelOption) => {
    close();
    onSelect(model);
  };
  const selected = models.find((model) => model.id === selectedModelId);
  const selectedModelLabel = autoRoutingEnabled
    ? t('chat:modelPicker.autoRouting')
    : getSelectedModelLabel(models, selectedModelId, t('chat:modelPicker.selectModel'));
  const selectedTriggerLabel = autoRoutingEnabled
    ? t('chat:modelPicker.autoRouting')
    : selected?.label || t('chat:modelPicker.selectModel');
  const variantIds = [undefined, ...(selected?.variants.map((variant) => variant.id) ?? [])];
  const showVariantPicker = !autoRoutingEnabled && variantIds.length > 1 && onVariantChange;
  const recentModels = useMemo(() => (recentModelIds ?? [])
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is ModelOption => model !== undefined && model.id !== selectedModelId)
    .slice(0, 3), [models, recentModelIds, selectedModelId]);
  const sections = useMemo(() => [
    ...(!normalizedQuery && selected ? [{ key: 'selected', title: autoRoutingEnabled ? t('chat:modelPicker.defaultModel') : t('chat:modelPicker.selected'), providerID: undefined, data: [selected] }] : []),
    ...(!normalizedQuery && recentModels.length > 0 ? [{ key: 'recent', title: t('chat:modelPicker.recent'), providerID: undefined, data: recentModels }] : []),
    ...providerGroups.map((group) => ({ key: `provider:${group.providerID}`, title: group.label, providerID: group.providerID, data: group.models })),
  ], [autoRoutingEnabled, normalizedQuery, selected, recentModels, providerGroups, t]);
  const renderModelRow = (model: ModelOption, showProvider = false) => {
    const isSelected = model.id === selectedModelId;
    return (
      <Pressable
        key={model.id}
        accessibilityRole="button"
        onPress={() => select(model)}
        style={({ pressed }) => [
          styles.option,
          { backgroundColor: isSelected ? palette.background : palette.surface, borderColor: isSelected ? palette.tint : palette.border },
          pressed && styles.pressed,
        ]}>
        <View className={cn(stylesClasses.optionText)}>
          <Text className={cn("text-foreground")} style={[styles.optionLabel]}>{model.label}</Text>
          <Text className={cn("text-muted-foreground")} style={[styles.optionDescription]}>
            {showProvider ? `${model.providerLabel} · ${model.modelID}` : model.modelID}
            {model.supportsReasoning ? t('chat:modelPicker.reasoningSupported') : t('chat:modelPicker.standardModel')}
          </Text>
        </View>
        {isSelected ? <MaterialCommunityIcons name="check" size={20} color={palette.tint} /> : null}
      </Pressable>
    );
  };

  return (
    <>
      {compact ? (
        <Pressable
          testID="chat-model-picker-trigger"
          accessibilityRole="button"
          accessibilityLabel={`${selectedModelLabel}${reasoningLabel ? ` · ${reasoningLabel}` : ''}`}
          accessibilityState={{ disabled: disabled || models.length === 0 }}
          disabled={disabled || models.length === 0}
          onPress={() => { Keyboard.dismiss(); setVisible(true); }}
          style={({ pressed }) => [styles.summary, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
          <Text maxFontSizeMultiplier={1.5} numberOfLines={1} className={cn("text-foreground")} style={[styles.summaryModel]}>{selectedTriggerLabel}</Text>
          {reasoningLabel ? <Text maxFontSizeMultiplier={1.5} numberOfLines={1} className={cn("text-foreground")} style={[styles.summaryReasoning]}>{reasoningLabel}</Text> : null}
        </Pressable>
      ) : (
        <Button variant={visible ? 'secondary' : 'outline'} disabled={disabled || models.length === 0}
          onPress={() => setVisible(true)} className={cn('flex-1 min-w-0', slim && 'px-2')}
          testID="chat-model-picker-trigger" accessibilityLabel={selectedModelLabel}>
          {renderProviderIcon(selected?.providerID, slim ? 14 : 16, palette.tint)}
          <UiText numberOfLines={1} maxFontSizeMultiplier={1.5}>{selectedModelLabel}</UiText>
        </Button>
      )}
      <OverlaySheet visible={visible} title={t('chat:modelPicker.chooseModel')} onClose={close} testID="chat-model-picker" scrollable={false}>
              {onAutoRoutingChange ? (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: autoRoutingEnabled, disabled: !autoRoutingAvailable }}
                  disabled={!autoRoutingAvailable}
                  onPress={() => {
                    if (!autoRoutingAvailable) return;
                    onAutoRoutingChange(!autoRoutingEnabled);
                    close();
                  }}
                  testID="chat-model-auto-routing"
                  style={({ pressed }) => [
                    styles.autoRoutingRow,
                    {
                      backgroundColor: autoRoutingEnabled ? withAlpha(palette.tint, 0x12 / 255) : palette.background,
                      borderColor: autoRoutingEnabled ? palette.tint : palette.border,
                      opacity: autoRoutingAvailable ? (pressed ? 0.82 : 1) : 0.5,
                    },
                  ]}>
                  <View className={cn(stylesClasses.autoRoutingText)}>
                    <Text className={cn("text-foreground")} style={[styles.autoRoutingTitle]}>{t('chat:modelPicker.autoRouting')}</Text>
                    <Text className={cn("text-muted-foreground")} style={[styles.autoRoutingDescription]}>
                      {autoRoutingAvailable ? t('chat:modelPicker.autoRoutingDescription') : t('chat:modelPicker.autoRoutingUnavailable')}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={autoRoutingEnabled ? 'check-circle-outline' : 'circle-outline'}
                    size={22}
                    color={autoRoutingEnabled ? palette.tint : palette.muted}
                  />
                </Pressable>
              ) : null}
              {showVariantPicker ? (
                <View className={cn("px-4 pt-3")}>
                  <NumericSlider
                    label={t('chat:composer.reasoning')}
                    minimum={0}
                    maximum={variantIds.length - 1}
                    step={1}
                    value={Math.max(0, variantIds.findIndex((variant) => variant === selectedVariant))}
                    valueLabel={reasoningLabel ?? getModelVariantLabel(selectedVariant, t)}
                    onValueChange={(index) => onVariantChange?.(variantIds[index])}
                    palette={palette}
                  />
                </View>
              ) : null}
              <View className={cn(stylesClasses.searchShell, "bg-background border-border")}>
                <MaterialCommunityIcons name="magnify" size={20} color={palette.muted} />
                <Input
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  cursorColor={palette.tint}
                  placeholder={t('chat:modelPicker.searchPlaceholder')} accessibilityLabel={t('chat:modelPicker.searchPlaceholder')}
                  placeholderTextColor={palette.muted}
                  selectionColor={palette.tint}
                  className="border-0 bg-transparent px-0 py-0" style={styles.searchInput}
                  testID="chat-model-picker-search"
                  value={query}
                  onChangeText={setQuery}
                />
              </View>
              <SectionList
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="always"
                className={cn(stylesClasses.results)}
                sections={sections}
                keyExtractor={(model) => model.id}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={5}
                stickySectionHeadersEnabled={false}
                renderItem={({ item, section }) => renderModelRow(item, !section.providerID)}
                renderSectionHeader={({ section }) => section.providerID ? (
                    <View className={cn(stylesClasses.groupHeader)}>
                      <View className={cn(stylesClasses.groupIcon)} style={[{ backgroundColor: withAlpha(palette.tint, 0x14 / 255) }]}>
                        {renderProviderIcon(section.providerID, 18, palette.tint)}
                      </View>
                      <Text className={cn("text-foreground")} style={[styles.groupTitle]}>{section.title}</Text>
                    </View>
                ) : <Text className={cn("text-muted-foreground")} style={[styles.sectionTitle]}>{section.title}</Text>}
                ListEmptyComponent={(
                  <View className={cn(stylesClasses.empty)}>
                    <Text className={cn("text-foreground")} style={[styles.emptyTitle]}>{t('chat:modelPicker.noMatchingModels')}</Text>
                    <Text className={cn("text-muted-foreground")} style={[styles.emptyBody]}>{t('chat:modelPicker.emptyHint')}</Text>
                  </View>
                )}
              />
      </OverlaySheet>
    </>
  );
}

const styles = StyleSheet.create({
  summary: { justifyContent: 'center', alignItems: 'flex-end', minHeight: 44, gap: 0, paddingHorizontal: 4 },
  summaryModel: { maxWidth: '100%', fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  summaryReasoning: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '600' },
  autoRoutingRow: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, marginHorizontal: 12, marginTop: 12, paddingHorizontal: 14, paddingVertical: 10 },
  autoRoutingTitle: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '700' },
  autoRoutingDescription: { fontFamily: Fonts.sans, fontSize: 12 },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 16, minHeight: 46, paddingVertical: 0 },
  list: { padding: 12, paddingBottom: 28 },
  sectionTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 2, paddingVertical: 8, textTransform: 'uppercase' },
  groupTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700' },
  option: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, marginBottom: 8, minHeight: 62, paddingHorizontal: 14, paddingVertical: 12 },
  optionLabel: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '600' },
  optionDescription: { fontFamily: Fonts.sans, fontSize: 13 },
  emptyTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700' },
  emptyBody: { fontFamily: Fonts.sans, fontSize: 14 },
  pressed: { opacity: 0.82 }
});

const stylesClasses = {
  "optionText": "flex-1 gap-0.75 min-w-0",
  "autoRoutingText": "flex-1 gap-0.5",
  "searchShell": "items-center rounded-[14px] border flex-row gap-2 m-3 px-3",
  "results": "flex-1",
  "groupHeader": "items-center flex-row gap-2 px-0.5 py-2",
  "groupIcon": "items-center rounded-full h-7.5 justify-center w-7.5",
  "empty": "items-center gap-1 py-8"
} as const;
