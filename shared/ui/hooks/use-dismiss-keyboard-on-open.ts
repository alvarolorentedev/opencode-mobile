import { useEffect } from 'react';
import { Keyboard } from 'react-native';

/**
 * Dismisses the soft keyboard when a shared overlay opens.
 *
 * Overlays render above the screen that raised the keyboard, so a focused
 * composer or search field would otherwise keep the keyboard covering the
 * sheet. The effect runs when an overlay becomes visible and on mount while
 * visible, but not on unrelated re-renders, so a sheet that later focuses its
 * own input (rename, add, search) is unaffected.
 *
 * Pass `enabled = false` for a sheet whose content auto-focuses a field when it
 * mounts; that focus is the user's intent and must not be cancelled.
 */
export function useDismissKeyboardOnOpen(visible: boolean, enabled = true) {
  useEffect(() => {
    if (visible && enabled) {
      Keyboard.dismiss();
    }
  }, [visible, enabled]);
}
