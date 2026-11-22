import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, vi } from 'vitest';

import type { File } from 'expo-file-system';
import {
  classifyModelDownloadError,
  downloadFileWithRetry,
  isRetryableModelDownloadError,
  ModelDownloadError,
  modelDownloadErrorCode,
  modelDownloadMessageKeyForCode,
} from '@/shared/platform/models/model-download';

const { createDownloadTask } = vi.hoisted(() => ({ createDownloadTask: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: { createDownloadTask } }));

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

const destination = () => new FakeFile('/cache/model') as unknown as File;

describe('model download error classification', () => {
  it('classifies native network failures into user-facing codes', async () => {

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

    assert.equal(isRetryableModelDownloadError(new Error('UnableToDownloadException: HTTP 503')), true);
    assert.equal(isRetryableModelDownloadError(new Error('UnableToDownloadException: HTTP 404')), false);
  });

  it('maps error codes to the shared translation keys', async () => {

    assert.equal(modelDownloadErrorCode(new ModelDownloadError('timeout', 'timed out', true)), 'timeout');
    assert.equal(modelDownloadErrorCode(new Error('move failed')), 'install');
    assert.equal(modelDownloadMessageKeyForCode('timeout'), 'settings:voice.modelDownloads.timeout');
    assert.equal(modelDownloadMessageKeyForCode('install'), 'settings:voice.modelDownloads.installFailed');
  });
});

describe('model download retry policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createDownloadTask.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('retries once after a transient transfer failure', async () => {
    createDownloadTask
      .mockReturnValueOnce({ downloadAsync: async () => { throw new Error('java.net.SocketTimeoutException: timeout'); }, release() {} })
      .mockReturnValueOnce({ downloadAsync: async () => destination(), release() {} });
    const pending = downloadFileWithRetry('https://example.com/model.bin', destination(), 'voice model');
    await vi.advanceTimersByTimeAsync(1500);
    const file = await pending;
    assert.equal(createDownloadTask.mock.calls.length, 2);
    assert.equal(file instanceof FakeFile && file.path, '/cache/model');
  });

  it('does not retry an integrity failure', async () => {
    createDownloadTask.mockReturnValue({ downloadAsync: async () => destination(), release() {} });
    await assert.rejects(downloadFileWithRetry('https://example.com/model.bin', destination(), 'voice model', () => {
      throw new ModelDownloadError('integrity', 'The download failed integrity verification.', false);
    }), /integrity verification/);
    assert.equal(createDownloadTask.mock.calls.length, 1);
  });

  it('throws the classified error after the retry budget is exhausted', async () => {
    createDownloadTask.mockReturnValue({
      downloadAsync: async () => { throw new Error('java.net.SocketTimeoutException: timeout'); }, release() {},
    });
    const rejection = assert.rejects(
      downloadFileWithRetry('https://example.com/model.bin', destination(), 'voice model'),
      (error: Error & { code?: string }) => error.code === 'timeout',
    );
    await vi.advanceTimersByTimeAsync(1500);
    await rejection;
    assert.equal(createDownloadTask.mock.calls.length, 2);
  });
});
