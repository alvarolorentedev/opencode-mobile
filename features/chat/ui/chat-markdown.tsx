import { memo, useCallback, useMemo } from 'react';
import { Linking } from 'react-native';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';

import type { CodePalette } from '@/shared/ui/theme/theme';
import { copyHaptic } from '@/shared/platform/haptics';

const allowedLinkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function openMarkdownLink(url: string) {
  try {
    if (!allowedLinkProtocols.has(new URL(url).protocol.toLowerCase())) {
      return;
    }
  } catch {
    return;
  }

  void Linking.openURL(url).catch(() => undefined);
}

type MarkdownTextProps = {
  codePalette: CodePalette;
  color: string;
  fontSize: number;
  mutedColor: string;
  text: string;
};

function MarkdownTextImpl({ text, color, fontSize, mutedColor, codePalette }: MarkdownTextProps) {
  const scale = fontSize / 16;
  const handleCopyPress = useCallback(() => {
    copyHaptic();
  }, []);
  const markdownStyle = useMemo<MarkdownStyle>(() => ({
    paragraph: { fontSize, color, lineHeight: 26 * scale },
    h1: { fontSize: 24 * scale, fontWeight: '700', color },
    h2: { fontSize: 18 * scale, fontWeight: '700', color },
    h3: { fontSize: 16 * scale, fontWeight: '700', color },
    h4: { fontSize: 15 * scale, fontWeight: '700', color },
    h5: { fontSize: 14 * scale, fontWeight: '700', color },
    h6: { fontSize: 13 * scale, fontWeight: '700', color },
    list: { fontSize, color, lineHeight: 26 * scale, bulletColor: color, markerColor: color, gapWidth: 10 },
    link: { color, underline: true },
    code: { fontSize: 15 * scale, color, backgroundColor: 'rgba(0,0,0,0.08)' },
    codeBlock: {
      fontSize: 15 * scale,
      lineHeight: 18 * scale,
      color,
      backgroundColor: codePalette.background,
      borderColor: codePalette.border,
      syntaxColors: codePalette.syntax,
      padding: 14,
      borderRadius: 14,
    },
    // Clear the renderer's light default so dark-theme blockquotes and the
    // nested code spans drawn over them stay dark.
    blockquote: { color, fontSize: 15 * scale, borderColor: mutedColor, borderWidth: 3, backgroundColor: 'transparent' },
    table: {
      fontSize: 15 * scale,
      lineHeight: 20 * scale,
      color,
      borderColor: mutedColor,
      borderRadius: 8,
      headerBackgroundColor: 'rgba(0,0,0,0.08)',
      headerTextColor: color,
      rowEvenBackgroundColor: 'transparent',
      rowOddBackgroundColor: 'rgba(0,0,0,0.04)',
      cellPaddingHorizontal: 8,
      cellPaddingVertical: 6,
    },
    thematicBreak: { color: mutedColor },
  }), [codePalette, color, fontSize, mutedColor, scale]);

  return (
    <EnrichedMarkdownText
      markdown={text}
      flavor="github"
      selectable
      containerStyle={{ alignSelf: 'stretch', minWidth: 0 }}
      markdownStyle={markdownStyle}
      onLinkPress={({ url }) => openMarkdownLink(url)}
      onCopyPress={handleCopyPress}
    />
  );
}

// Keep the transcript boundary memoized; only the active streaming message
// changes text on each server delta.
export const MarkdownText = memo(MarkdownTextImpl);
