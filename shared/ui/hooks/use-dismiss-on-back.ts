import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Dismisses an open overlay when the Android hardware back button is pressed.
 *
 * The handler consumes the press (returns `true`) so the navigation underneath
 * the overlay keeps its position; the user must press back again to leave the
 * screen. Registration only happens while `visible` is true, and the latest
 * `onDismiss` is always invoked without re-subscribing on every render.
 *
 * Web overlays dismiss with Escape without registering the unsupported web BackHandler.
 */
export function useDismissOnBack(visible: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    if (Platform.OS === 'web') {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onDismissRef.current();
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismissRef.current();
      return true;
    });

    return () => subscription.remove();
  }, [visible]);
}
