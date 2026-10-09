import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { NumericSlider } from '@/components/ui/numeric-slider';
import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { REASONING_OPTIONS } from '@/components/chat/chat-view-utils';
import { ControlButton } from '@/components/chat/chat-controls';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ModelOption, ReasoningLevel } from '@/providers/opencode-provider';

type ModelPickerProps = {
  disabled?: boolean;
  compact?: boolean;
  reasoningLabel?: string;
  reasoning?: ReasoningLevel;
  onReasoningChange?: (value: ReasoningLevel) => void;
  models: ModelOption[];
  onSelect: (model: ModelOption) => void;
  recentModelIds?: string[];
  selectedModelId?: string;
  slim?: boolean;
};

function getSelectedModelLabel(models: ModelOption[], selectedModelId: string | undefined, fallback: string) {
  const selected = models.find((model) => model.id === selectedModelId);
  return selected ? `${selected.label} · ${selected.providerLabel}` : fallback;
}

export function ModelPicker({ disabled = false, models, onSelect, recentModelIds, selectedModelId, slim = false, compact = false, reasoningLabel, reasoning, onReasoningChange }: ModelPickerProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
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
  const select = (model: ModelOption) => {
    close();
    onSelect(model);
  };
  const selected = models.find((model) => model.id === selectedModelId);
  const recentModels = useMemo(() => (recentModelIds ?? [])
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is ModelOption => model !== undefined && model.id !== selectedModelId)
    .slice(0, 3), [models, recentModelIds, selectedModelId]);
  const sections = useMemo(() => [
    ...(!normalizedQuery && selected ? [{ key: 'selected', title: t('chat:modelPicker.selected'), providerID: undefined, data: [selected] }] : []),
    ...(!normalizedQuery && recentModels.length > 0 ? [{ key: 'recent', title: t('chat:modelPicker.recent'), providerID: undefined, data: recentModels }] : []),
    ...providerGroups.map((group) => ({ key: `provider:${group.providerID}`, title: group.label, providerID: group.providerID, data: group.models })),
  ], [normalizedQuery, selected, recentModels, providerGroups, t]);
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
          accessibilityLabel={`${getSelectedModelLabel(models, selectedModelId, t('chat:modelPicker.selectModel'))}${reasoningLabel ? ` · ${reasoningLabel}` : ''}`}
          accessibilityState={{ disabled: disabled || models.length === 0 }}
          disabled={disabled || models.length === 0}
          onPress={() => { Keyboard.dismiss(); setVisible(true); }}
          style={({ pressed }) => [styles.summary, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
          <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.summaryModel, { color: palette.text }]}>{selected?.label || t('chat:modelPicker.selectModel')}</Text>
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
          {getSelectedModelLabel(models, selectedModelId, t('chat:modelPicker.selectModel'))}
        </ControlButton>
      )}
      <Modal animationType="slide" transparent visible={visible} onRequestClose={close}>
        <View style={[styles.overlay, { paddingBottom: keyboardHeight }]}>
          <Pressable accessible={false} style={styles.backdrop} onPress={close} />
          <View testID="chat-model-picker" style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={[styles.header, { borderBottomColor: palette.border }]}>
                <Text style={[styles.title, { color: palette.text }]}>{t('chat:modelPicker.chooseModel')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('chat:modelPicker.closePicker')} onPress={close} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                  <Text style={[styles.closeLabel, { color: palette.tint }]}>{t('common:actions.close')}</Text>
                </Pressable>
              </View>
              {reasoning && onReasoningChange ? (
                <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                  <NumericSlider
                    label={t('chat:composer.reasoning')}
                    minimum={0}
                    maximum={REASONING_OPTIONS.length - 1}
                    step={1}
                    value={Math.max(0, REASONING_OPTIONS.findIndex((option) => option.id === reasoning))}
                    valueLabel={reasoningLabel || t(REASONING_OPTIONS.find((option) => option.id === reasoning)?.labelKey || 'chat:reasoning.default')}
                    onValueChange={(index) => onReasoningChange(REASONING_OPTIONS[index].id)}
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
                      <View style={[styles.groupIcon, { backgroundColor: `${palette.tint}14` }]}>
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
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  summary: { justifyContent: 'center', alignItems: 'flex-end', minHeight: 44, gap: 0, paddingHorizontal: 4 },
  summaryModel: { maxWidth: '100%', fontFamily: Fonts.sans, fontSize: 13, fontWeight: '600' },
  summaryReasoning: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '600' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.28)', zIndex: 0 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, elevation: 1, height: '82%', overflow: 'hidden', zIndex: 1 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: Fonts.display, fontSize: 18, fontWeight: '700' },
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
