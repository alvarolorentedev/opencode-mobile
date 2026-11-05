import { describe, expect, it } from 'vitest';

import { uiImports } from '../../../tests/helpers/ui.mjs';
import { loadTs } from '../../../tests/helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
const element = (type: unknown, props: Element['props']) => ({ type, props });
const jsx = { jsx: element, jsxs: element };

const { ListRow } = await loadTs('shared/ui/list-row.tsx', {
  ...uiImports,
  'react-native': {
    Pressable: (props: Element['props']) => element('Pressable', props),
    View: (props: Element['props']) => element('View', props),
  },
  '@/shared/ui/theme/use-palette': { usePalette: () => ({ muted: '#999999' }) },
  'react/jsx-runtime': jsx,
});

describe('list row class composition', () => {
  // Worktree manage rows rely on flex-1 so the trailing remove button stays
  // on-screen. Dropping the caller class puts it past the row on native.
  it('keeps the caller className alongside the row defaults', () => {
    const rendered = ListRow({ title: 'demo', className: 'flex-1' });
    expect(rendered.props.className).toContain('min-h-target');
    expect(rendered.props.className).toContain('flex-1');
  });
});
