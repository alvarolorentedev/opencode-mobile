import { useMemo } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';

export function useFileClipboard() {
  const { clipboard: { select, run, register, refresh } } = useAppCore();
  const { entries, busy } = useAppStore((state) => state.fileClipboard);
  return useMemo(() => ({ entries, busy, select, run, register, refresh }), [entries, busy, select, run, register, refresh]);
}

export type FileClipboard = ReturnType<typeof useFileClipboard>;
