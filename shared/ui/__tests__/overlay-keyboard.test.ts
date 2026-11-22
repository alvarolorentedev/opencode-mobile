// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDismissKeyboardOnOpen } from '@/shared/ui/hooks/use-dismiss-keyboard-on-open';
import { renderHook } from '../../../tests/helpers/render-hook';

const { dismiss } = vi.hoisted(() => ({ dismiss: vi.fn() }));
vi.mock('react-native', () => ({ Keyboard: { dismiss } }));

type Props = { visible: boolean; enabled?: boolean };

function useHook({ visible, enabled = true }: Props) { useDismissKeyboardOnOpen(visible, enabled); }

describe('useDismissKeyboardOnOpen', () => {
  beforeEach(() => dismiss.mockClear());
  it('dismisses when the overlay opens and again after reopening', async () => {

    const runtime = renderHook(useHook, { visible: false });
    expect(dismiss).not.toHaveBeenCalled();

    runtime.rerender({ visible: true });
    expect(dismiss).toHaveBeenCalledTimes(1);

    // Re-rendering an already open overlay must not dismiss the keyboard again.
    runtime.rerender({ visible: true });
    expect(dismiss).toHaveBeenCalledTimes(1);

    runtime.rerender({ visible: false });
    expect(dismiss).toHaveBeenCalledTimes(1);

    runtime.rerender({ visible: true });
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('dismisses when a sheet mounts already visible', async () => {
    renderHook(useHook, { visible: true });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves the keyboard alone when the sheet opts out', async () => {
    const runtime = renderHook(useHook, { visible: false, enabled: false });
    runtime.rerender({ visible: true, enabled: false });
    expect(dismiss).not.toHaveBeenCalled();
  });
});
