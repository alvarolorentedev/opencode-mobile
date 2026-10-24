import { describe, expect, it } from 'vitest';

import * as chatDiff from '@/components/chat/chat-diff';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: { children?: unknown; onPress?: () => void; accessibilityState?: { expanded?: boolean } } };

function find(node: unknown, type: string, out: Element[] = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => find(child, type, out));
    return out;
  }
  const element = node as Element;
  if (element.type === type) out.push(element);
  if (element.props?.children !== undefined) find(element.props.children, type, out);
  return out;
}

describe('activity diff card', () => {
  it('shows file stats and expands the unified diff', async () => {
    const runtime = hookRuntime();
    const element = (type: unknown, props: unknown) => ({ type, props });
    const { ActivityDiffCard } = await loadTs('components/chat/cards/activity-diff.tsx', {
      react: runtime.react,
      'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
      'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
      'react-native': {
        Pressable: 'Pressable',
        StyleSheet: { create: (value: unknown) => value },
        View: 'View',
      },
      'react-native-paper': { Text: 'Text' },
      '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
      '@/components/chat/chat-diff': chatDiff,
      '@/constants/theme': { Colors: { light: {} } },
    }, runtime.globals);

    runtime.mount(ActivityDiffCard, {
      diff: { file: 'src/a.ts', patch: '@@ -1,2 +1,2 @@\n-old\n+new\n same', additions: 1, deletions: 1, status: 'modified' },
      fontSize: 16,
      palette: {},
    });

    const texts = () => find(runtime.value, 'Text');
    const textValue = (node: Element) => Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children;
    expect(texts().some((node) => textValue(node) === 'src/a.ts')).toBe(true);
    expect(texts().some((node) => textValue(node) === '+1')).toBe(true);
    expect(texts().some((node) => textValue(node) === '−1')).toBe(true);

    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'Pressable')[0].props.accessibilityState?.expanded).toBe(true);
    expect(texts().some((node) => textValue(node) === 'old')).toBe(true);
    expect(texts().some((node) => textValue(node) === 'new')).toBe(true);
  });
});
