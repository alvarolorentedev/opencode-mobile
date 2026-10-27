import type { LocalCommandModelId, LocalWakePhraseId } from '@/lib/voice/local-wake-word/types';
import {
  DEFAULT_LOCAL_COMMAND_MODEL,
  LOCAL_WAKE_PHRASES,
  normalizeLocalCommandModel,
  normalizeLocalWakePhrase,
} from '@/lib/voice/local-wake-word/types';

export const LOCAL_VOICE_KWS_MODEL_NAME = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';
export const LOCAL_VOICE_KWS_TARBALL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2';
export const LOCAL_VOICE_KWS_TARBALL_BYTES = 17626723;
export const LOCAL_VOICE_KWS_TARBALL_SHA256 = 'f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a';

export const LOCAL_VOICE_SPEAKER_MODEL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx';
export const LOCAL_VOICE_SPEAKER_MODEL_BYTES = 26534365;
export const LOCAL_VOICE_SPEAKER_MODEL_SHA256 = '5ef208a9da1453335308a6b6f4e6dfbd7e183a38b604de0a57664f45d257fe94';
export const LOCAL_VOICE_SPEAKER_MODEL_FILE = 'wespeaker_en_voxceleb_resnet34.onnx';

export const LOCAL_VOICE_VAD_MODEL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx';
export const LOCAL_VOICE_VAD_MODEL_BYTES = 643854;
export const LOCAL_VOICE_VAD_MODEL_SHA256 = '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6';
export const LOCAL_VOICE_VAD_MODEL_FILE = 'silero_vad.onnx';

export type LocalCommandModelDefinition = {
  id: LocalCommandModelId;
  label: string;
  languages: string;
  modelName: string;
  modelType: 'moonshine' | 'whisper';
  streaming: false;
  tarballUrl: string;
  tarballBytes: number;
  tarballSha256: string;
  files: {
    preprocessor?: string;
    encoder?: string;
    decoder?: string;
    uncachedDecoder?: string;
    cachedDecoder?: string;
    tokens: string;
  };
};

export const LOCAL_COMMAND_MODELS: Record<LocalCommandModelId, LocalCommandModelDefinition> = {
  'moonshine-tiny-en': {
    id: 'moonshine-tiny-en',
    label: 'Moonshine tiny (English, fast)',
    languages: 'English only',
    modelName: 'sherpa-onnx-moonshine-tiny-en-int8',
    modelType: 'moonshine',
    streaming: false,
    tarballUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2',
    tarballBytes: 107600538,
    tarballSha256: 'd5fe6ec4334fef36255b2a4010412cad4c007e33103fec62fb5d17cad88086f2',
    files: {
      preprocessor: 'preprocess.onnx',
      encoder: 'encode.int8.onnx',
      uncachedDecoder: 'uncached_decode.int8.onnx',
      cachedDecoder: 'cached_decode.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  'whisper-tiny-multi': {
    id: 'whisper-tiny-multi',
    label: 'Whisper tiny (multilingual)',
    languages: 'Multilingual (99 languages)',
    modelName: 'sherpa-onnx-whisper-tiny',
    modelType: 'whisper',
    streaming: false,
    tarballUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2',
    tarballBytes: 116204861,
    tarballSha256: 'c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1',
    files: {
      encoder: 'tiny-encoder.int8.onnx',
      decoder: 'tiny-decoder.int8.onnx',
      tokens: 'tiny-tokens.txt',
    },  },
};

export function getLocalCommandModel(value: unknown): LocalCommandModelDefinition {
  return LOCAL_COMMAND_MODELS[normalizeLocalCommandModel(value)];
}

export const LOCAL_VOICE_BASE_DOWNLOAD_BYTES =
  LOCAL_VOICE_KWS_TARBALL_BYTES
  + LOCAL_VOICE_SPEAKER_MODEL_BYTES
  + LOCAL_VOICE_VAD_MODEL_BYTES;

export function localVoiceBaseDownloadSizeLabel(): string {
  return `~${Math.round(LOCAL_VOICE_BASE_DOWNLOAD_BYTES / 1_000_000)} MB`;
}

export function localCommandModelDownloadSizeLabel(modelId: LocalCommandModelId): string {
  return `~${Math.round(getLocalCommandModel(modelId).tarballBytes / 1_000_000)} MB`;
}

export function localVoiceDownloadSizeLabel(modelId: LocalCommandModelId): string {
  const model = getLocalCommandModel(modelId);
  return `~${Math.round((LOCAL_VOICE_BASE_DOWNLOAD_BYTES + model.tarballBytes) / 1_000_000)} MB`;
}

export function localVoiceKeywords(phrase: LocalWakePhraseId) {
  return `${LOCAL_WAKE_PHRASES[normalizeLocalWakePhrase(phrase)].tokens}\n`;
}

// Kept for tests/callers that only need the default model's sizes.
export const LOCAL_VOICE_ASR_TARBALL_BYTES = LOCAL_COMMAND_MODELS[DEFAULT_LOCAL_COMMAND_MODEL].tarballBytes;
