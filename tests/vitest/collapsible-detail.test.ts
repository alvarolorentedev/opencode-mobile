import { describe, expect, it } from 'vitest';

import * as transcript from '@/lib/opencode/transcript';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: { children?: unknown; text?: string; selectable?: boolean; onPress?: () => void } };

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

async function mountDetail(group: transcript.DetailGroup) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { CollapsibleDetail } = await loadTs('components/chat/cards/collapsible-detail.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-native': {
      Platform: { select: (options: Record<string, unknown>) => options.default },
      Pressable: 'Pressable',
      StyleSheet: { create: (value: unknown) => value },
      View: 'View',
    },
    'react-native-paper': { Text: 'Text' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@/components/chat/chat-markdown': { MarkdownText: 'MarkdownText' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/lib/opencode/transcript': { isShellTool: transcript.isShellTool },
  }, runtime.globals);
  runtime.mount(CollapsibleDetail, { flat: false, fontSize: 16, group, palette: {} });
  return runtime;
}

const shellGroup: transcript.DetailGroup = {
  key: 'shell-1',
  kind: 'tool',
  tool: 'bash',
  details: [
    { id: 'a', kind: 'tool', tool: 'bash', command: 'git status --short', label: 'bash', body: ' M a.ts', status: 'completed' },
    { id: 'b', kind: 'tool', tool: 'bash', command: 'pnpm lint', label: 'bash', body: 'No output', status: 'completed' },
  ],
};

describe('collapsible transcript details', () => {
  it('renders a shell group as one non-copyable command + result block', async () => {
    const runtime = await mountDetail(shellGroup);
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'Running pnpm lint')).toBe(true);

    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();

    const expected = '$ git status --short\n M a.ts\n\n$ pnpm lint\nNo output';
    const body = find(runtime.value, 'Text').find((node) => node.props.children === expected);
    expect(body?.props.selectable).toBe(false);
    expect(find(runtime.value, 'MarkdownText')).toHaveLength(0);
  });

  it('renders non-shell groups with markdown', async () => {
    const runtime = await mountDetail({
      key: 'reasoning-1',
      kind: 'reasoning',
      details: [{ id: 'r', kind: 'reasoning', label: 'Reasoning', body: 'thinking' }],
    });
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'MarkdownText')[0]?.props.text).toBe('thinking');
  });
});
