// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ActivityDiffCard } from '@/features/chat/ui/cards/activity-diff';
import { Text } from '@/shared/ui/text';
import { Colors } from '@/shared/ui/theme/theme';

import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'android' }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
type Element = { type: unknown; props: { children?: unknown; onPress?: () => void; accessibilityState?: { expanded?: boolean } } };

function find(node: unknown, type: unknown, out: Element[] = []) {
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

const baseDiff = { file: 'src/a.ts', patch: '@@ -1,2 +1,2 @@\n-old\n+new\n same', additions: 1, deletions: 1, status: 'modified' as const };

const diffProps = (diff: typeof baseDiff) => ({ diff, fontSize: 16, palette: Colors.light });

function mountDiff(diff: typeof baseDiff) {
  return renderHook(ActivityDiffCard, diffProps(diff));
}

function textValue(node: Element) {
  return Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children;
}

describe('activity diff card', () => {
  it('shows file stats and expands the unified diff', async () => {
    const runtime = mountDiff(baseDiff);

    const texts = () => find(runtime.result.current, Text);
    expect(texts().some((node) => textValue(node) === 'src/a.ts')).toBe(true);
    expect(texts().some((node) => textValue(node) === '+1')).toBe(true);
    expect(texts().some((node) => textValue(node) === '−1')).toBe(true);

    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    expect(find(runtime.result.current, 'Pressable')[0].props.accessibilityState?.expanded).toBe(true);
    expect(texts().some((node) => textValue(node) === 'old')).toBe(true);
    expect(texts().some((node) => textValue(node) === 'new')).toBe(true);
  });

  it('resets expansion when the row is recycled to another file', async () => {
    const runtime = mountDiff(baseDiff);
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    expect(find(runtime.result.current, 'Pressable')[0].props.accessibilityState?.expanded).toBe(true);

    runtime.rerender(diffProps({ ...baseDiff, file: 'src/b.ts', patch: '@@ -1 +1 @@\n-before\n+after' }));
    expect(find(runtime.result.current, 'Pressable')[0].props.accessibilityState?.expanded).toBe(false);
    expect(find(runtime.result.current, Text).some((node) => textValue(node) === 'before')).toBe(false);
  });
});
