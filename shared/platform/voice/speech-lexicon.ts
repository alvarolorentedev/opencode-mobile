// Pronunciation rules for words that generic TTS engines read poorly. Keep the
// list small and conservative: whole-word matches only, and no replacements
// that would mangle ordinary prose.

type Term = { pattern: RegExp; replacement: string };

const TERMS: Term[] = [
  { pattern: /\bopencode\b/gi, replacement: 'open code' },
  { pattern: /\bAPI\b/g, replacement: 'A P I' },
  { pattern: /\bJSON\b/g, replacement: 'J S O N' },
  { pattern: /\bYAML\b/g, replacement: 'Y A M L' },
  { pattern: /\bCLI\b/g, replacement: 'C L I' },
  { pattern: /\bSDK\b/g, replacement: 'S D K' },
  { pattern: /\bURL\b/g, replacement: 'U R L' },
  { pattern: /\bURI\b/g, replacement: 'U R I' },
  { pattern: /\bHTML\b/g, replacement: 'H T M L' },
  { pattern: /\bCSS\b/g, replacement: 'C S S' },
  { pattern: /\bSQL\b/g, replacement: 'S Q L' },
  { pattern: /\bHTTP\b/g, replacement: 'H T T P' },
  { pattern: /\bHTTPS\b/g, replacement: 'H T T P S' },
  { pattern: /\bSSH\b/g, replacement: 'S S H' },
  { pattern: /\bUUID\b/g, replacement: 'U U I D' },
  { pattern: /\bMCP\b/g, replacement: 'M C P' },
  { pattern: /\bLSP\b/g, replacement: 'L S P' },
  { pattern: /\bPTY\b/g, replacement: 'P T Y' },
  { pattern: /\bSSE\b/g, replacement: 'S S E' },
  { pattern: /\bSTT\b/g, replacement: 'S T T' },
  { pattern: /\bTTS\b/g, replacement: 'T T S' },
  { pattern: /\bCI\b/g, replacement: 'C I' },
  { pattern: /\bPR\b/g, replacement: 'P R' },
  { pattern: /\bREADME\b/gi, replacement: 'read me' },
  { pattern: /\bsrc\b/g, replacement: 'source' },
  { pattern: /\brepo\b/gi, replacement: 'repository' },
];

const ENGLISH_ABBREVIATIONS: Term[] = [
  { pattern: /\be\.g\./gi, replacement: 'for example' },
  { pattern: /\bi\.e\./gi, replacement: 'that is' },
  { pattern: /\bvs\./gi, replacement: 'versus' },
  { pattern: /\betc\./gi, replacement: 'et cetera' },
];

function applyTerms(text: string, terms: Term[]) {
  let next = text;
  for (const term of terms) {
    next = next.replace(term.pattern, term.replacement);
  }
  return next;
}

/**
 * Expand developer jargon and a few English abbreviations. The result is still
 * normal prose; path and identifier formatting happens in `speech-text.ts`.
 */
export function applySpeechLexicon(text: string, locale?: string) {
  let next = applyTerms(text, TERMS);
  if (!locale || locale.toLowerCase().startsWith('en')) {
    next = applyTerms(next, ENGLISH_ABBREVIATIONS);
  }
  return next;
}
