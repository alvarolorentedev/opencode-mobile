import { cn } from '@/shared/ui/cn';
import * as DialogPrimitive from '@rn-primitives/dialog';
import { DialogFrame } from '@/shared/ui/dialog-frame';
import { PortalScope, usePortalHost, useOverlayDismiss } from '@/shared/ui/portal';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { useContext, type ReactNode } from 'react';
import { WorkspaceScopeContext , useUpdateBlocker } from '@/runtime/ui';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDismissKeyboardOnOpen } from '@/shared/ui/hooks/use-dismiss-keyboard-on-open';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { useSwipeDismiss } from '@/shared/ui/use-swipe-dismiss';

export function OverlaySheet({ visible, title, onClose, children, headerAction, testID, fitContent = false, scrollable = true, compact = false, blockUpdates = true, dismissible = true, dismissKeyboard = true }: {
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
  dismissKeyboard?: boolean;
}) {
  const workspace = useContext(WorkspaceScopeContext);
  const portalHost = usePortalHost();
  const insets = useSafeAreaInsets();
  useUpdateBlocker(visible && blockUpdates);
  const { height } = useWindowDimensions();
  const { t } = useTranslation();
  const palette = usePalette();
  // Android back dismisses the open sheet instead of navigating the screen behind it.
  useOverlayDismiss(visible && dismissible, onClose);
  // A keyboard raised by the screen behind the sheet would cover it.
  useDismissKeyboardOnOpen(visible, dismissKeyboard);
  const { pan, sheetStyle, backdropStyle, handleSheetLayout } = useSwipeDismiss({
    visible,
    enabled: dismissible,
    onDismiss: onClose,
  });

  if (!visible) {
    return null;
  }

  const content = (
      <KeyboardAvoidingView behavior="padding" className={cn(stylesClasses.overlay)} style={[{ paddingTop: compact ? Math.max(64 + insets.top, height * 0.45) : 64 + insets.top }]} testID={testID}>
        {dismissible ? <Pressable accessibilityLabel={t('common:actions.closeWithName', { title })} onPress={onClose} style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.backdrop, { backgroundColor: palette.backdrop }, backdropStyle]} />
        </Pressable> : null}
        <DialogFrame asChild aria-describedby={undefined}><Animated.View
          testID={testID ? `${testID}-sheet` : undefined}
          accessibilityLabel={title}
          accessibilityViewIsModal
          onLayout={handleSheetLayout}
          style={[styles.sheet, !fitContent && { flex: 1 }, { backgroundColor: palette.surface, borderColor: palette.border }, sheetStyle]}>
          <GestureDetector gesture={pan}>
            <Animated.View style={styles.dragZone}>
              {compact ? <View className={cn(stylesClasses.grabberWrap)}><View className={cn(stylesClasses.grabber, "bg-muted-foreground")} /></View> : null}
              <View className={cn(compact && stylesClasses.compactHeader)} style={[styles.header, { borderBottomColor: palette.border }]}>
                {compact ? (
                  <>
                    {dismissible ? <Pressable accessibilityRole="button" accessibilityLabel={t('common:actions.close')} onPress={onClose} className={cn(stylesClasses.compactAction)}>
                      <Icon size={22} color={palette.muted} name={"close"}></Icon>
                    </Pressable> : <View className={cn(stylesClasses.compactAction)} />}
                    <DialogPrimitive.Title asChild><Text className={cn(stylesClasses.compactTitle, "text-foreground")} variant="title">{title}</Text></DialogPrimitive.Title>
                    <View className={cn(stylesClasses.compactAction)}>{headerAction}</View>
                  </>
                ) : (
                  <>
                    <DialogPrimitive.Title asChild><Text className={cn("text-foreground")} variant="title">{title}</Text></DialogPrimitive.Title>
                    <View className={cn(stylesClasses.headerActions)}>
                      {headerAction}
                      {dismissible ? <Pressable accessibilityRole="button" onPress={onClose} className={cn(stylesClasses.closeButton)}>
                        <Text className={cn("text-primary")}>{t('common:actions.close')}</Text>
                      </Pressable> : null}
                    </View>
                  </>
                )}
              </View>
            </Animated.View>
          </GestureDetector>
          {scrollable ? <ScrollView keyboardShouldPersistTaps="handled" style={fitContent ? styles.fitContentScroll : undefined} contentContainerStyle={[styles.content, compact && styles.compactContent, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {children}
          </ScrollView> : <View className={cn(stylesClasses.content, compact && stylesClasses.compactContent)} style={[{ ...(fitContent ? { flexShrink: 1 } : { flex: 1 }), minHeight: 0, paddingBottom: Math.max(insets.bottom, 24) }]}>{children}</View>}
        </Animated.View></DialogFrame>
      </KeyboardAvoidingView>
  );
  return <DialogPrimitive.Root open={visible} onOpenChange={(open) => { if (!open && dismissible) onClose(); }}><DialogPrimitive.Portal hostName={portalHost}>
    <PortalScope target={workspace}>{content}</PortalScope>
  </DialogPrimitive.Portal></DialogPrimitive.Root>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { flexShrink: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  dragZone: { flexShrink: 0 },
  header: { minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderBottomWidth: 1 },
  compactContent: { padding: 0, gap: 0 },
  fitContentScroll: { flexGrow: 0, flexShrink: 1 },
  content: { padding: 12, gap: 8 }
});

const stylesClasses = {
  "overlay": "absolute inset-0 justify-end",
  "grabberWrap": "h-6 items-center justify-center",
  "grabber": "w-9 h-1 rounded-[2px]",
  "compactHeader": "min-h-field px-2",
  "compactAction": "w-11 min-h-target items-center justify-center",
  "compactTitle": "flex-1 text-center font-bold",
  "headerActions": "flex-row items-center gap-1.5",
  "closeButton": "min-h-target justify-center px-2",
  "content": "p-3 gap-2",
  "compactContent": "p-0 gap-0"
} as const;
