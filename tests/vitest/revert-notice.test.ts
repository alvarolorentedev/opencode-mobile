import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

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

async function mountRevertNotice(props: { busy?: boolean; onCancel: () => void }) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { RevertNotice } = await loadTs('components/chat/revert-notice.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { StyleSheet: { create: (styles: unknown) => styles }, View: 'View' },
    'react-native-paper': { IconButton: 'IconButton', Text: 'Text' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'light' },
  }, runtime.globals);
  return runtime.mount(RevertNotice, props);
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
