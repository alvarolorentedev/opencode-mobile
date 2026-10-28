import { withAlpha } from '@/lib/color';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { NumericSlider } from '@/components/ui/numeric-slider';
import { useSwipeDismiss } from '@/components/ui/use-swipe-dismiss';
import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
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

function ControlButton({
  active = false,
  children,
  disabled = false,
  grow = false,
  icon,
  onPress,
  slim = false,
  testID,
}: {
  active?: boolean;
  children: string;
  disabled?: boolean;
  grow?: boolean;
  icon?: (props: { size: number; color: string }) => ReactNode;
  onPress: () => void;
  slim?: boolean;
  testID?: string;
}) {
  const palette = usePalette();
  const textColor = active ? palette.tint : palette.text;
  const borderColor = active ? 'transparent' : palette.border;
  const backgroundColor = active ? withAlpha(palette.tint, 0x18 / 255) : palette.surface;
  const iconSize = slim ? 14 : 16;
  const controlSize = slim ? 32 : 40;
  const innerHeight = slim ? 30 : 38;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={children}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.controlButton,
        grow ? styles.controlButtonGrow : null,
        styles.controlButtonText,
        slim && { minHeight: controlSize, paddingHorizontal: 8 },
        { borderColor, backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
      ]}>
      <View style={[styles.controlButtonInner, slim && { minHeight: innerHeight, gap: 6 }]}>
        {icon ? icon({ size: iconSize, color: textColor }) : null}
        <Text maxFontSizeMultiplier={1.5} numberOfLines={1} ellipsizeMode="tail" style={[styles.controlButtonLabel, slim && { fontSize: 13 }, { color: textColor }]}>
          {children}
        </Text>
      </View>
    </Pressable>
  );
}

