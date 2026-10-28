import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

class FakeFile {
  path: string;
  deleted = false;

  constructor(parent: string | { path: string }, name?: string) {
    const base = typeof parent === 'string' ? parent : parent.path;
    this.path = name === undefined ? base : `${base}/${name}`;
  }

  get exists() {
    return !this.deleted;
  }

  delete() {
    this.deleted = true;
  }
}

function fakeFileModule(File: unknown) {
  return { 'expo-file-system': { File } };
}

const immediateTimers = {
  setTimeout: (callback: () => void) => {
    callback();
    return 0;
  },
  console: { warn() {} },
};

describe('model download error classification', () => {
  it('classifies native network failures into user-facing codes', async () => {
    const { classifyModelDownloadError } = await loadTs(
      'lib/model-download.ts',
      fakeFileModule(FakeFile),
    );

    assert.equal(
      classifyModelDownloadError(new Error("Call to function 'FileSystem.downloadFileAsync' has been rejected. → Caused by: java.net.SocketTimeoutException: timeout")),
      'timeout',
    );
    assert.equal(
      classifyModelDownloadError(new Error('java.net.UnknownHostException: Unable to resolve host "github.com": No address associated with hostname')),
      'offline',
    );
    assert.equal(
      classifyModelDownloadError(new Error('UnableToDownloadException: HTTP 503')),
      'server',
    );
    assert.equal(
      classifyModelDownloadError(new Error('java.io.IOException: ENOSPC (No space left on device)')),
      'storage',
    );
    assert.equal(classifyModelDownloadError(new Error('Unexpected failure')), 'unknown');
  });

  it('retries 5xx server failures but not 4xx failures', async () => {
    const { isRetryableModelDownloadError } = await loadTs(
      'lib/model-download.ts',
      fakeFileModule(FakeFile),
    );

    assert.equal(isRetryableModelDownloadError(new Error('UnableToDownloadException: HTTP 503')), true);
    assert.equal(isRetryableModelDownloadError(new Error('UnableToDownloadException: HTTP 404')), false);
  });

  it('maps error codes to the shared translation keys', async () => {
    const { ModelDownloadError, modelDownloadErrorCode, modelDownloadMessageKeyForCode } = await loadTs(
      'lib/model-download.ts',
      fakeFileModule(FakeFile),
    );

    assert.equal(modelDownloadErrorCode(new ModelDownloadError('timeout', 'timed out', true)), 'timeout');
    assert.equal(modelDownloadErrorCode(new Error('move failed')), 'install');
    assert.equal(modelDownloadMessageKeyForCode('timeout'), 'settings:voice.modelDownloads.timeout');
    assert.equal(modelDownloadMessageKeyForCode('install'), 'settings:voice.modelDownloads.installFailed');
  });
});

describe('model download retry policy', () => {
  it('retries once after a transient transfer failure', async () => {
    let attempts = 0;
    class File extends FakeFile {
      static createDownloadTask() {
        attempts += 1;
        const attempt = attempts;
        return {
          async downloadAsync() {
            if (attempt === 1) {
              throw new Error('java.net.SocketTimeoutException: timeout');
            }
            return new File('/cache/model');
          },
          release() {},
        };
      }
    }

    const { downloadFileWithRetry } = await loadTs(
      'lib/model-download.ts',
      fakeFileModule(File),
      immediateTimers,
    );
    const file = await downloadFileWithRetry(
      'https://example.com/model.bin',
      new File('/cache/model'),
      'voice model',
    );

    assert.equal(attempts, 2);
    assert.equal(file.path, '/cache/model');
  });

  it('does not retry an integrity failure', async () => {
    let attempts = 0;
    class File extends FakeFile {
      static createDownloadTask() {
        attempts += 1;
        return {
          async downloadAsync() {
            return new File('/cache/model');
          },
          release() {},
        };
      }
    }

    const { downloadFileWithRetry, ModelDownloadError } = await loadTs(
      'lib/model-download.ts',
      fakeFileModule(File),
      immediateTimers,
    );

    await assert.rejects(
      downloadFileWithRetry(
        'https://example.com/model.bin',
        new File('/cache/model'),
        'voice model',
        () => {
          throw new ModelDownloadError('integrity', 'The download failed integrity verification.', false);
        },
      ),
      /integrity verification/,
    );
    assert.equal(attempts, 1);
  });

  it('throws the classified error after the retry budget is exhausted', async () => {
    let attempts = 0;
    class File extends FakeFile {
      static createDownloadTask() {
        attempts += 1;
        return {
          async downloadAsync() {
            throw new Error('java.net.SocketTimeoutException: timeout');
          },
          release() {},
        };
      }
    }

    const { downloadFileWithRetry } = await loadTs(
      'lib/model-download.ts',
      fakeFileModule(File),
      immediateTimers,
    );

    await assert.rejects(
      downloadFileWithRetry('https://example.com/model.bin', new File('/cache/model'), 'voice model'),
      (error: Error & { code?: string }) => error.code === 'timeout',
    );
    assert.equal(attempts, 2);
  });
});
