// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import { ListRow } from '@/shared/ui/list-row';
import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: ({ web }: { web?: unknown }) => web },
  Pressable: 'Pressable', View: 'View', Text: 'Text',
}));
vi.mock('@rn-primitives/slot', () => ({ Slot: 'Slot' }));
vi.mock('uniwind', () => ({ Uniwind: {} }));

describe('list row class composition', () => {
  // Worktree manage rows rely on flex-1 so the trailing remove button stays
  // on-screen. Dropping the caller class puts it past the row on native.
  it('keeps the caller className alongside the row defaults', () => {
    const { result } = renderHook(ListRow, { title: 'demo', className: 'flex-1' });
    const rendered = result.current;
    expect(rendered.props.className).toContain('min-h-target');
    expect(rendered.props.className).toContain('flex-1');
  });
});
