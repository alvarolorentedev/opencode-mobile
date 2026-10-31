import { useCallback, useState } from 'react';

import { readLastJsError, type RecordedJsError } from '@/shared/platform/error-reporting';

// Local-only crash diagnostics: the last JS error recorded on this device.
// Surfaced in Settings → Diagnostics; there is no remote reporter.
export function useLastJsError() {
  const [lastJsError, setLastJsError] = useState<RecordedJsError | undefined>(() => readLastJsError());
  const refreshLastJsError = useCallback(() => setLastJsError(readLastJsError()), []);
  return { lastJsError, refreshLastJsError };
}
