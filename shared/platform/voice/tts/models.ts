import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { loadSherpaRuntime } from '@/shared/platform/voice/local-wake-word/sherpa';
import { downloadVerified } from '@/shared/platform/voice/model-files';
import { getLocalTtsPack, LOCAL_TTS_PACKS } from '@/shared/platform/voice/tts/catalog';
import type { LocalTtsPack, LocalTtsPackId, LocalTtsPackStatus } from '@/shared/platform/voice/tts/types';

const ROOT_DIRECTORY = 'opencode-tts';
const installJobs = new Map<LocalTtsPackId, Promise<void>>();

function rootDirectory() {
  return new Directory(Paths.document, ROOT_DIRECTORY);
}

function packDirectory(packId: LocalTtsPackId) {
  return new Directory(rootDirectory(), packId);
}

function stagingDirectory(packId: LocalTtsPackId) {
  return new Directory(rootDirectory(), `${packId}.installing`);
}

function archiveFile(packId: LocalTtsPackId) {
  return new File(Paths.cache, `opencode-tts-${packId}.tar.bz2`);
}

function ensureDirectory(directory: Directory) {
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

function hasRequiredFiles(directory: Directory, pack: LocalTtsPack) {
  if (!new File(directory, pack.files.model).exists || !new File(directory, pack.files.tokens).exists) {
    return false;
  }
  if (pack.files.dataDir && !new Directory(directory, pack.files.dataDir).exists) {
    return false;
  }
  if (pack.files.lexicon && !new File(directory, pack.files.lexicon).exists) {
    return false;
  }
  if (pack.files.voices && !new File(directory, pack.files.voices).exists) {
    return false;
  }
  return true;
}

function nativeTtsAvailable() {
  return Platform.OS !== 'web' && Boolean(loadSherpaRuntime()?.TTS);
}

export function getLocalTtsPackStatus(packId: LocalTtsPackId): LocalTtsPackStatus {
  const pack = getLocalTtsPack(packId);
  if (!pack || !nativeTtsAvailable()) {
    return 'unsupported';
  }
  if (installJobs.has(packId)) {
    return 'installing';
  }
  const directory = packDirectory(packId);
  if (!directory.exists) {
    return 'missing';
  }
  return hasRequiredFiles(directory, pack) ? 'ready' : 'missing';
}

export function getLocalTtsPackStatuses() {
  return Object.fromEntries(
    LOCAL_TTS_PACKS.map((pack) => [pack.id, getLocalTtsPackStatus(pack.id)]),
  ) as Record<LocalTtsPackId, LocalTtsPackStatus>;
}

export function isLocalTtsPackInstalling(packId: LocalTtsPackId) {
  return installJobs.has(packId);
}

export type LocalTtsPackPaths = {
  modelDir: string;
  modelFile: string;
  tokensFile: string;
  dataDir?: string;
  lexiconFile?: string;
  voicesFile?: string;
};

export function getLocalTtsPackPaths(packId: LocalTtsPackId): LocalTtsPackPaths | undefined {
  const pack = getLocalTtsPack(packId);
  if (!pack || getLocalTtsPackStatus(packId) !== 'ready') {
    return undefined;
  }
  const directory = packDirectory(packId);
  // The native sherpa-onnx config joins modelFile/tokensFile/lexicon/voices
  // against modelDir, so those must stay as file names. Passing Expo file://
  // URIs here makes the native side look for a nested `file:` path and fail
  // initialization even though the pack is installed. Only directories are
  // passed as absolute paths.
  return {
    modelDir: directory.uri,
    modelFile: pack.files.model,
    tokensFile: pack.files.tokens,
    ...(pack.files.dataDir ? { dataDir: new Directory(directory, pack.files.dataDir).uri } : {}),
    ...(pack.files.lexicon ? { lexiconFile: pack.files.lexicon } : {}),
    ...(pack.files.voices ? { voicesFile: pack.files.voices } : {}),
  };
}

export async function installLocalTtsPack(packId: LocalTtsPackId): Promise<void> {
  const pack = getLocalTtsPack(packId);
  if (!pack) {
    throw new Error('Unknown on-device voice model.');
  }
  if (!nativeTtsAvailable()) {
    throw new Error('On-device speech is not supported in this build.');
  }

  const runtime = loadSherpaRuntime();
  if (!runtime?.TTS || !runtime.Archive) {
    throw new Error('The on-device speech runtime is not available in this build.');
  }

  const existing = installJobs.get(packId);
  if (existing) {
    await existing;
    return;
  }

  const job = (async () => {
    ensureDirectory(rootDirectory());
    const staging = stagingDirectory(packId);
    if (staging.exists) {
      staging.delete();
    }
    ensureDirectory(staging);

    const archive = archiveFile(packId);
    if (archive.exists) {
      archive.delete();
    }

    try {
      await downloadVerified(
        pack.tarballUrl,
        archive,
        pack.tarballBytes,
        pack.tarballSha256,
        'voice model',
      );

      const extracted = await runtime.Archive.extractTarBz2(archive.uri, staging.uri);
      if (!extracted.success) {
        throw new Error(extracted.message || 'Could not extract the voice model.');
      }

      const extractedDirectory = new Directory(staging, pack.archiveDir);
      if (!extractedDirectory.exists || !hasRequiredFiles(extractedDirectory, pack)) {
        throw new Error('The voice model archive was incomplete.');
      }

      const destination = packDirectory(packId);
      if (destination.exists) {
        destination.delete();
      }
      await extractedDirectory.move(destination);

      if (!hasRequiredFiles(destination, pack)) {
        throw new Error('The voice model could not be installed.');
      }
    } catch (error) {
      try {
        if (staging.exists) {
          staging.delete();
        }
      } catch {
        // Preserve the original install failure.
      }
      throw error;
    } finally {
      try {
        if (archive.exists) {
          archive.delete();
        }
      } catch {
        // Cache cleanup is best effort.
      }
    }
  })().finally(() => {
    installJobs.delete(packId);
    const staging = stagingDirectory(packId);
    try {
      if (staging.exists) {
        staging.delete();
      }
    } catch {
      // A failed staging cleanup must not turn a successful install into an error.
    }
  });

  installJobs.set(packId, job);
  await job;
}

export async function removeLocalTtsPack(packId: LocalTtsPackId): Promise<void> {
  const directory = packDirectory(packId);
  if (directory.exists) {
    directory.delete();
  }
  const staging = stagingDirectory(packId);
  if (staging.exists) {
    staging.delete();
  }
}

export function getLocalTtsStorageBytes() {
  try {
    return LOCAL_TTS_PACKS.reduce((total, pack) => {
      const directory = packDirectory(pack.id);
      return total + (directory.exists ? (directory.size ?? 0) : 0);
    }, 0);
  } catch {
    return 0;
  }
}

export function cleanupLocalTtsStaging() {
  try {
    const root = rootDirectory();
    if (!root.exists) {
      return;
    }
    for (const entry of root.list()) {
      if (entry instanceof Directory && entry.name.endsWith('.installing') && !installJobs.has(entry.name.replace(/\.installing$/, '') as LocalTtsPackId)) {
        entry.delete();
      }
    }
  } catch {
    // Stale staging cleanup is best effort.
  }
}
