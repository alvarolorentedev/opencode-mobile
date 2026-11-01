import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';

import { observability } from '@/shared/observability';
import { sanitizeError, scrubStack, scrubText } from '@/shared/observability/sanitize';
import { LAST_JS_ERROR_FILENAME, LAST_JS_ERROR_INGESTED_STORAGE_KEY } from '@/shared/storage/keys';

type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

export type RecordedJsError = {
  message: string;
  stack?: string;
  isFatal: boolean;
  at: number;
};

let installed = false;

function recordJsError(error: unknown, isFatal?: boolean) {
  try {
    // The synchronous file write is deliberate: a fatal handler cannot await the
    // buffered diagnostic transport before the process dies. The next launch
    // copies this record into the bounded local stream.
    const details = sanitizeError(error);
    const file = new File(Paths.document, LAST_JS_ERROR_FILENAME);
    if (!file.exists) {
      file.create();
    }
    file.writeSync(JSON.stringify({ ...details, isFatal: Boolean(isFatal), at: Date.now() }));
  } catch {
    // Best effort: diagnostics must never mask the original crash.
  }
}

// Reads the last crash recorded by `recordJsError`. Returns undefined when
// nothing was recorded or the file is unreadable/corrupt, so the diagnostics
// surface can render a neutral empty state instead of throwing.
export function readLastJsError(): RecordedJsError | undefined {
  try {
    const file = new File(Paths.document, LAST_JS_ERROR_FILENAME);
    if (!file.exists) {
      return undefined;
    }
    const parsed = JSON.parse(file.textSync()) as Partial<RecordedJsError>;
    if (typeof parsed.message !== 'string' || typeof parsed.at !== 'number') {
      return undefined;
    }
    return {
      message: scrubText(parsed.message),
      stack: scrubStack(typeof parsed.stack === 'string' ? parsed.stack : undefined),
      isFatal: Boolean(parsed.isFatal),
      at: parsed.at,
    };
  } catch {
    // Diagnostics must never mask the original crash with a read failure.
    return undefined;
  }
}

// Copies the synchronous crash record into the bounded local diagnostics stream
// once. It deliberately uses the local-only path: a crash recorded before
// consent must never be uploaded later when consent is granted.
export async function ingestRecordedJsError() {
  const error = readLastJsError();
  if (!error) return;
  try {
    const marker = String(error.at);
    if (await AsyncStorage.getItem(LAST_JS_ERROR_INGESTED_STORAGE_KEY) === marker) return;
    observability.captureError(
      { name: 'JsError', message: error.message, stack: error.stack },
      { fatal: error.isFatal },
      false,
    );
    await AsyncStorage.setItem(LAST_JS_ERROR_INGESTED_STORAGE_KEY, marker);
  } catch {
    // A persistence failure only means the crash may be revisited next launch.
  }
}

export function installGlobalErrorHandler() {
  if (installed) {
    return;
  }

  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils) {
    return;
  }

  installed = true;
  const originalHandler = errorUtils.getGlobalHandler();
  // ponytail: records only, then delegates — a fatal JS error cannot be recovered from.
  errorUtils.setGlobalHandler((error, isFatal) => {
    recordJsError(error, isFatal);
    observability.captureError(error, { fatal: Boolean(isFatal) });
    originalHandler(error, isFatal);
  });

  const globalWithEvents = globalThis as typeof globalThis & {
    addEventListener?: (type: string, listener: (event: { reason?: unknown; promise?: unknown }) => void) => void;
  };
  if (typeof globalWithEvents.addEventListener === 'function') {
    globalWithEvents.addEventListener('unhandledrejection', (event) => {
      observability.captureError(event.reason, { reason: 'unhandled-rejection' });
    });
  }
}
