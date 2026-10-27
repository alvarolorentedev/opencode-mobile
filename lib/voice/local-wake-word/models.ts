import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import {
  LOCAL_VOICE_KWS_MODEL_NAME,
  LOCAL_VOICE_KWS_TARBALL_BYTES,
  LOCAL_VOICE_KWS_TARBALL_SHA256,
  LOCAL_VOICE_KWS_TARBALL_URL,
  LOCAL_VOICE_SPEAKER_MODEL_BYTES,
  LOCAL_VOICE_SPEAKER_MODEL_FILE,
  LOCAL_VOICE_SPEAKER_MODEL_SHA256,
  LOCAL_VOICE_SPEAKER_MODEL_URL,
  LOCAL_VOICE_VAD_MODEL_BYTES,
  LOCAL_VOICE_VAD_MODEL_FILE,
  LOCAL_VOICE_VAD_MODEL_SHA256,
  LOCAL_VOICE_VAD_MODEL_URL,
  getLocalCommandModel,
  localVoiceKeywords,
  type LocalCommandModelDefinition,
} from '@/lib/voice/local-wake-word/model-constants';
import { loadSherpaRuntime } from '@/lib/voice/local-wake-word/sherpa';
import type { LocalCommandModelId, LocalWakePhraseId, LocalVoiceModelStatus } from '@/lib/voice/local-wake-word/types';

const ROOT_DIRECTORY = 'opencode-voice';

function rootDirectory() {
  return new Directory(Paths.document, ROOT_DIRECTORY);
}

function kwsRootDirectory() {
  return new Directory(rootDirectory(), 'kws');
}

function speakerDirectory() {
  return new Directory(rootDirectory(), 'speaker');
}

function vadDirectory() {
  return new Directory(rootDirectory(), 'vad');
}

function asrRootDirectory() {
  return new Directory(rootDirectory(), 'asr');
}

