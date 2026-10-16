/* eslint-disable react-hooks/immutability -- Reanimated shared values are intentionally mutated from gesture worklets and close-time resets, which the React Compiler rule cannot model. */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Icon, Portal, Text } from 'react-native-paper';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';

// A downward drag past this fraction of the sheet height (or past the minimum
// distance) commits the dismissal. A fast fling also dismisses regardless of
// distance.
const DISMISS_DISTANCE_FRACTION = 0.3;
const MIN_DISMISS_DISTANCE = 72;
const DISMISS_VELOCITY = 900;
const DISMISS_DURATION = 180;

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
  const [sheetHeight, setSheetHeight] = useState(0);
  const translateY = useSharedValue(0);
  const dismissing = useSharedValue(false);

  const sheetAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: sheetHeight > 0 ? Math.max(0.4, 1 - (translateY.value / (sheetHeight + 1)) * 0.6) : 1,
  }));

  // Reset the drag offset while the sheet is closed so a previous drag never
  // leaves it rendered off-screen when it reopens.
  useEffect(() => {
    if (!visible) {
      translateY.value = 0;
      dismissing.value = false;
    }
  }, [dismissing, translateY, visible]);

  if (!visible) {
    return null;
  }

  const pan = Gesture.Pan()
    .enabled(dismissible)
    .activeOffsetY(10)
    .onUpdate((event) => {
      if (dismissing.value) {
        return;
      }
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (dismissing.value) {
        return;
      }
      const distance = Math.max(sheetHeight * DISMISS_DISTANCE_FRACTION, MIN_DISMISS_DISTANCE);
      if (translateY.value > distance || event.velocityY > DISMISS_VELOCITY) {
        dismissing.value = true;
        translateY.value = withTiming(sheetHeight + 120, { duration: DISMISS_DURATION }, (finished) => {
          if (finished) {
            runOnJS(onClose)();
          }
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    });

  return (
    <Portal>
      <KeyboardAvoidingView behavior="padding" style={[styles.overlay, { paddingTop: compact ? Math.max(64 + insets.top, height * 0.45) : 64 + insets.top }]} testID={testID}>
        {dismissible ? <Pressable accessibilityLabel={t('common:actions.closeWithName', { title })} onPress={onClose} style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.backdrop, backdropAnimatedStyle]} />
        </Pressable> : null}
        <Animated.View
          testID={fitContent ? `${testID}-sheet` : undefined}
          accessibilityLabel={title}
          accessibilityViewIsModal
          onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
          style={[styles.sheet, !fitContent && { flex: 1 }, { backgroundColor: palette.surface, borderColor: palette.border }, sheetAnimatedStyle]}>
          <GestureDetector gesture={pan}>
            <Animated.View style={styles.dragZone}>
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
            </Animated.View>
          </GestureDetector>
          {scrollable ? <ScrollView keyboardShouldPersistTaps="handled" style={fitContent ? styles.fitContentScroll : undefined} contentContainerStyle={[styles.content, compact && styles.compactContent, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {children}
          </ScrollView> : <View style={[styles.content, compact && styles.compactContent, { flex: 1, minHeight: 0, paddingBottom: Math.max(insets.bottom, 24) }]}>{children}</View>}
        </Animated.View>
      </KeyboardAvoidingView>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  sheet: { flexShrink: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  dragZone: { flexShrink: 0 },
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
