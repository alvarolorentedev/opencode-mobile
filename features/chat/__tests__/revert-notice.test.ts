// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import { RevertNotice } from '@/features/chat/ui/revert-notice';
import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: ({ web }: { web?: unknown }) => web },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('@rn-primitives/slot', () => ({ Slot: 'Slot' }));
vi.mock('uniwind', () => ({ Uniwind: {}, withUniwind: (component: unknown) => component }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: Object.assign(() => null, { glyphMap: {} }) }));

type Element = { type: unknown; props: Record<string, any> };

function findElement(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as Element;
  if (element.props && predicate(element)) return element;
  return findElement(element.props?.children, predicate);
}

function mountRevertNotice(props: Parameters<typeof RevertNotice>[0]) {
  return renderHook(RevertNotice, props).result.current;
}

describe('revert notice', () => {
  it('cancels the staged revert from its close action', async () => {
    const onCancel = vi.fn();
    const tree = await mountRevertNotice({ onCancel });
    const close = findElement(tree, (element) => element.props.testID === 'chat-revert-cancel');
    expect(close).toBeTruthy();
    expect(close?.props.disabled).toBe(false);
    close?.props.onPress();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables the close action while the revert is being cleared', async () => {
    const tree = await mountRevertNotice({ busy: true, onCancel: vi.fn() });
    const close = findElement(tree, (element) => element.props.testID === 'chat-revert-cancel');
    expect(close?.props.disabled).toBe(true);
  });
});