function ensureDirectory(directory: Directory) {
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

function findKwsModelDirectory() {
  const root = kwsRootDirectory();
  if (!root.exists) {
    return undefined;
  }
  const fixed = new Directory(root, LOCAL_VOICE_KWS_MODEL_NAME);
  if (fixed.exists) {
    return fixed;
  }
  for (const entry of root.list()) {
    if (entry instanceof Directory && entry.name.startsWith('sherpa-onnx-kws')) {
      return entry;
    }
  }
  return root;
}

function findCommandModelDirectory(model: LocalCommandModelDefinition) {
  const root = asrRootDirectory();
  if (!root.exists) {
    return undefined;
  }
  const fixed = new Directory(root, model.modelName);
  if (fixed.exists) {
    return fixed;
  }
  for (const entry of root.list()) {
    if (entry instanceof Directory && entry.name.startsWith('sherpa-onnx-')) {
      return entry;
    }
  }
  return root;
}

export type LocalVoiceBasePaths = {
  kwsModelDir: string;
  kwsEncoder: string;
  kwsDecoder: string;
  kwsJoiner: string;
  kwsTokens: string;
  kwsKeywords: string;
  speakerModelDir: string;
  speakerModelFile: string;
  vadModelDir: string;
  vadModelFile: string;
};

export type LocalCommandModelPaths = {
  asrModelDir: string;
  asrPreprocess?: string;
  asrEncoder: string;
  asrDecoder?: string;
  asrUncachedDecoder?: string;
  asrCachedDecoder?: string;
  asrTokens: string;
};

export type LocalVoiceModelPaths = LocalVoiceBasePaths & LocalCommandModelPaths;

export function getLocalVoiceBasePaths(): LocalVoiceBasePaths | undefined {
  if (Platform.OS === 'web') {
    return undefined;
  }
  const kwsDirectory = findKwsModelDirectory();
  if (!kwsDirectory) {
    return undefined;
  }
  return {
    kwsModelDir: kwsDirectory.uri,
    kwsEncoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    kwsDecoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    kwsJoiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    kwsTokens: 'tokens.txt',
    kwsKeywords: 'keywords.txt',
    speakerModelDir: speakerDirectory().uri,
    speakerModelFile: LOCAL_VOICE_SPEAKER_MODEL_FILE,
    vadModelDir: vadDirectory().uri,
    vadModelFile: LOCAL_VOICE_VAD_MODEL_FILE,
  };
}

export function getLocalCommandModelPaths(modelId: LocalCommandModelId): LocalCommandModelPaths | undefined {
  if (Platform.OS === 'web') {
    return undefined;
  }
  const model = getLocalCommandModel(modelId);
  const asrDirectory = findCommandModelDirectory(model);
  if (!asrDirectory) {
    return undefined;
  }
  return {
    asrModelDir: asrDirectory.uri,
    asrPreprocess: model.files.preprocessor,
    asrEncoder: model.files.encoder ?? '',
    asrDecoder: model.files.decoder,
    asrUncachedDecoder: model.files.uncachedDecoder,
    asrCachedDecoder: model.files.cachedDecoder,
    asrTokens: model.files.tokens,
  };
}

export function getLocalVoiceModelPaths(modelId: LocalCommandModelId): LocalVoiceModelPaths | undefined {
  const base = getLocalVoiceBasePaths();
  const command = getLocalCommandModelPaths(modelId);
  if (!base || !command) {
    return undefined;
  }
  return { ...base, ...command };
}

export function getLocalVoiceBaseStatus(): LocalVoiceModelStatus {
  if (Platform.OS === 'web' || !loadSherpaRuntime()) {
    return 'unsupported';
  }
  const paths = getLocalVoiceBasePaths();
  if (!paths) {
    return 'missing';
  }
  const kwsDirectory = new Directory(paths.kwsModelDir);
  const requiredKwsFiles = [
    paths.kwsEncoder,
    paths.kwsDecoder,
    paths.kwsJoiner,
    paths.kwsTokens,
    paths.kwsKeywords,
  ];
  const speakerModel = new File(paths.speakerModelDir, paths.speakerModelFile);
  const vadModel = new File(paths.vadModelDir, paths.vadModelFile);
  const complete = requiredKwsFiles.every((name) => new File(kwsDirectory, name).exists)
    && speakerModel.exists
    && vadModel.exists;
  return complete ? 'ready' : 'missing';
}

export function getLocalCommandModelStatus(modelId: LocalCommandModelId): LocalVoiceModelStatus {
  if (Platform.OS === 'web' || !loadSherpaRuntime()) {
    return 'unsupported';
  }
  const model = getLocalCommandModel(modelId);
  const paths = getLocalCommandModelPaths(modelId);
  if (!paths) {
    return 'missing';
  }
  const directory = new Directory(paths.asrModelDir);
  const required = [
    model.files.preprocessor,
    model.files.encoder,
    model.files.decoder,
    model.files.uncachedDecoder,
    model.files.cachedDecoder,
    model.files.tokens,
  ].filter((name): name is string => Boolean(name));
  return required.every((name) => new File(directory, name).exists) ? 'ready' : 'missing';
}

export function getLocalVoiceModelStatus(modelId: LocalCommandModelId): LocalVoiceModelStatus {
  const base = getLocalVoiceBaseStatus();
  if (base !== 'ready') {
    return base;
  }
  return getLocalCommandModelStatus(modelId);
}

export function writeLocalVoiceKeywords(phrase: LocalWakePhraseId): boolean {
  const paths = getLocalVoiceBasePaths();
  if (!paths) {
    return false;
  }
  const file = new File(paths.kwsModelDir, paths.kwsKeywords);
  if (!file.exists) {
    file.create({ intermediates: true, overwrite: true });
  }
  file.write(localVoiceKeywords(phrase));
  return true;
}

async function downloadVerified(
  url: string,
  destination: File,
  bytes: number,
  sha256: string,
  label: string,
) {
  await File.downloadFileAsync(url, destination, { idempotent: true });
  if (destination.size !== bytes) {
    if (destination.exists) {
      destination.delete();
    }
    throw new Error(`The ${label} download was incomplete.`);
  }
  if (await sha256Hex(destination) !== sha256) {
    if (destination.exists) {
      destination.delete();
    }
    throw new Error(`The ${label} download failed integrity verification.`);
  }
}

async function installBaseModels(phrase: LocalWakePhraseId, runtime: NonNullable<ReturnType<typeof loadSherpaRuntime>>) {
  if (getLocalVoiceBaseStatus() === 'ready') {
    writeLocalVoiceKeywords(phrase);
    return;
  }

  const kwsRoot = ensureDirectory(kwsRootDirectory());
  const vadDir = ensureDirectory(vadDirectory());
  const speakerDir = ensureDirectory(speakerDirectory());

  if (kwsRoot.exists) {
    kwsRoot.delete();
  }
  ensureDirectory(kwsRoot);
  if (vadDir.exists) {
    vadDir.delete();
  }
  ensureDirectory(vadDir);

  const archiveFile = new File(Paths.cache, 'opencode-kws-models.tar.bz2');
  if (archiveFile.exists) {
    archiveFile.delete();
  }
  await downloadVerified(
    LOCAL_VOICE_KWS_TARBALL_URL,
    archiveFile,
    LOCAL_VOICE_KWS_TARBALL_BYTES,
    LOCAL_VOICE_KWS_TARBALL_SHA256,
    'wake-word model',
  );
  try {
    const extracted = await runtime.Archive.extractTarBz2(archiveFile.uri, kwsRoot.uri);
    if (!extracted.success) {
      throw new Error(extracted.message || 'Could not extract the wake-word model.');
    }
  } finally {
    if (archiveFile.exists) {
      archiveFile.delete();
    }
  }
  if (!findKwsModelDirectory()) {
    throw new Error('The wake-word model archive did not contain a model directory.');
  }
  writeLocalVoiceKeywords(phrase);

  const speakerModel = new File(speakerDir, LOCAL_VOICE_SPEAKER_MODEL_FILE);
  await downloadVerified(
    LOCAL_VOICE_SPEAKER_MODEL_URL,
    speakerModel,
    LOCAL_VOICE_SPEAKER_MODEL_BYTES,
    LOCAL_VOICE_SPEAKER_MODEL_SHA256,
    'speaker model',
  );

  const vadModel = new File(vadDir, LOCAL_VOICE_VAD_MODEL_FILE);
  await downloadVerified(
    LOCAL_VOICE_VAD_MODEL_URL,
    vadModel,
    LOCAL_VOICE_VAD_MODEL_BYTES,
    LOCAL_VOICE_VAD_MODEL_SHA256,
    'voice-activity model',
  );
}

async function installCommandModel(
  modelId: LocalCommandModelId,
  runtime: NonNullable<ReturnType<typeof loadSherpaRuntime>>,
) {
  if (getLocalCommandModelStatus(modelId) === 'ready') {
    return;
  }

  const model = getLocalCommandModel(modelId);
  const asrRoot = ensureDirectory(asrRootDirectory());
  if (asrRoot.exists) {
    asrRoot.delete();
  }
  ensureDirectory(asrRoot);

  const asrArchive = new File(Paths.cache, 'opencode-asr-model.tar.bz2');
  if (asrArchive.exists) {
    asrArchive.delete();
  }
  await downloadVerified(
    model.tarballUrl,
    asrArchive,
    model.tarballBytes,
    model.tarballSha256,
    'command-recognition model',
  );
  try {
    const extracted = await runtime.Archive.extractTarBz2(asrArchive.uri, asrRoot.uri);
    if (!extracted.success) {
      throw new Error(extracted.message || 'Could not extract the command-recognition model.');
    }
  } finally {
    if (asrArchive.exists) {
      asrArchive.delete();
    }
  }
  if (!findCommandModelDirectory(model)) {
    throw new Error('The command-recognition archive did not contain a model directory.');
  }
}

/**
 * Download the optional on-device voice pack. The base pack (KWS, speaker, VAD)
 * is reused when the user switches command models; only the selected ASR model
 * is downloaded or replaced.
 */
export async function installLocalVoiceModels(
  phrase: LocalWakePhraseId,
  modelId: LocalCommandModelId,
): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('On-device voice models are not supported on web.');
  }
  const runtime = loadSherpaRuntime();
  if (!runtime) {
    throw new Error('The on-device voice runtime is not available in this build.');
  }

  await installBaseModels(phrase, runtime);
  await installCommandModel(modelId, runtime);

  if (getLocalVoiceModelStatus(modelId) !== 'ready') {
    throw new Error('The on-device voice models are incomplete after installation.');
  }
}

export async function removeLocalVoiceModels(): Promise<void> {
  const root = rootDirectory();
  if (root.exists) {
    root.delete();
  }
}

export function localVoiceModelsExist(modelId: LocalCommandModelId): boolean {
  return getLocalVoiceModelStatus(modelId) === 'ready';
}

async function sha256Hex(file: File): Promise<string> {
  const bytes = await file.bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
