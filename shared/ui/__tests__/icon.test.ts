// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import { Icon } from '@/shared/ui/icon';
import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({
  default: Object.assign(() => null, { glyphMap: { check: 1 } }),
}));
vi.mock('uniwind', () => ({ withUniwind: (component: unknown) => component }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: 'en' } }) }));
vi.mock('react-native', () => ({ Platform: { OS: 'web', select: ({ web }: { web?: unknown }) => web }, Text: 'Text' }));
vi.mock('@rn-primitives/slot', () => ({ Slot: 'Slot' }));

describe('icon sizing', () => {
  it('lets an explicit size define the glyph box instead of clipping it to the default', () => {
    const { result } = renderHook(Icon, { name: 'check', size: 24 });
    const rendered = result.current;
    expect(rendered.props.size).toBe(24);
    expect(rendered.props.className).not.toContain('size-5');
  });

  it('keeps the default box when the caller relies on class-based sizing', () => {
    const { result } = renderHook(Icon, { name: 'check' });
    const rendered = result.current;
    expect(rendered.props.size).toBeUndefined();
    expect(rendered.props.className).toContain('size-5');
  });
});
