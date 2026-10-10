import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Icon, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';

export function OverlaySheet({ visible, title, onClose, children, headerAction, testID, fitContent = false, scrollable = true, compact = false, blockUpdates = true, dismissible = true }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  headerAction?: ReactNode;
  testID?: string;
  fitContent?: boolean;
  scrollable?: boolean;
  compact?: boolean;
  blockUpdates?: boolean;
  dismissible?: boolean;
}) {
  const insets = useSafeAreaInsets();
  useUpdateBlocker(visible && blockUpdates);
  const { height } = useWindowDimensions();
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  // Android back dismisses the open sheet instead of navigating the screen behind it.
  useDismissOnBack(visible && dismissible, onClose);
  if (!visible) return null;

  return (
    <Portal>
      <KeyboardAvoidingView behavior="padding" style={[styles.overlay, { paddingTop: compact ? Math.max(64 + insets.top, height * 0.45) : 64 + insets.top }]} testID={testID}>
        {dismissible ? <Pressable accessibilityLabel={t('common:actions.closeWithName', { title })} onPress={onClose} style={StyleSheet.absoluteFill}>
          <View style={styles.backdrop} />
        </Pressable> : null}
        <View testID={fitContent ? `${testID}-sheet` : undefined} accessibilityLabel={title} accessibilityViewIsModal style={[styles.sheet, !fitContent && { flex: 1 }, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {compact ? <View style={styles.grabberWrap}><View style={[styles.grabber, { backgroundColor: palette.muted }]} /></View> : null}
          <View style={[styles.header, compact && styles.compactHeader, { borderBottomColor: palette.border }]}>
            {compact ? (
              <>
                {dismissible ? <Pressable accessibilityRole="button" accessibilityLabel={t('common:actions.close')} onPress={onClose} style={styles.compactAction}>
                  <Icon source="close" size={22} color={palette.muted} />
                </Pressable> : <View style={styles.compactAction} />}
                <Text variant="titleMedium" style={[styles.compactTitle, { color: palette.text }]}>{title}</Text>
                <View style={styles.compactAction}>{headerAction}</View>
              </>
            ) : (
              <>
                <Text variant="titleMedium" style={{ color: palette.text }}>{title}</Text>
                <View style={styles.headerActions}>
                  {headerAction}
                  {dismissible ? <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
                    <Text style={{ color: palette.tint }}>{t('common:actions.close')}</Text>
                  </Pressable> : null}
                </View>
              </>
            )}
          </View>
          {scrollable ? <ScrollView keyboardShouldPersistTaps="handled" style={fitContent ? styles.fitContentScroll : undefined} contentContainerStyle={[styles.content, compact && styles.compactContent, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {children}
          </ScrollView> : <View style={[styles.content, compact && styles.compactContent, { flex: 1, minHeight: 0, paddingBottom: Math.max(insets.bottom, 24) }]}>{children}</View>}
        </View>
      </KeyboardAvoidingView>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  sheet: { flexShrink: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
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
