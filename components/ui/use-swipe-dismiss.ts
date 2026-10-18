/* eslint-disable react-hooks/immutability -- Reanimated shared values are intentionally mutated from gesture worklets and open-time resets, which the React Compiler rule cannot model. */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

// A downward drag past this fraction of the sheet height (or past the minimum
// distance) commits the dismissal. A fast fling also dismisses regardless of
// distance.
const DISMISS_DISTANCE_FRACTION = 0.3;
const MIN_DISMISS_DISTANCE = 72;
const DISMISS_VELOCITY = 900;
const DISMISS_DURATION = 180;

/**
 * Shared swipe-down-to-dismiss behavior for bottom-sheet overlays.
 *
 * Owns the pan gesture, the Reanimated drag offset, the measured sheet height,
 * and the backdrop fade, so every bottom sheet (`OverlaySheet` and the
 * transparent `Modal` sheets) dismisses on the same downward header drag with
 * the same thresholds. `enabled` mirrors the sheet's dismissible flag.
 */
export function useSwipeDismiss({ visible, enabled, onDismiss }: {
  visible: boolean;
  enabled: boolean;
  onDismiss: () => void;
}) {
  const [sheetHeight, setSheetHeight] = useState(0);
  const translateY = useSharedValue(0);
  const dismissing = useSharedValue(false);
  const wasVisible = useRef(false);

  // Reset the drag offset when the sheet opens, so a previous swipe never leaves
  // it rendered off-screen when it reopens. This must NOT run on close: on iOS
  // the native `Modal` keeps its children mounted through the dismissal
  // animation, so resetting on close would snap the dragged-off sheet back
  // on-screen mid-dismiss (a ghost). `OverlaySheet` unmounts immediately, so the
  // open-time reset covers it too.
  useLayoutEffect(() => {
    if (visible && !wasVisible.current) {
      translateY.value = 0;
      dismissing.value = false;
    }
    wasVisible.current = visible;
  }, [dismissing, translateY, visible]);

  const handleSheetLayout = useCallback((event: LayoutChangeEvent) => {
    setSheetHeight(event.nativeEvent.layout.height);
  }, []);

  const pan = Gesture.Pan()
    .enabled(enabled)
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
            runOnJS(onDismiss)();
          }
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: sheetHeight > 0 ? Math.max(0.4, 1 - (translateY.value / (sheetHeight + 1)) * 0.6) : 1,
  }));

  return { pan, sheetStyle, backdropStyle, handleSheetLayout };
}
