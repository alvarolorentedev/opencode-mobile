import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

describe('on-device voice catalog', () => {
  it('ships one Piper model per translated language and one natural English model', async () => {
    const catalog = await loadTs('lib/voice/tts/catalog.ts');
    const packs = catalog.LOCAL_TTS_PACKS as {
      id: string;
      family: string;
      languageCode: string;
      tarballBytes: number;
      tarballSha256: string;
      files: { model: string; tokens: string };
      speakers: { id: number }[];
    }[];

    assert.equal(packs.length, 8);
    assert.equal(packs.filter((pack) => pack.family === 'piper').length, 7);
    assert.equal(packs.filter((pack) => pack.family === 'kokoro').length, 1);
    assert.equal(packs.filter((pack) => pack.family === 'piper' && pack.languageCode === 'en').length, 1);

    for (const language of ['en', 'es', 'hi', 'de', 'fr', 'zh', 'pt']) {
      assert.equal(
        packs.filter((pack) => pack.family === 'piper' && pack.languageCode === language).length,
        1,
        `expected exactly one Piper pack for ${language}`,
      );
    }
    assert.equal(packs.some((pack) => pack.languageCode === 'ja'), false, 'Japanese must stay on system TTS');

    for (const pack of packs) {
      assert.match(pack.tarballSha256, /^[a-f0-9]{64}$/);
      assert.ok(pack.tarballBytes > 1_000_000);
      assert.ok(pack.files.model.length > 0);
      assert.equal(pack.files.tokens, 'tokens.txt');
      assert.ok(pack.speakers.length > 0);
    }

    const kokoro = packs.find((pack) => pack.family === 'kokoro');
    assert.ok(kokoro);
    assert.equal(kokoro.speakers.length, 11);

    assert.equal(catalog.normalizeLocalTtsPackId('piper-es'), 'piper-es');
    assert.equal(catalog.normalizeLocalTtsPackId('not-a-pack'), undefined);
    assert.equal(catalog.isPackLanguageCompatible(catalog.getLocalTtsPack('piper-es'), 'es-ES'), true);
    assert.equal(catalog.isPackLanguageCompatible(catalog.getLocalTtsPack('piper-es'), 'en-US'), false);
    assert.equal(catalog.isPackLanguageCompatible(catalog.getLocalTtsPack('piper-es')), true);
  });
});
