import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

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

async function loadSwipeDismiss() {
  const runtime = hookRuntime();
  // `useSharedValue` is backed by a real ref slot so the value persists across
  // renders, matching Reanimated instead of resetting on every render.
  const shared: { translateY?: Shared; dismissing?: Shared } = {};
  const { useSwipeDismiss } = await loadTs('shared/ui/use-swipe-dismiss.ts', {
    react: runtime.react,
    'react-native-gesture-handler': { Gesture: { Pan: createPanMock } },
    'react-native-reanimated': {
      __esModule: true,
      runOnJS: (fn: () => void) => fn,
      useAnimatedStyle: () => ({}),
      useSharedValue: (value: unknown) => {
        const held = runtime.react.useRef({ value }).current as Shared;
        if (typeof value === 'number') shared.translateY = held;
        else shared.dismissing = held;
        return held;
      },
      withSpring: (value: unknown) => value,
      withTiming: (value: unknown, _config: unknown, callback?: (finished: boolean) => void) => {
        callback?.(true);
        return value;
      },
    },
  });
  return { runtime, useSwipeDismiss, shared };
}

type Handlers = {
  handleSheetLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
  pan: { update: (event: { translationY: number }) => void; end: (event: { velocityY: number }) => void };
};

// Mount, measure the sheet, and return the handlers from the render that has the
// measured height (the pan closure captures `sheetHeight` at creation).
function mountSheet(
  runtime: ReturnType<typeof hookRuntime>,
  useSwipeDismiss: unknown,
  onDismiss: () => void,
  height = 400,
) {
  runtime.mount(useSwipeDismiss, { visible: true, enabled: true, onDismiss });
  (runtime.value as unknown as Handlers).handleSheetLayout({ nativeEvent: { layout: { height } } });
  runtime.flush();
  return runtime.value as unknown as Handlers;
}

describe('useSwipeDismiss', () => {
  it('dismisses once the drag passes the distance threshold', async () => {
    const { runtime, useSwipeDismiss } = await loadSwipeDismiss();
    const onDismiss = vi.fn();
    const sheet = mountSheet(runtime, useSwipeDismiss, onDismiss);

    sheet.pan.update({ translationY: 200 });
    sheet.pan.end({ velocityY: 0 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    runtime.unmount();
  });

  it('dismisses on a fast fling even below the distance threshold', async () => {
    const { runtime, useSwipeDismiss } = await loadSwipeDismiss();
    const onDismiss = vi.fn();
    const sheet = mountSheet(runtime, useSwipeDismiss, onDismiss);

    sheet.pan.update({ translationY: 20 });
    sheet.pan.end({ velocityY: 1000 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    runtime.unmount();
  });

  it('snaps back when the drag is short and slow', async () => {
    const { runtime, useSwipeDismiss } = await loadSwipeDismiss();
    const onDismiss = vi.fn();
    const sheet = mountSheet(runtime, useSwipeDismiss, onDismiss);

    sheet.pan.update({ translationY: 40 });
    sheet.pan.end({ velocityY: 0 });

    expect(onDismiss).not.toHaveBeenCalled();
    runtime.unmount();
  });

  it('keeps the offset during dismissal and resets it on the next open', async () => {
    const { runtime, useSwipeDismiss, shared } = await loadSwipeDismiss();
    const onDismiss = vi.fn();
    const sheet = mountSheet(runtime, useSwipeDismiss, onDismiss);

    sheet.pan.update({ translationY: 200 });
    sheet.pan.end({ velocityY: 0 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(shared.translateY?.value).toBe(520);

    // iOS keeps the native Modal's children mounted through the dismissal
    // animation, so the offset must survive `visible: false` to avoid a
    // snap-back ghost. It is cleared when the sheet opens again.
    runtime.update({ visible: false });
    expect(shared.translateY?.value).toBe(520);
    expect(shared.dismissing?.value).toBe(true);

    runtime.update({ visible: true });
    expect(shared.translateY?.value).toBe(0);
    expect(shared.dismissing?.value).toBe(false);
    runtime.unmount();
  });
});
