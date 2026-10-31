import { File, Paths } from 'expo-file-system';

import { LAST_JS_ERROR_FILENAME } from '@/shared/storage/keys';

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
    const details = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error), stack: undefined };
    const file = new File(Paths.document, LAST_JS_ERROR_FILENAME);
    if (!file.exists) {
      file.create();
    }
    // Fatal handlers must finish recording before delegating to the original handler.
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
      message: parsed.message,
      stack: typeof parsed.stack === 'string' ? parsed.stack : undefined,
      isFatal: Boolean(parsed.isFatal),
      at: parsed.at,
    };
  } catch {
    // Diagnostics must never mask the original crash with a read failure.
    return undefined;
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
    originalHandler(error, isFatal);
  });
}
