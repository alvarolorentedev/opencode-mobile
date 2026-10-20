import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, it } from 'vitest';

// Migrated from the standalone tests/chat-appearance.test.mjs Node script.
describe('chat appearance preferences', () => {
  it('normalizes transcript font size and keeps flat/slim defaults off', async () => {
    const source = await readFile(new URL('../../providers/opencode-preferences.ts', import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
    const { normalizeTranscriptFontSize, defaultChatPreferences } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

    assert.equal(normalizeTranscriptFontSize(16), 16);
    assert.equal(normalizeTranscriptFontSize(12.4), 12);
    assert.equal(normalizeTranscriptFontSize(11), 12);
    assert.equal(normalizeTranscriptFontSize(25), 24);
    assert.equal(normalizeTranscriptFontSize(Number.NaN), 16);
    assert.equal(normalizeTranscriptFontSize(undefined), 16);

    assert.equal(defaultChatPreferences.flatTranscript, false);
    assert.equal(defaultChatPreferences.slimInterface, false);
    assert.equal(defaultChatPreferences.transcriptVerbosity, 'basic');
  });
});
