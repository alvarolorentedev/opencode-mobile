import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

async function loadHook() {
  const runtime = hookRuntime();
  const dismiss = vi.fn();
  const { useDismissKeyboardOnOpen } = await loadTs('shared/ui/hooks/use-dismiss-keyboard-on-open.ts', {
    react: runtime.react,
    'react-native': { Keyboard: { dismiss } },
  });
  return { runtime, dismiss, useDismissKeyboardOnOpen };
}

type Props = { visible: boolean; enabled?: boolean };

describe('useDismissKeyboardOnOpen', () => {
  it('dismisses when the overlay opens and again after reopening', async () => {
    const { runtime, dismiss, useDismissKeyboardOnOpen } = await loadHook();
    const useHook = (props: Props) => useDismissKeyboardOnOpen(props.visible, props.enabled ?? true);

    runtime.mount(useHook, { visible: false });
    expect(dismiss).not.toHaveBeenCalled();

    runtime.update({ visible: true });
    expect(dismiss).toHaveBeenCalledTimes(1);

    // Re-rendering an already open overlay must not dismiss the keyboard again.
    runtime.update({ visible: true });
    expect(dismiss).toHaveBeenCalledTimes(1);

    runtime.update({ visible: false });
    expect(dismiss).toHaveBeenCalledTimes(1);

    runtime.update({ visible: true });
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('dismisses when a sheet mounts already visible', async () => {
    const { runtime, dismiss, useDismissKeyboardOnOpen } = await loadHook();
    runtime.mount((props: Props) => useDismissKeyboardOnOpen(props.visible, props.enabled ?? true), { visible: true });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves the keyboard alone when the sheet opts out', async () => {
    const { runtime, dismiss, useDismissKeyboardOnOpen } = await loadHook();
    runtime.mount((props: Props) => useDismissKeyboardOnOpen(props.visible, props.enabled ?? true), { visible: false, enabled: false });
    runtime.update({ visible: true });
    expect(dismiss).not.toHaveBeenCalled();
  });
});