export function ModelPicker({ disabled = false, models, onSelect, recentModelIds, selectedModelId, slim = false, compact = false, reasoningLabel, selectedVariant, onVariantChange, autoRoutingEnabled = false, autoRoutingAvailable = false, onAutoRoutingChange }: ModelPickerProps) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  useUpdateBlocker(visible);
  const keyboardHeight = useKeyboardHeight(visible);
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
  useDismissOnBack(visible, close);
  const { pan, sheetStyle, backdropStyle, handleSheetLayout } = useSwipeDismiss({
    visible,
    enabled: true,
    onDismiss: close,
  });
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
        <View style={styles.optionText}>
          <Text style={[styles.optionLabel, { color: palette.text }]}>{model.label}</Text>
          <Text style={[styles.optionDescription, { color: palette.muted }]}>
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
          <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.summaryModel, { color: palette.text }]}>{selectedTriggerLabel}</Text>
          {reasoningLabel ? <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.summaryReasoning, { color: palette.text }]}>{reasoningLabel}</Text> : null}
        </Pressable>
      ) : (
        <ControlButton
          active={visible}
          disabled={disabled || models.length === 0}
          grow
          icon={(props) => renderProviderIcon(selected?.providerID, props.size, props.color)}
          onPress={() => setVisible(true)}
          slim={slim}
          testID="chat-model-picker-trigger">
          {selectedModelLabel}
        </ControlButton>
      )}
      <Modal animationType="slide" transparent visible={visible} onRequestClose={close}>
        <GestureHandlerRootView style={[styles.overlay, { paddingBottom: keyboardHeight }]}>
          <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={close}>
            <Animated.View style={[styles.backdrop, backdropStyle]} />
          </Pressable>
          <Animated.View testID="chat-model-picker" onLayout={handleSheetLayout} style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }, sheetStyle]}>
              <GestureDetector gesture={pan}>
                <View style={[styles.header, { borderBottomColor: palette.border }]}>
                  <Text style={[styles.title, { color: palette.text }]}>{t('chat:modelPicker.chooseModel')}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('chat:modelPicker.closePicker')} onPress={close} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                    <Text style={[styles.closeLabel, { color: palette.tint }]}>{t('common:actions.close')}</Text>
                  </Pressable>
                </View>
              </GestureDetector>
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
                  <View style={styles.autoRoutingText}>
                    <Text style={[styles.autoRoutingTitle, { color: palette.text }]}>{t('chat:modelPicker.autoRouting')}</Text>
                    <Text style={[styles.autoRoutingDescription, { color: palette.muted }]}>
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
                <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
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
              <View style={[styles.searchShell, { backgroundColor: palette.background, borderColor: palette.border }]}>
                <MaterialCommunityIcons name="magnify" size={20} color={palette.muted} />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  cursorColor={palette.tint}
                  placeholder={t('chat:modelPicker.searchPlaceholder')}
                  placeholderTextColor={palette.muted}
                  selectionColor={palette.tint}
                  style={[styles.searchInput, { color: palette.text }]}
                  testID="chat-model-picker-search"
                  value={query}
                  onChangeText={setQuery}
                />
              </View>
              <SectionList
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="always"
                style={styles.results}
                sections={sections}
                keyExtractor={(model) => model.id}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={5}
                stickySectionHeadersEnabled={false}
                renderItem={({ item, section }) => renderModelRow(item, !section.providerID)}
                renderSectionHeader={({ section }) => section.providerID ? (
                    <View style={styles.groupHeader}>
                      <View style={[styles.groupIcon, { backgroundColor: withAlpha(palette.tint, 0x14 / 255) }]}>
                        {renderProviderIcon(section.providerID, 18, palette.tint)}
                      </View>
                      <Text style={[styles.groupTitle, { color: palette.text }]}>{section.title}</Text>
                    </View>
                ) : <Text style={[styles.sectionTitle, { color: palette.muted }]}>{section.title}</Text>}
                ListEmptyComponent={(
                  <View style={styles.empty}>
                    <Text style={[styles.emptyTitle, { color: palette.text }]}>{t('chat:modelPicker.noMatchingModels')}</Text>
                    <Text style={[styles.emptyBody, { color: palette.muted }]}>{t('chat:modelPicker.emptyHint')}</Text>
                  </View>
                )}
              />
          </Animated.View>
        </GestureHandlerRootView>
      </Modal>
    </>
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
  controlButtonLabel: {
    flexShrink: 1,
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
  },
  summary: { justifyContent: 'center', alignItems: 'flex-end', minHeight: 44, gap: 0, paddingHorizontal: 4 },
  summaryModel: { maxWidth: '100%', fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  summaryReasoning: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '600' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.28)', zIndex: 0 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, elevation: 1, height: '82%', overflow: 'hidden', zIndex: 1 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: Fonts.display, fontSize: 18, fontWeight: '700' },
  autoRoutingRow: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, marginHorizontal: 12, marginTop: 12, paddingHorizontal: 14, paddingVertical: 10 },
  autoRoutingText: { flex: 1, gap: 2 },
  autoRoutingTitle: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '700' },
  autoRoutingDescription: { fontFamily: Fonts.sans, fontSize: 12 },
  closeButton: { borderRadius: 999, minHeight: 36, justifyContent: 'center', paddingHorizontal: 10 },
  closeLabel: { fontFamily: Fonts.sans, fontSize: 15, fontWeight: '600' },
  searchShell: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, margin: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 16, minHeight: 46, paddingVertical: 0 },
  results: { flex: 1 },
  list: { padding: 12, paddingBottom: 28 },
  sectionTitle: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 2, paddingVertical: 8, textTransform: 'uppercase' },
  groupHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 2, paddingVertical: 8 },
  groupIcon: { alignItems: 'center', borderRadius: 999, height: 30, justifyContent: 'center', width: 30 },
  groupTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700' },
  option: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, marginBottom: 8, minHeight: 62, paddingHorizontal: 14, paddingVertical: 12 },
  optionText: { flex: 1, gap: 3, minWidth: 0 },
  optionLabel: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '600' },
  optionDescription: { fontFamily: Fonts.sans, fontSize: 13 },
  empty: { alignItems: 'center', gap: 4, paddingVertical: 32 },
  emptyTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700' },
  emptyBody: { fontFamily: Fonts.sans, fontSize: 14 },
  pressed: { opacity: 0.82 },
});
