import { uiImports } from '../helpers/ui.mjs';
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

const prompt = (id: string, state: 'sending' | 'waiting') => ({
  id,
  sessionId: 'session-1',
  text: `prompt ${id}`,
  createdAt: 1,
  attachments: [],
  delivery: 'steer' as const,
  state,
});

async function mountPendingPrompts(props: {
  cancelingId?: string;
  onCancel: (value: ReturnType<typeof prompt>) => void;
  prompts: ReturnType<typeof prompt>[];
}) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { PendingPrompts } = await loadTs('components/chat/pending-prompts.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { ScrollView: 'ScrollView', StyleSheet: { create: (styles: unknown) => styles }, View: 'View' },

    '@/components/chat/attachment-strip': { AttachmentStrip: 'AttachmentStrip' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'light' },
    '@/hooks/use-palette': { usePalette: () => ({}) },
  }, runtime.globals);
  return runtime.mount(PendingPrompts, props);
}

describe('pending prompts', () => {
  it('offers an active cancel action only for waiting prompts', async () => {
    const waiting = prompt('m1', 'waiting');
    const sending = prompt('m2', 'sending');
    const onCancel = vi.fn();
    const tree = await mountPendingPrompts({ prompts: [waiting, sending], onCancel });

    const waitingClose = findElement(tree, (element) => element.props.testID === 'pending-prompt-cancel-m1');
    expect(waitingClose?.props.disabled).toBe(false);
    waitingClose?.props.onPress();
    expect(onCancel).toHaveBeenCalledWith(waiting);

    const sendingClose = findElement(tree, (element) => element.props.testID === 'pending-prompt-cancel-m2');
    expect(sendingClose?.props.disabled).toBe(true);
  });

  it('replaces the close action with progress while cancellation is in flight', async () => {
    const tree = await mountPendingPrompts({ cancelingId: 'm1', prompts: [prompt('m1', 'waiting')], onCancel: vi.fn() });
    expect(findElement(tree, (element) => element.props.testID === 'pending-prompt-cancel-m1')).toBeUndefined();
  });
});
