import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Tracks the soft-keyboard height while `active` is true, and returns `0`
 * otherwise.
 *
 * Used by transparent `Modal` sheets where `KeyboardAvoidingView` is
 * unreliable. It listens to the settled `keyboardDidShow`/`keyboardDidHide`
 * events (never the `will*` ones) to avoid re-laying out on intermediate
 * frames, which can feed IME/toolbar changes back into each other with
 * hardware keyboards.
 */
export function useKeyboardHeight(active: boolean) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the inset once the surface is no longer listening.
      setHeight(0);
      return undefined;
    }

    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => setHeight(event.endCoordinates.height));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setHeight(0));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
      setHeight(0);
    };
  }, [active]);

  return height;
}
