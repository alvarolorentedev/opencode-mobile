import { File, Paths } from 'expo-file-system';

import { LAST_JS_ERROR_FILENAME } from '@/lib/storage-keys';

type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
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
    file.write(JSON.stringify({ ...details, isFatal: Boolean(isFatal), at: Date.now() }));
  } catch {
    // Best effort: diagnostics must never mask the original crash.
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
