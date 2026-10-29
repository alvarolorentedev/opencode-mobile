import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { ControlSize, Shape, Spacing } from '@/constants/design-tokens';
import { usePalette } from '@/hooks/use-palette';
import type { SettingsTarget } from './settings-search';

const TargetContext = createContext<{
  target?: SettingsTarget;
  reveal?: (node: View) => void;
}>({});

export function useSettingsTarget() {
  return useContext(TargetContext).target;
}

export function SettingsPanel({ children, target }: { children: ReactNode; target?: SettingsTarget }) {
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const reveal = useCallback((node: View) => {
    if (!content.current) return;
    node.measureLayout(content.current, (_x, y) => {
      scroll.current?.scrollTo({ y: Math.max(0, y - Spacing.md), animated: false });
      if (Platform.OS === 'web') node.focus();
    });
  }, []);
  useEffect(() => {
    if (target) AccessibilityInfo.announceForAccessibility(target.label);
  }, [target]);
  return <TargetContext value={{ target, reveal }}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View ref={content} collapsable={false} style={styles.content}>{children}</View>
    </ScrollView>
  </TargetContext>;
}

export function SettingTarget({ children, label }: { children: ReactNode; label?: string }) {
  const { target, reveal } = useContext(TargetContext);
  const palette = usePalette();
  const ref = useRef<View>(null);
  const selected = Boolean(label && target?.label === label);
  const show = useCallback(() => {
    if (selected && ref.current) reveal?.(ref.current);
  }, [reveal, selected]);
  useEffect(show, [show]);
  if (!reveal) return <>{children}</>;
  return <View ref={ref} collapsable={false} onLayout={show} tabIndex={selected ? -1 : undefined}
    testID={selected ? 'settings-search-destination' : undefined}
    style={[styles.target, selected && [styles.highlight, { borderColor: palette.tint, backgroundColor: palette.surfaceAlt }]]}>
    {children}
  </View>;
}

export function SettingsDisclosure({ id, title, children, attention = false, plain = false }: {
  id: string; title: string; children: ReactNode; attention?: boolean; plain?: boolean;
}) {
  const palette = usePalette();
  const target = useSettingsTarget();
  const [open, setOpen] = useState(target?.group === id);
  const expanded = open || attention;
  if (plain) return <>{children}</>;
  return <View style={[styles.disclosure, { borderColor: palette.border }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} aria-expanded={expanded}
      onPress={() => setOpen(!open)} style={({ pressed }) => [styles.disclosureHeader, pressed && { backgroundColor: palette.surfaceAlt }]}>
      <Text variant="titleSmall" style={[styles.disclosureTitle, { color: palette.text }]}>{title}</Text>
      <Icon source={expanded ? 'chevron-up' : 'chevron-down'} size={24} color={palette.muted} />
    </Pressable>
    {expanded ? <View style={styles.disclosureBody}>{children}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  scrollContent: { flexGrow: 1 },
  content: { gap: Spacing.lg },
  target: { gap: Spacing.md },
  highlight: { borderWidth: 2, borderRadius: Shape.control, padding: Spacing.xs },
  disclosure: { borderWidth: 1, borderRadius: Shape.control, overflow: 'hidden' },
  disclosureHeader: { minHeight: ControlSize.field, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  disclosureTitle: { flex: 1 },
  disclosureBody: { padding: Spacing.md, paddingTop: 0, gap: Spacing.lg },
});
