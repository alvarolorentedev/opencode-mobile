import type { SpeechFallbackReason } from '@/lib/voice/speech-types';

export type LocalTtsPackId =
  | 'piper-en'
  | 'piper-es'
  | 'piper-hi'
  | 'piper-de'
  | 'piper-fr'
  | 'piper-zh'
  | 'piper-pt'
  | 'kokoro-en';

export type LocalTtsFamily = 'piper' | 'kokoro';

export type LocalTtsPackStatus = 'unsupported' | 'missing' | 'installing' | 'ready' | 'error';

export type LocalTtsSpeaker = {
  id: number;
  label: string;
};

export type LocalTtsFiles = {
  model: string;
  tokens: string;
  dataDir?: string;
  lexicon?: string;
  voices?: string;
};

export type LocalTtsPack = {
  id: LocalTtsPackId;
  family: LocalTtsFamily;
  vendor: string;
  languageCode: string;
  locale: string;
  languageLabel: string;
  tarballUrl: string;
  tarballBytes: number;
  tarballSha256: string;
  archiveDir: string;
  modelType: 'vits' | 'kokoro';
  files: LocalTtsFiles;
  speakers: LocalTtsSpeaker[];
  license: {
    label: string;
    url: string;
  };
};

export class LocalTtsUnavailableError extends Error {
  readonly reason: SpeechFallbackReason;

  constructor(reason: SpeechFallbackReason, message?: string) {
    super(message ?? 'On-device speech is unavailable.');
    this.name = 'LocalTtsUnavailableError';
    this.reason = reason;
  }
}
