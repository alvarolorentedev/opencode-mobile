import { useMemo } from 'react';

import type { SessionMessageRecord } from '@/shared/presentation/format';

import { getSessionPreviewById } from '../model/selectors';

export function useSessionPreviews(messagesBySession: Record<string, SessionMessageRecord[]>) {
  return useMemo(() => getSessionPreviewById(messagesBySession), [messagesBySession]);
}
