// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import { MarkdownText } from '@/features/chat/ui/chat-markdown';
import { renderHook } from '../../../tests/helpers/render-hook';

const { selectionAsync: haptic } = vi.hoisted(() => ({ selectionAsync: vi.fn(async () => {}) }));
vi.mock('react-native', () => ({ Linking: { openURL: async () => {} } }));
vi.mock('react-native-enriched-markdown', () => ({ EnrichedMarkdownText: 'EnrichedMarkdownText' }));
vi.mock('expo-haptics', () => ({ notificationAsync: haptic, NotificationFeedbackType: { Success: 'success' } }));

type MarkdownElement = {
  type: unknown;
  props: {
    markdown?: string;
    markdownStyle?: {
      blockquote?: { backgroundColor?: string };
      codeBlock?: {
        backgroundColor?: string;
        color?: string;
        syntaxColors?: { keyword?: string };
      };
      linkVariants?: Record<string, { color?: string; fontWeight?: string; underline?: boolean }>;
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

function mountMarkdown(text = '```bash\necho hi\n```') {
  haptic.mockClear();
  const component = (MarkdownText as unknown as { type: typeof MarkdownText }).type;
  const { result } = renderHook(component, {
    codePalette,
    text,
    color: '#182320',
    fontSize: 16,
    mutedColor: '#667874',
    tokenColor: '#007A5C',
  });
  return { haptic, value: result.current as MarkdownElement };
}

describe('chat markdown code blocks', () => {
  it('fires a haptic acknowledgement after the native copy succeeds', async () => {
    const { haptic, value } = mountMarkdown();

    value.props.onCopyPress?.({ code: 'echo hi', language: 'bash' });

    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('uses the supplied opaque code surface and clears the blockquote fill', async () => {
    const { value } = mountMarkdown();

    expect(value.props.markdownStyle?.codeBlock).toMatchObject({
      backgroundColor: codePalette.background,
      color: '#182320',
      syntaxColors: { keyword: codePalette.syntax.keyword },
    });
    expect(value.props.markdownStyle?.codeBlock?.backgroundColor).not.toMatch(/^rgba?\(/);
    expect(value.props.markdownStyle?.blockquote?.backgroundColor).toBe('transparent');
  });

  it('styles transcript tokens as bold accent links', async () => {
    const { value } = mountMarkdown();

    expect(value.props.markdownStyle?.linkVariants).toMatchObject({
      '^mention:': { color: '#007A5C', fontWeight: 'bold', underline: false },
      '^command:': { color: '#007A5C', fontWeight: 'bold', underline: false },
    });
  });

  it('wraps transcript tokens before rendering', async () => {
    const { value } = mountMarkdown('Use @general');

    expect(value.props.markdown).toBe('Use [@general](mention://x)');
  });
});
