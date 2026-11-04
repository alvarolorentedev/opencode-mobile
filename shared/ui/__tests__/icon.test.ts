import { describe, expect, it } from 'vitest';

import { uiImports } from '../../../tests/helpers/ui.mjs';
import { loadTs } from '../../../tests/helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
const element = (type: unknown, props: Element['props']) => ({ type, props });
const jsx = { jsx: element, jsxs: element };
const MaterialCommunityIcons = (props: Record<string, any>) => element('MaterialCommunityIcons', props);
MaterialCommunityIcons.glyphMap = { check: 1 };

const { Icon } = await loadTs('shared/ui/icon.tsx', {
  ...uiImports,
  react: { useContext: () => undefined },
  'react-i18next': { useTranslation: () => ({ i18n: { resolvedLanguage: 'en' } }) },
  'react/jsx-runtime': jsx,
  '@expo/vector-icons/MaterialCommunityIcons': { __esModule: true, default: MaterialCommunityIcons },
  uniwind: { withUniwind: () => (props: Element['props']) => element('StyledIcon', props) },
});

describe('icon sizing', () => {
  it('lets an explicit size define the glyph box instead of clipping it to the default', () => {
    const rendered = Icon({ name: 'check', size: 24 });
    expect(rendered.props.size).toBe(24);
    expect(rendered.props.className).not.toContain('size-5');
  });

  it('keeps the default box when the caller relies on class-based sizing', () => {
    const rendered = Icon({ name: 'check' });
    expect(rendered.props.size).toBeUndefined();
    expect(rendered.props.className).toContain('size-5');
  });
});
