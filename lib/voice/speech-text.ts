import { applySpeechLexicon } from '@/lib/voice/speech-lexicon';
import type { SpeechCues } from '@/lib/voice/speech-types';

const DEFAULT_CODE_BLOCK_CUE = ' Code block omitted. ';
const DEFAULT_TABLE_CUE = ' Table omitted. ';
const MAX_CHUNK_CHARS = 450;
const MIN_CHUNK_CHARS = 80;

const SPEECH_CUES: Record<string, { codeBlock: string; table: string }> = {
  de: { codeBlock: 'Codeblock ausgelassen.', table: 'Tabelle ausgelassen.' },
  en: { codeBlock: 'Code block omitted.', table: 'Table omitted.' },
  es: { codeBlock: 'Bloque de código omitido.', table: 'Tabla omitida.' },
  fr: { codeBlock: 'Bloc de code omis.', table: 'Tableau omis.' },
  hi: { codeBlock: 'कोड ब्लॉक छोड़ा गया।', table: 'तालिका छोड़ी गई।' },
  ja: { codeBlock: 'コードブロックは省略しました。', table: '表は省略しました。' },
  pt: { codeBlock: 'Bloco de código omitido.', table: 'Tabela omitida.' },
  ru: { codeBlock: 'Блок кода пропущен.', table: 'Таблица пропущена.' },
  zh: { codeBlock: '已省略代码块。', table: '已省略表格。' },
};

export function getSpeechCues(language?: string) {
  const code = language?.toLowerCase().split(/[-_]/)[0];
  const cues = code ? SPEECH_CUES[code] : undefined;
  return {
    codeBlock: ` ${cues?.codeBlock ?? SPEECH_CUES.en.codeBlock} `,
    table: ` ${cues?.table ?? SPEECH_CUES.en.table} `,
  };
}

const EMOJI_PATTERN = /(?:[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF])/g;
const FILE_EXTENSIONS = new Set([
  'css', 'go', 'html', 'js', 'json', 'jsx', 'kt', 'md', 'py', 'rs', 'sh', 'swift',
  'toml', 'ts', 'tsx', 'txt', 'yaml', 'yml',
]);
const IDENTITY_WORDS = new Set(['iPhone', 'iPad', 'iPod', 'macOS', 'iOS']);

function replaceTables(text: string, cue: string) {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const separator = lines[index + 1];
    const looksLikeTable = line.includes('|')
      && separator
      && separator.includes('-')
      && /^\s*\|?[\s:|-]+\|?\s*$/.test(separator);

    if (!looksLikeTable) {
      output.push(line);
      continue;
    }

    index += 1;
    while (index + 1 < lines.length && lines[index + 1].includes('|')) {
      index += 1;
    }
    output.push(cue);
  }

  return output.join('\n');
}

function splitCamelCase(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

function formatFileToken(token: string) {
  const extensionMatch = token.match(/\.([A-Za-z0-9]+)$/);
  const extension = extensionMatch?.[1].toLowerCase();
  const rawBase = extension ? token.slice(0, -(extension.length + 1)) : token;
  const base = rawBase.replace(/^(?:\.{0,2}\/)+/, '').replace(/\//g, ' ');
  const words = splitCamelCase(base.replace(/[_-]/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!extension || !FILE_EXTENSIONS.has(extension)) {
    return words;
  }

  return `${words} dot ${extension.toUpperCase().split('').join(' ')}`;
}

function formatPathsAndIdentifiers(text: string) {
  let next = text;

  // Paths with at least one slash. URLs are already replaced with "link" before
  // this runs, so this only catches local files and directories.
  next = next.replace(
    /(^|[\s(])((?:\.{0,2}\/|\/)[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/g,
    (_match, prefix: string, value: string) => `${prefix}${formatFileToken(value)}`,
  );

  // File names with known extensions, including extensionless paths above.
  next = next.replace(
    /\b([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:css|go|html|js|json|jsx|kt|md|py|rs|sh|swift|toml|ts|tsx|txt|yaml|yml))\b/g,
    (value) => formatFileToken(value),
  );

  // snake_case identifiers.
  next = next.replace(/\b([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\b/g, (value) => value.replace(/_/g, ' '));

  // camelCase identifiers, with a small deny list for product names.
  next = next.replace(/\b([a-z]+(?:[A-Z][a-z0-9]+)+)\b/g, (value) => (
    IDENTITY_WORDS.has(value) ? value : splitCamelCase(value)
  ));

  return next;
}

/**
 * Turn assistant markdown into prose that sounds right when read aloud. The
 * result keeps paragraph boundaries so the speaker can insert natural pauses.
 */
export function normalizeSpeechText(text: string, cues: SpeechCues = {}) {
  const codeBlockCue = cues.codeBlock ?? DEFAULT_CODE_BLOCK_CUE;
  const tableCue = cues.table ?? DEFAULT_TABLE_CUE;

  let next = text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?(?:```|$)/g, codeBlockCue)
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, codeBlockCue);

  next = replaceTables(next, tableCue);

  next = next
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => alt || 'image')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(?:https?:\/\/|www\.)[^\s)]+/gi, 'link')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(EMOJI_PATTERN, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  next = formatPathsAndIdentifiers(next);
  next = applySpeechLexicon(next);

  return next
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hardSplit(value: string, maxChars: number) {
  const parts: string[] = [];
  let remaining = value.trim();

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const breakAt = Math.max(window.lastIndexOf(' '), window.lastIndexOf('，'), window.lastIndexOf(','));
    const splitAt = breakAt > maxChars * 0.5 ? breakAt : maxChars;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

function splitSentences(paragraph: string) {
  return (paragraph.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) ?? [paragraph])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Split long text into paragraph-first chunks. Keeping whole paragraphs
 * together preserves the engine's own sentence prosody; only long paragraphs
 * are split at sentence boundaries.
 */
export function splitSpeechText(text: string, maxChars = MAX_CHUNK_CHARS) {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }

    let current = '';
    for (const sentence of splitSentences(paragraph)) {
      if (sentence.length > maxChars) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        chunks.push(...hardSplit(sentence, maxChars));
        continue;
      }

      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        if (current) {
          chunks.push(current);
        }
        current = sentence;
      }
    }
    if (current) {
      chunks.push(current);
    }
  }

  // Merge tiny trailing fragments so the speaker does not add an awkward gap
  // before a single word.
  const merged: string[] = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (previous && (chunk.length < MIN_CHUNK_CHARS || previous.length < MIN_CHUNK_CHARS)
      && previous.length + chunk.length + 1 <= maxChars) {
      merged[merged.length - 1] = `${previous} ${chunk}`;
    } else {
      merged.push(chunk);
    }
  }

  return merged.filter(Boolean);
}

export function prepareSpeechText(
  text: string,
  options: { cues?: SpeechCues; language?: string; maxChars?: number } = {},
) {
  const languageCues = getSpeechCues(options.language);
  const normalized = normalizeSpeechText(text, options.cues ?? languageCues);
  return {
    text: normalized,
    chunks: normalized ? splitSpeechText(normalized, options.maxChars) : [],
  };
}
