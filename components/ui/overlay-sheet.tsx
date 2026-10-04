import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Icon, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePalette } from '@/providers/theme-provider';
import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';

export function OverlaySheet({ visible, title, onClose, children, headerAction, testID, fitContent = false, scrollable = true, compact = false }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  headerAction?: ReactNode;
  testID?: string;
  fitContent?: boolean;
  scrollable?: boolean;
  compact?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t } = useTranslation();
  const palette = usePalette();
  // Android back dismisses the open sheet instead of navigating the screen behind it.
  useDismissOnBack(visible, onClose);
  if (!visible) return null;

  return (
    <Portal>
      <View style={styles.overlay} testID={testID}>
        <Pressable accessibilityLabel={t('common:actions.closeWithName', { title })} onPress={onClose} style={StyleSheet.absoluteFill}>
          <View style={styles.backdrop} />
        </Pressable>
        <View testID={fitContent ? `${testID}-sheet` : undefined} accessibilityLabel={title} accessibilityViewIsModal style={[styles.sheet, fitContent ? { maxHeight: height - 64 - insets.top } : { top: compact ? Math.max(64 + insets.top, height * 0.45) : 64 + insets.top }, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {compact ? <View style={styles.grabberWrap}><View style={[styles.grabber, { backgroundColor: palette.muted }]} /></View> : null}
          <View style={[styles.header, compact && styles.compactHeader, { borderBottomColor: palette.border }]}>
            {compact ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel={t('common:actions.close')} onPress={onClose} style={styles.compactAction}>
                  <Icon source="close" size={22} color={palette.muted} />
                </Pressable>
                <Text variant="titleMedium" style={[styles.compactTitle, { color: palette.text }]}>{title}</Text>
                <View style={styles.compactAction}>{headerAction}</View>
              </>
            ) : (
              <>
                <Text variant="titleMedium" style={{ color: palette.text }}>{title}</Text>
                <View style={styles.headerActions}>
                  {headerAction}
                  <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
                    <Text style={{ color: palette.tint }}>{t('common:actions.close')}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
          {scrollable ? <ScrollView keyboardShouldPersistTaps="handled" style={fitContent ? styles.fitContentScroll : undefined} contentContainerStyle={[styles.content, compact && styles.compactContent, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {children}
          </ScrollView> : <View style={[styles.content, compact && styles.compactContent, { flex: 1, minHeight: 0, paddingBottom: Math.max(insets.bottom, 24) }]}>{children}</View>}
        </View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  header: { minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderBottomWidth: 1 },
  grabberWrap: { height: 24, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  compactHeader: { minHeight: 56, paddingHorizontal: 8 },
  compactTitle: { flex: 1, textAlign: 'center', fontWeight: '700' },
  compactAction: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  compactContent: { padding: 0, gap: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  closeButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  fitContentScroll: { flexGrow: 0, flexShrink: 1 },
  content: { padding: 12, gap: 8 },
});
