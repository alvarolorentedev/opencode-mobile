// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import { useOverlayWidth } from '@/shared/ui/hooks/use-overlay-width';
import { renderHook } from '../../../tests/helpers/render-hook';

const device = vi.hoisted(() => ({ width: 390, insets: { top: 0, right: 10, bottom: 0, left: 10 } }));
vi.mock('react-native', () => ({ useWindowDimensions: () => ({ width: device.width, height: 844, fontScale: 1, scale: 1 }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => device.insets }));

describe('useOverlayWidth', () => {
  it('keeps the panel inside the safe window', () => {
    expect(renderHook(useOverlayWidth, Infinity).result.current).toBe(354);
  });

  it('caps wide dialogs at their maximum', () => {
    device.width = 800;
    device.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(renderHook(useOverlayWidth, 512).result.current).toBe(512);
  });
});
