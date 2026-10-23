import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type MarkdownElement = {
  type: unknown;
  props: {
    markdownStyle?: {
      blockquote?: { backgroundColor?: string };
      codeBlock?: {
        backgroundColor?: string;
        color?: string;
        syntaxColors?: { keyword?: string };
      };
    };
    onCopyPress?: (event: { code: string; language: string }) => void;
  };
};

const codePalette = {
  background: '#E7EFEA',
  border: '#D6E1DC',
  syntax: {
    keyword: '#CF222E',
    string: '#0A3069',
    number: '#0550AE',
    constant: '#0550AE',
    comment: '#6E7781',
    function: '#8250DF',
    type: '#953800',
    property: '#0550AE',
    tag: '#116329',
    attribute: '#0550AE',
  },
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
    codePalette,
    text: '```bash\necho hi\n```',
    color: '#182320',
    fontSize: 16,
    mutedColor: '#667874',
  }) as MarkdownElement;
  return { haptic, value };
}

describe('chat markdown code blocks', () => {
  it('fires a haptic acknowledgement after the native copy succeeds', async () => {
    const { haptic, value } = await mountMarkdown();

    value.props.onCopyPress?.({ code: 'echo hi', language: 'bash' });

    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('uses the supplied opaque code surface and clears the blockquote fill', async () => {
    const { value } = await mountMarkdown();

    expect(value.props.markdownStyle?.codeBlock).toMatchObject({
      backgroundColor: codePalette.background,
      color: '#182320',
      syntaxColors: { keyword: codePalette.syntax.keyword },
    });
    expect(value.props.markdownStyle?.codeBlock?.backgroundColor).not.toMatch(/^rgba?\(/);
    expect(value.props.markdownStyle?.blockquote?.backgroundColor).toBe('transparent');
  });
});
