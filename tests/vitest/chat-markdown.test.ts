import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type MarkdownElement = {
  type: unknown;
  props: {
    onCopyPress?: (event: { code: string; language: string }) => void;
  };
};

async function mountMarkdown() {
  const runtime = hookRuntime();
  const haptic = vi.fn();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { MarkdownText } = await loadTs('components/chat/chat-markdown.tsx', {
    react: { ...runtime.react, memo: (component: unknown) => component },
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-native': { Linking: { openURL: vi.fn(() => Promise.resolve()) } },
    'react-native-enriched-markdown': { EnrichedMarkdownText: 'EnrichedMarkdownText' },
    '@/lib/haptics': { codeCopyHaptic: haptic },
  }, runtime.globals);
  const value = runtime.mount(MarkdownText, {
    text: '```bash\necho hi\n```',
    color: '#182320',
    fontSize: 16,
    mutedColor: '#667874',
  }) as MarkdownElement;
  return { haptic, value };
}

describe('chat markdown code block copy', () => {
  it('fires a haptic acknowledgement after the native copy succeeds', async () => {
    const { haptic, value } = await mountMarkdown();

    value.props.onCopyPress?.({ code: 'echo hi', language: 'bash' });

    expect(haptic).toHaveBeenCalledTimes(1);
  });
});
