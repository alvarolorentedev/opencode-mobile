// Shared types for the sherpa-onnx native runtime.
//
// The wake-word path is:
//   mic -> sherpa-onnx KWS -> optional speaker check -> OS recognizer command
// The same native module also exposes TTS for the optional on-device playback
// engine; STT and TTS model packs remain independent.

export type LocalWakePhraseId = 'hey-code' | 'hey-opencode';

export type LocalCommandModelId = 'moonshine-tiny-en' | 'whisper-tiny-multi';

export const DEFAULT_LOCAL_COMMAND_MODEL: LocalCommandModelId = 'moonshine-tiny-en';

export function normalizeLocalCommandModel(value: unknown): LocalCommandModelId {
  return value === 'whisper-tiny-multi' || value === 'moonshine-tiny-en'
    ? value
    : DEFAULT_LOCAL_COMMAND_MODEL;
}

export type LocalWakePhrase = {
  id: LocalWakePhraseId;
  label: string;
  // BPE pieces for sherpa-onnx's English open-vocabulary KWS model. These are
  // generated from the model's bpe.model; no model training is involved.
  tokens: string;
};

export const LOCAL_WAKE_PHRASES: Record<LocalWakePhraseId, LocalWakePhrase> = {
  'hey-code': {
    id: 'hey-code',
    label: 'Hey code',
    tokens: '▁HE Y ▁CO DE',
  },
  'hey-opencode': {
    id: 'hey-opencode',
    label: 'Hey opencode',
    tokens: '▁HE Y ▁O P EN CO DE',
  },
};

export const DEFAULT_LOCAL_WAKE_PHRASE: LocalWakePhraseId = 'hey-code';

export function normalizeLocalWakePhrase(value: unknown): LocalWakePhraseId {
  return value === 'hey-opencode' || value === 'hey-code' ? value : DEFAULT_LOCAL_WAKE_PHRASE;
}

export type LocalVoiceModelStatus =
  | 'unsupported'
  | 'missing'
  | 'installing'
  | 'ready'
  | 'error';

export type KwsService = {
  init(config: {
    modelDir: string;
    modelType?: string;
    modelFiles?: { encoder?: string; decoder?: string; joiner?: string; tokens?: string };
    keywordsFile?: string;
    numThreads?: number;
    keywordsScore?: number;
    keywordsThreshold?: number;
    maxActivePaths?: number;
  }): Promise<{ success: boolean; error?: string }>;
  acceptWaveform(
    sampleRate: number,
    samples: number[],
  ): Promise<{ success: boolean; detected: boolean; keyword: string; error?: string }>;
  resetStream(): Promise<{ success: boolean }>;
  release(): Promise<{ released: boolean }>;
};

export type SpeakerIdService = {
  init(config: {
    modelDir: string;
    modelFile?: string;
    sampleRate?: number;
    numThreads?: number;
    provider?: 'cpu' | 'gpu';
  }): Promise<{ success: boolean; embeddingDim: number; error?: string }>;
  resetStream(): Promise<{ success: boolean; error?: string }>;
  processSamples(
    sampleRate: number,
    samples: number[],
  ): Promise<{ success: boolean; samplesProcessed: number; error?: string }>;
  computeEmbedding(): Promise<{
    success: boolean;
    durationMs: number;
    embedding: number[];
    embeddingDim: number;
    error?: string;
  }>;
  release(): Promise<{ released: boolean }>;
};

export type ArchiveService = {
  extractTarBz2(sourcePath: string, targetDir: string): Promise<{
    success: boolean;
    message: string;
    extractedFiles: string[];
  }>;
};

export type VadService = {
  init(config: {
    modelDir: string;
    modelFile?: string;
    threshold?: number;
    minSilenceDuration?: number;
    minSpeechDuration?: number;
    windowSize?: number;
    maxSpeechDuration?: number;
    bufferSizeInSeconds?: number;
    numThreads?: number;
    provider?: 'cpu' | 'gpu';
  }): Promise<{ success: boolean; error?: string }>;
  acceptWaveform(
    sampleRate: number,
    samples: number[],
  ): Promise<{
    success: boolean;
    isSpeechDetected: boolean;
    segments: { start: number; duration: number; startTime: number; endTime: number }[];
    error?: string;
  }>;
  reset(): Promise<{ success: boolean }>;
  release(): Promise<{ released: boolean }>;
};

export type AsrService = {
  initialize(config: {
    modelDir: string;
    modelType: string;
    streaming?: boolean;
    numThreads?: number;
    decodingMethod?: 'greedy_search' | 'beam_search';
    language?: string;
    task?: 'transcribe' | 'translate';
    modelFiles?: {
      preprocessor?: string;
      encoder?: string;
      decoder?: string;
      uncachedDecoder?: string;
      cachedDecoder?: string;
      tokens?: string;
    };
  }): Promise<{ success: boolean; error?: string }>;
  recognizeFromSamples(
    sampleRate: number,
    samples: number[],
  ): Promise<{ success: boolean; text?: string; error?: string }>;
  release(): Promise<{ released: boolean }>;
};

export type TtsModelType = 'vits' | 'kokoro' | 'matcha';

export type TtsService = {
  initialize(config: {
    modelDir: string;
    ttsModelType: TtsModelType;
    modelFile: string;
    tokensFile: string;
    voicesFile?: string;
    vocoderFile?: string;
    lexiconFile?: string;
    dataDir?: string;
    dictDir?: string;
    lang?: string;
    ruleFstsFile?: string;
    ruleFarsFile?: string;
    numThreads?: number;
    provider?: 'cpu' | 'gpu';
    noiseScale?: number;
    noiseScaleW?: number;
    lengthScale?: number;
    maxNumSentences?: number;
    silenceScale?: number;
  }): Promise<{
    success: boolean;
    sampleRate: number;
    numSpeakers: number;
    error?: string;
  }>;
  isInitialized(): boolean;
  getSampleRate(): number;
  getNumSpeakers(): number;
  generateSpeech(text: string, options?: {
    speakerId?: number;
    speakingRate?: number;
    playAudio?: boolean;
    fileNamePrefix?: string;
    lengthScale?: number;
    noiseScale?: number;
    noiseScaleW?: number;
  }): Promise<{ success: boolean; filePath?: string }>;
  stopSpeech(): Promise<{ stopped: boolean; message?: string }>;
  release(): Promise<{ released: boolean }>;
};

export type SherpaRuntime = {
  ASR: AsrService;
  KWS: KwsService;
  SpeakerId: SpeakerIdService;
  VAD: VadService;
  Archive: ArchiveService;
  // Optional so an older native build still loads the wake-word path and the
  // app can fall back to system TTS.
  TTS?: TtsService;
};
