import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

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

async function loadSwipeDismiss() {
  const runtime = hookRuntime();
  const { useSwipeDismiss } = await loadTs('components/ui/use-swipe-dismiss.ts', {
    react: runtime.react,
    'react-native-gesture-handler': { Gesture: { Pan: createPanMock } },
    'react-native-reanimated': {
      __esModule: true,
      runOnJS: (fn: () => void) => fn,
      useAnimatedStyle: () => ({}),
      useSharedValue: (value: unknown) => ({ value }),
      withSpring: (value: unknown) => value,
      withTiming: (value: unknown, _config: unknown, callback?: (finished: boolean) => void) => {
        callback?.(true);
        return value;
      },
    },
  });
  return { runtime, useSwipeDismiss };
}

type Handlers = {
  handleSheetLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
  pan: { update: (event: { translationY: number }) => void; end: (event: { velocityY: number }) => void };
};

describe('useSwipeDismiss', () => {
  it('dismisses once the drag passes the distance threshold', async () => {
    const { runtime, useSwipeDismiss } = await loadSwipeDismiss();
    const onDismiss = vi.fn();
    runtime.mount(useSwipeDismiss, { visible: true, enabled: true, onDismiss });
    const sheet = runtime.value as unknown as Handlers;

    sheet.handleSheetLayout({ nativeEvent: { layout: { height: 400 } } });
    runtime.flush();

    sheet.pan.update({ translationY: 200 });
    sheet.pan.end({ velocityY: 0 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    runtime.unmount();
  });

  it('dismisses on a fast fling even below the distance threshold', async () => {
    const { runtime, useSwipeDismiss } = await loadSwipeDismiss();
    const onDismiss = vi.fn();
    runtime.mount(useSwipeDismiss, { visible: true, enabled: true, onDismiss });
    const sheet = runtime.value as unknown as Handlers;

    sheet.handleSheetLayout({ nativeEvent: { layout: { height: 400 } } });
    runtime.flush();

    sheet.pan.update({ translationY: 20 });
    sheet.pan.end({ velocityY: 1000 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    runtime.unmount();
  });

  it('snaps back when the drag is short and slow', async () => {
    const { runtime, useSwipeDismiss } = await loadSwipeDismiss();
    const onDismiss = vi.fn();
    runtime.mount(useSwipeDismiss, { visible: true, enabled: true, onDismiss });
    const sheet = runtime.value as unknown as Handlers;

    sheet.handleSheetLayout({ nativeEvent: { layout: { height: 400 } } });
    runtime.flush();

    sheet.pan.update({ translationY: 40 });
    sheet.pan.end({ velocityY: 0 });

    expect(onDismiss).not.toHaveBeenCalled();
    runtime.unmount();
  });
});
