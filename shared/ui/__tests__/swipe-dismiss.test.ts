// @vitest-environment happy-dom

import { act, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSwipeDismiss } from '@/shared/ui/use-swipe-dismiss';
import { renderHook } from '../../../tests/helpers/render-hook';

// Chainable Pan builder that records the worklet handlers so the test can drive
// them directly. The real library returns the gesture object.
function createPanMock() {
  const pan: Record<string, unknown> = {};
  pan.enabled = () => pan;
  pan.activeOffsetY = () => pan;
  pan.onUpdate = (fn: unknown) => { pan.update = fn; return pan; };
  pan.onEnd = (fn: unknown) => { pan.end = fn; return pan; };
  return pan;
}

type Shared = { value: unknown };

const { shared } = vi.hoisted(() => ({ shared: {} as { translateY?: Shared; dismissing?: Shared } }));
vi.mock('react-native-gesture-handler', () => ({ Gesture: { Pan: createPanMock } }));
vi.mock('react-native-reanimated', () => ({
  runOnJS: (fn: () => void) => fn,
  useAnimatedStyle: () => ({}),
  useSharedValue(value: unknown) {
    const held = useRef({ value }).current;
    if (typeof value === 'number') shared.translateY = held;
    else shared.dismissing = held;
    return held;
  },
  withSpring: (value: unknown) => value,
  withTiming(value: unknown, _config: unknown, callback?: (finished: boolean) => void) {
    callback?.(true);
    return value;
  },
}));

// Expose the mocked native gesture handlers from the latest committed render.
type PanHandlers = {
  update: (event: { translationY: number }) => void;
  end: (event: { velocityY: number }) => void;
};
function mountSheet(onDismiss: () => void, height = 400) {
  const initial = { visible: true, enabled: true, onDismiss };
  const runtime = renderHook(useSwipeDismiss, initial);
  act(() => runtime.result.current.handleSheetLayout({ nativeEvent: { layout: { height, width: 390, x: 0, y: 0 } } } as Parameters<ReturnType<typeof useSwipeDismiss>['handleSheetLayout']>[0]));
  return { pan: runtime.result.current.pan as unknown as PanHandlers,
    setVisible: (visible: boolean) => runtime.rerender({ ...initial, visible }),
    unmount: runtime.unmount };
}

describe('useSwipeDismiss', () => {
  it('dismisses once the drag passes the distance threshold', async () => {
    const onDismiss = vi.fn();
    const sheet = mountSheet(onDismiss);

    sheet.pan.update({ translationY: 200 });
    sheet.pan.end({ velocityY: 0 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    sheet.unmount();
  });

  it('dismisses on a fast fling even below the distance threshold', async () => {
    const onDismiss = vi.fn();
    const sheet = mountSheet(onDismiss);

    sheet.pan.update({ translationY: 20 });
    sheet.pan.end({ velocityY: 1000 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    sheet.unmount();
  });

  it('snaps back when the drag is short and slow', async () => {
    const onDismiss = vi.fn();
    const sheet = mountSheet(onDismiss);

    sheet.pan.update({ translationY: 40 });
    sheet.pan.end({ velocityY: 0 });

    expect(onDismiss).not.toHaveBeenCalled();
    sheet.unmount();
  });

  it('keeps the offset during dismissal and resets it on the next open', async () => {
    const onDismiss = vi.fn();
    const sheet = mountSheet(onDismiss);

    sheet.pan.update({ translationY: 200 });
    sheet.pan.end({ velocityY: 0 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(shared.translateY?.value).toBe(520);

    // iOS keeps the native Modal's children mounted through the dismissal
    // animation, so the offset must survive `visible: false` to avoid a
    // snap-back ghost. It is cleared when the sheet opens again.
    sheet.setVisible(false);
    expect(shared.translateY?.value).toBe(520);
    expect(shared.dismissing?.value).toBe(true);

    sheet.setVisible(true);
    expect(shared.translateY?.value).toBe(0);
    expect(shared.dismissing?.value).toBe(false);
    sheet.unmount();
  });
});
