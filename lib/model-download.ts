import { File } from 'expo-file-system';

export type ModelDownloadErrorCode =
  | 'timeout'
  | 'offline'
  | 'server'
  | 'storage'
  | 'incomplete'
  | 'integrity'
  | 'unknown';

/** `install` means the transfer finished (or never started) but installing failed. */
export type ModelInstallErrorCode = ModelDownloadErrorCode | 'install';

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_500;

export class ModelDownloadError extends Error {
  readonly code: ModelDownloadErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ModelDownloadErrorCode,
    message: string,
    retryable: boolean,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'ModelDownloadError';
    this.code = code;
    this.retryable = retryable;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return `${error.name} ${error.message}${cause === undefined ? '' : ` ${errorText(cause)}`}`;
  }
  return typeof error === 'string' ? error : String(error ?? '');
}

/**
 * Maps native download failures (OkHttp, URLSession, or Expo's wrapper) to a
 * code the UI can translate. Raw exception text is retained on the error cause
 * for logs, never shown to the user.
 */
export function classifyModelDownloadError(error: unknown): ModelDownloadErrorCode {
  const text = errorText(error);
  if (/(?:SocketTimeout|ETIMEDOUT|timed out|timeout|NSURLErrorTimedOut|-1001)/i.test(text)) {
    return 'timeout';
  }
  if (/(?:UnknownHost|Unable to resolve host|No address associated|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|network is unreachable|could not connect|could not be found|-1003|-1004|-1009)/i.test(text)) {
    return 'offline';
  }
  if (/(?:ENOSPC|No space left|not enough space|disk full)/i.test(text)) {
    return 'storage';
  }
  if (/(?:HTTP\s*[45]\d\d|status(?:\s*code)?\s*:?\s*[45]\d\d|NSURLErrorBadServerResponse)/i.test(text)) {
    return 'server';
  }
  return 'unknown';
}

function isRetryableFailure(code: ModelDownloadErrorCode, error: unknown): boolean {
  if (code === 'timeout' || code === 'offline' || code === 'incomplete') {
    return true;
  }
  if (code === 'server') {
    const status = Number(/(?:HTTP|status(?:\s*code)?)\s*:?\s*(\d{3})/i.exec(errorText(error))?.[1]);
    return Number.isFinite(status) && (status >= 500 || status === 408 || status === 429);
  }
  return false;
}

export function isRetryableModelDownloadError(error: unknown): boolean {
  const code = error instanceof ModelDownloadError
    ? error.code
    : classifyModelDownloadError(error);
  return error instanceof ModelDownloadError ? error.retryable : isRetryableFailure(code, error);
}

function toModelDownloadError(error: unknown, label: string): ModelDownloadError {
  if (error instanceof ModelDownloadError) {
    return error;
  }
  const code = classifyModelDownloadError(error);
  return new ModelDownloadError(
    code,
    `The ${label} download failed.`,
    isRetryableFailure(code, error),
    error,
  );
}

function removeFile(file: File) {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Best-effort cleanup; the original failure is more useful.
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function downloadOnce(url: string, destination: File): Promise<File> {
  // DownloadTask keeps the native transfer's 60 s connect/read timeout on
  // Android, unlike File.downloadFileAsync's 10 s default. Weak cellular links
  // routinely stall longer than 10 s, which surfaced as SocketTimeoutException.
  const task = File.createDownloadTask(url, destination, { sessionType: 'foreground' });
  try {
    const file = await task.downloadAsync();
    if (!file) {
      throw new ModelDownloadError(
        'unknown',
        'The download was paused before it finished.',
        false,
      );
    }
    return file;
  } finally {
    try {
      task.release();
    } catch {
      // Native task cleanup is best effort.
    }
  }
}

/**
 * Downloads a model asset with one retry for transient network failures.
 *
 * `verify` runs inside the retry loop so a truncated or corrupted transfer is
 * retried once without duplicating the transfer policy at each call site.
 */
export async function downloadFileWithRetry(
  url: string,
  destination: File,
  label: string,
  verify?: (file: File) => void | Promise<void>,
): Promise<File> {
  let failure: ModelDownloadError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const file = await downloadOnce(url, destination);
      await verify?.(file);
      return file;
    } catch (error) {
      failure = toModelDownloadError(error, label);
      removeFile(destination);
      if (!failure.retryable || attempt >= MAX_ATTEMPTS) {
        break;
      }
      await delay(RETRY_DELAY_MS);
    }
  }

  const finalFailure = failure ?? new ModelDownloadError(
    'unknown',
    `The ${label} download failed.`,
    false,
  );
  console.warn('[model-download] transfer failed', label, finalFailure.cause ?? finalFailure);
  throw finalFailure;
}

export function modelDownloadErrorCode(error: unknown): ModelInstallErrorCode {
  return error instanceof ModelDownloadError ? error.code : 'install';
}

export function modelDownloadMessageKeyForCode(code: ModelInstallErrorCode): string {
  return code === 'install'
    ? 'settings:voice.modelDownloads.installFailed'
    : `settings:voice.modelDownloads.${code}`;
}

export function modelDownloadErrorMessageKey(error: unknown): string {
  return modelDownloadMessageKeyForCode(modelDownloadErrorCode(error));
}
