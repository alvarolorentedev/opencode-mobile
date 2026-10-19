import { describe, expect, it } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: { children?: unknown; text?: string; onPress?: () => void } };

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

async function mountDetail(body: string) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { CollapsibleDetail } = await loadTs('components/chat/cards/collapsible-detail.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-native': { Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value }, View: 'View' },
    'react-native-paper': { Text: 'Text' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@/components/chat/chat-markdown': { MarkdownText: 'MarkdownText' },
    '@/constants/theme': { Colors: { light: {} } },
  }, runtime.globals);
  const props = {
    detail: { id: 'tool-1', kind: 'tool', label: 'Edit app.ts', body, status: 'running' },
    fontSize: 16,
    palette: {},
  };
  runtime.mount(CollapsibleDetail, props);
  return runtime;
}

describe('collapsible transcript details', () => {
  it('starts collapsed and expands the markdown body on press', async () => {
    const runtime = await mountDetail('changed 3 lines');
    const [button] = find(runtime.value, 'Pressable');
    expect(button).toBeTruthy();
    expect(find(runtime.value, 'MarkdownText')).toHaveLength(0);

    button.props.onPress?.();
    runtime.flush();
    const [body] = find(runtime.value, 'MarkdownText');
    expect(body?.props.text).toBe('changed 3 lines');

    const [collapsed] = find(runtime.value, 'Pressable');
    collapsed.props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'MarkdownText')).toHaveLength(0);
  });
});
