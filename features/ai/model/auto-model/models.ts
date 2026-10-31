import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { downloadFileWithRetry, modelDownloadErrorCode, ModelDownloadError, type ModelInstallErrorCode } from '@/shared/platform/models/model-download';

import { AUTO_MODEL_PACK } from '@/features/ai/model/auto-model/catalog';

const ROOT_DIRECTORY = 'opencode-auto-model';
const installJobs = new Map<string, Promise<void>>();
const installErrors = new Map<string, ModelInstallErrorCode>();

export type LocalAutoModelStatus = 'unsupported' | 'installing' | 'ready' | 'missing' | 'error';

function rootDirectory() {
  return new Directory(Paths.document, ROOT_DIRECTORY);
}

function packDirectory() {
  return new Directory(rootDirectory(), AUTO_MODEL_PACK.id);
}

function stagingDirectory() {
  return new Directory(rootDirectory(), `${AUTO_MODEL_PACK.id}.installing`);
}

function packFile(directory: Directory) {
  return new File(directory, AUTO_MODEL_PACK.fileName);
}

function ensureDirectory(directory: Directory) {
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

export function isLocalAutoModelSupported() {
  return Platform.OS !== 'web';
}

export function getLocalAutoModelStatus(): LocalAutoModelStatus {
  if (!isLocalAutoModelSupported()) {
    return 'unsupported';
  }
  if (installJobs.has(AUTO_MODEL_PACK.id)) {
    return 'installing';
  }

  const file = packFile(packDirectory());
  if (file.exists && file.size === AUTO_MODEL_PACK.bytes) {
    return 'ready';
  }
  return installErrors.has(AUTO_MODEL_PACK.id) ? 'error' : 'missing';
}

export function getLocalAutoModelError(): ModelInstallErrorCode | undefined {
  return installErrors.get(AUTO_MODEL_PACK.id);
}

export function getLocalAutoModelPath() {
  const file = packFile(packDirectory());
  return file.exists && file.size === AUTO_MODEL_PACK.bytes ? file.uri : undefined;
}

export function getLocalAutoModelBytes() {
  if (!isLocalAutoModelSupported()) {
    return 0;
  }
  const file = packFile(packDirectory());
  return file.exists ? file.size : 0;
}

export async function installLocalAutoModel(): Promise<void> {
  if (!isLocalAutoModelSupported()) {
    throw new Error('The on-device classifier is not supported on this platform.');
  }
  const existing = installJobs.get(AUTO_MODEL_PACK.id);
  if (existing) {
    await existing;
    return;
  }

  installErrors.delete(AUTO_MODEL_PACK.id);
  const job = (async () => {
    ensureDirectory(rootDirectory());
    const staging = stagingDirectory();
    if (staging.exists) {
      staging.delete();
    }
    ensureDirectory(staging);
    const stagingFile = packFile(staging);

    try {
      await downloadFileWithRetry(AUTO_MODEL_PACK.url, stagingFile, 'classifier model', (file) => {
        if (file.size !== AUTO_MODEL_PACK.bytes) {
          throw new ModelDownloadError(
            'incomplete',
            'The classifier model download was incomplete.',
            true,
          );
        }
        if (file.md5?.toLowerCase() !== AUTO_MODEL_PACK.md5) {
          throw new ModelDownloadError(
            'integrity',
            'The classifier model failed integrity verification.',
            false,
          );
        }
      });

      const destination = packDirectory();
      if (destination.exists) {
        destination.delete();
      }
      ensureDirectory(destination);
      const installed = packFile(destination);
      await stagingFile.move(installed);
      if (!installed.exists || installed.size !== AUTO_MODEL_PACK.bytes) {
        throw new Error('The classifier model could not be installed.');
      }
    } catch (error) {
      installErrors.set(AUTO_MODEL_PACK.id, modelDownloadErrorCode(error));
      throw error;
    } finally {
      try {
        if (staging.exists) {
          staging.delete();
        }
      } catch {
        // Best-effort cleanup.
      }
    }
  })().finally(() => {
    installJobs.delete(AUTO_MODEL_PACK.id);
  });

  installJobs.set(AUTO_MODEL_PACK.id, job);
  await job;
}

export async function removeLocalAutoModel(): Promise<void> {
  installErrors.delete(AUTO_MODEL_PACK.id);
  const destination = packDirectory();
  if (destination.exists) {
    destination.delete();
  }
  const staging = stagingDirectory();
  if (staging.exists) {
    staging.delete();
  }
}
