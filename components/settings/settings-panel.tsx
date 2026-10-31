import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';


import { ControlSize, Spacing } from '@/constants/design-tokens';
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
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" className={cn(stylesClasses.scroll)} contentContainerStyle={styles.scrollContent}>
      <View ref={content} collapsable={false} className={cn(stylesClasses.content)}>{children}</View>
    </ScrollView>
  </TargetContext>;
}

export function SettingTarget({ children, label }: { children: ReactNode; label?: string }) {
  const { target, reveal } = useContext(TargetContext);

  const ref = useRef<View>(null);
  const selected = Boolean(label && target?.label === label);
  const show = useCallback(() => {
    if (selected && ref.current) reveal?.(ref.current);
  }, [reveal, selected]);
  useEffect(show, [show]);
  if (!reveal) return <>{children}</>;
  return <View ref={ref} collapsable={false} onLayout={show} tabIndex={selected ? -1 : undefined}
    testID={selected ? 'settings-search-destination' : undefined}
    className={cn(stylesClasses.target, selected && stylesClasses.highlight, selected && "border-primary bg-surface-alt")}>
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
  return <View className={cn(stylesClasses.disclosure, "border-border")}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} aria-expanded={expanded}
      onPress={() => setOpen(!open)} style={({ pressed }) => [styles.disclosureHeader, pressed && { backgroundColor: palette.surfaceAlt }]}>
      <Text className={cn(stylesClasses.disclosureTitle, "text-foreground")} variant="description">{title}</Text>
      <Icon size={24} color={palette.muted} name={expanded ? 'chevron-up' : 'chevron-down'}></Icon>
    </Pressable>
    {expanded ? <View className={cn(stylesClasses.disclosureBody)}>{children}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1 },
  disclosureHeader: { minHeight: ControlSize.field, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }
});

const stylesClasses = {
  "scroll": "shrink",
  "content": "gap-lg",
  "target": "gap-md",
  "highlight": "border-[2px] rounded-control p-xs",
  "disclosure": "border rounded-control overflow-hidden",
  "disclosureTitle": "flex-1",
  "disclosureBody": "p-md pt-0 gap-lg"
} as const;
