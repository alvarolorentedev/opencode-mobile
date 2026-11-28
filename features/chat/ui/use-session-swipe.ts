import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { getLanguageDirection } from '@/shared/i18n/languages';
import { swipeSessionDirection, type SessionSwipeDirection } from '@/features/chat/model/session-swipe';

const ACTIVATE_DISTANCE = 28;
const COMMIT_DISTANCE = 56;
const VERTICAL_TOLERANCE = 24;

/**
 * Two-finger horizontal swipe for the chat screen. One-finger scrolling in the
 * transcript, code blocks and tables keeps its native gesture, and the two-finger
 * requirement keeps the switch away from OS edge-back gestures.
 */
export function useSessionSwipe(onSwitchSession: (direction: SessionSwipeDirection) => void) {
  const { i18n } = useTranslation();
  const rtl = getLanguageDirection(i18n.resolvedLanguage || i18n.language) === 'rtl';
  const commit = useCallback((translationX: number) => {
    if (Math.abs(translationX) < COMMIT_DISTANCE) return;
    onSwitchSession(swipeSessionDirection(translationX, rtl));
  }, [onSwitchSession, rtl]);
  return useMemo(() => Gesture.Pan()
    .minPointers(2)
    .maxPointers(2)
    .averageTouches(true)
    .activeOffsetX([-ACTIVATE_DISTANCE, ACTIVATE_DISTANCE])
    .failOffsetY([-VERTICAL_TOLERANCE, VERTICAL_TOLERANCE])
    .onEnd((event) => {
      runOnJS(commit)(event.translationX);
    }), [commit]);
}
