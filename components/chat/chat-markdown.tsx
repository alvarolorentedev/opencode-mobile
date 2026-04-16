import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

function renderInlineMarkdown(text: string, color: string, codeColor: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <Text key={`inline-${index}`} style={[styles.inlineCode, { color: codeColor }]}>
          {part.slice(1, -1)}
        </Text>
      );
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={`inline-${index}`} style={{ color, fontWeight: '700' }}>
          {part.slice(2, -2)}
        </Text>
      );
    }

    return (
      <Text key={`inline-${index}`} style={{ color }}>
        {part}
      </Text>
    );
  });
}

export function MarkdownText({ text, color, mutedColor }: { text: string; color: string; mutedColor: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let codeBlock: string[] = [];
  let inCodeBlock = false;

  function pushParagraph() {
    if (paragraph.length === 0) {
      return;
    }

    const content = paragraph.join(' ').trim();
    if (content) {
      blocks.push(
        <Text
          key={`p-${blocks.length}`}
          variant="bodyLarge"
          style={{ color, lineHeight: 26, flexShrink: 1, minWidth: 0 }}>
          {renderInlineMarkdown(content, color, mutedColor)}
        </Text>,
      );
    }
    paragraph = [];
  }

  function pushCodeBlock() {
    if (codeBlock.length === 0) {
      return;
    }

    blocks.push(
      <View key={`code-${blocks.length}`} style={styles.codeBlock}>
        <Text variant="bodySmall" style={[styles.code, { color }]}>
          {codeBlock.join('\n')}
        </Text>
      </View>,
    );
    codeBlock = [];
  }

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        pushCodeBlock();
      } else {
        pushParagraph();
      }
      inCodeBlock = !inCodeBlock;
      return;
    }

    if (inCodeBlock) {
      codeBlock.push(line);
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      pushParagraph();
      blocks.push(
        <Text
          key={`h-${blocks.length}`}
          variant={heading[1].length === 1 ? 'headlineSmall' : 'titleMedium'}
          style={{ color, fontWeight: '700' }}>
          {heading[2]}
        </Text>,
      );
      return;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      pushParagraph();
      blocks.push(
      <View key={`b-${blocks.length}`} style={styles.markdownBulletRow}>
          <Text style={{ color }}>{'\u2022'}</Text>
          <Text variant="bodyLarge" style={[styles.markdownBulletText, { color, lineHeight: 26, flexShrink: 1, minWidth: 0 }]}> 
            {renderInlineMarkdown(bullet[1], color, mutedColor)}
          </Text>
        </View>,
      );
      return;
    }

    if (!line.trim()) {
      pushParagraph();
      return;
    }

    paragraph.push(line.trim());
  });

  pushParagraph();
  pushCodeBlock();

  return <View style={styles.markdownStack}>{blocks}</View>;
}

const styles = StyleSheet.create({
  markdownStack: { gap: 12 },
  markdownBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  markdownBulletText: { flex: 1 },
  inlineCode: {
    fontFamily: 'monospace',
    backgroundColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  codeBlock: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
