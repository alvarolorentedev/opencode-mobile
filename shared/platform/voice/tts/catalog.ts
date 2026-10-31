import type { LocalTtsPack, LocalTtsPackId } from '@/shared/platform/voice/tts/types';

const PIPER_LICENSE = {
  label: 'Piper voice model card',
  url: 'https://github.com/rhasspy/piper/blob/master/VOICES.md',
};

const KOKORO_LICENSE = {
  label: 'Kokoro model license',
  url: 'https://huggingface.co/hexgrad/Kokoro-82M/blob/main/LICENSE',
};

function piperPack({
  id,
  file,
  languageCode,
  languageLabel,
  locale,
  tarballBytes,
  tarballSha256,
  archiveDir,
  lexicon,
  dataDir = 'espeak-ng-data',
}: {
  id: LocalTtsPackId;
  file: string;
  languageCode: string;
  languageLabel: string;
  locale: string;
  tarballBytes: number;
  tarballSha256: string;
  archiveDir: string;
  lexicon?: string;
  dataDir?: string;
}): LocalTtsPack {
  return {
    id,
    family: 'piper',
    vendor: 'Piper',
    languageCode,
    locale,
    languageLabel,
    tarballUrl: `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${archiveDir}.tar.bz2`,
    tarballBytes,
    tarballSha256,
    archiveDir,
    modelType: 'vits',
    files: {
      model: file,
      tokens: 'tokens.txt',
      dataDir,
      ...(lexicon ? { lexicon } : {}),
    },
    speakers: [{ id: 0, label: 'Default' }],
    license: PIPER_LICENSE,
  };
}

export const LOCAL_TTS_PACKS: LocalTtsPack[] = [
  piperPack({
    id: 'piper-en',
    file: 'en_US-amy-medium.onnx',
    languageCode: 'en',
    languageLabel: 'English (US)',
    locale: 'en-US',
    tarballBytes: 21028122,
    tarballSha256: 'bd23c0aa629eb3719448582f45ede49e8fa6a679061fed5eab16a6a6fd8e7e82',
    archiveDir: 'vits-piper-en_US-amy-medium-int8',
  }),
  piperPack({
    id: 'piper-es',
    file: 'es_ES-davefx-medium.onnx',
    languageCode: 'es',
    languageLabel: 'Spanish (ES)',
    locale: 'es-ES',
    tarballBytes: 21171632,
    tarballSha256: '8bb8ac1cefb727caec9bd9c6c3185c673c8b42c53bd29bb25d5a7715dac37125',
    archiveDir: 'vits-piper-es_ES-davefx-medium-int8',
  }),
  piperPack({
    id: 'piper-hi',
    file: 'hi_IN-pratham-medium.onnx',
    languageCode: 'hi',
    languageLabel: 'Hindi',
    locale: 'hi-IN',
    tarballBytes: 20987965,
    tarballSha256: '20f568c56207c13b9a0d9478aec8b7d1449122e618aeebc7211f6abc942b58b7',
    archiveDir: 'vits-piper-hi_IN-pratham-medium-int8',
  }),
  piperPack({
    id: 'piper-de',
    file: 'de_DE-thorsten-medium.onnx',
    languageCode: 'de',
    languageLabel: 'German',
    locale: 'de-DE',
    tarballBytes: 20949833,
    tarballSha256: '07e240b7b9c1fc9211d5a69512f8cbe11b3286c2ed79c15c076ac6ed427fdf13',
    archiveDir: 'vits-piper-de_DE-thorsten-medium-int8',
  }),
  piperPack({
    id: 'piper-fr',
    file: 'fr_FR-siwis-medium.onnx',
    languageCode: 'fr',
    languageLabel: 'French',
    locale: 'fr-FR',
    tarballBytes: 20914888,
    tarballSha256: '3909cff9b3cfd4820c66aa13bf554315c82e34899c161f0b446ece372bc4b5ec',
    archiveDir: 'vits-piper-fr_FR-siwis-medium-int8',
  }),
  piperPack({
    id: 'piper-zh',
    file: 'zh_CN-xiao_ya-medium.onnx',
    languageCode: 'zh',
    languageLabel: 'Chinese (Simplified)',
    locale: 'zh-CN',
    tarballBytes: 14016124,
    tarballSha256: 'eab027e194e70289233cf12308373611fa4e2e96ef2d97354ef433ab663d831f',
    archiveDir: 'vits-piper-zh_CN-xiao_ya-medium-int8',
    lexicon: 'lexicon.txt',
    dataDir: undefined,
  }),
  piperPack({
    id: 'piper-pt',
    file: 'pt_BR-faber-medium.onnx',
    languageCode: 'pt',
    languageLabel: 'Portuguese (BR)',
    locale: 'pt-BR',
    tarballBytes: 21336772,
    tarballSha256: 'dbc8b1d7d729fd417ea78a350ed35696c928770ac93513d3f507bd4e88eee3fd',
    archiveDir: 'vits-piper-pt_BR-faber-medium-int8',
  }),
  {
    id: 'kokoro-en',
    family: 'kokoro',
    vendor: 'Kokoro',
    languageCode: 'en',
    locale: 'en-US',
    languageLabel: 'English (US)',
    tarballUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-en-v0_19.tar.bz2',
    tarballBytes: 103248205,
    tarballSha256: 'c9f0dd393615805b0bab050c340834d5e684e732aec91c0e860cd30e982c08bd',
    archiveDir: 'kokoro-int8-en-v0_19',
    modelType: 'kokoro',
    files: {
      model: 'model.int8.onnx',
      tokens: 'tokens.txt',
      dataDir: 'espeak-ng-data',
      voices: 'voices.bin',
    },
    speakers: [
      { id: 0, label: 'Default (AF)' },
      { id: 1, label: 'Bella' },
      { id: 2, label: 'Nicole' },
      { id: 3, label: 'Sarah' },
      { id: 4, label: 'Sky' },
      { id: 5, label: 'Adam' },
      { id: 6, label: 'Michael' },
      { id: 7, label: 'Emma' },
      { id: 8, label: 'Isabella' },
      { id: 9, label: 'George' },
      { id: 10, label: 'Lewis' },
    ],
    license: KOKORO_LICENSE,
  },
];

export const LOCAL_TTS_SYSTEM_ONLY_LANGUAGES = ['ja'];

export function getLocalTtsPack(id: unknown): LocalTtsPack | undefined {
  return LOCAL_TTS_PACKS.find((pack) => pack.id === id);
}

export function normalizeLocalTtsPackId(value: unknown): LocalTtsPackId | undefined {
  return typeof value === 'string' ? getLocalTtsPack(value)?.id : undefined;
}

export function isPackLanguageCompatible(pack: LocalTtsPack, language?: string) {
  if (!language) {
    return true;
  }
  return language.toLowerCase().replace(/_/g, '-').split('-')[0] === pack.languageCode;
}

export function localTtsSizeLabel(bytes: number) {
  return `~${Math.round(bytes / 1_000_000)} MB`;
}
