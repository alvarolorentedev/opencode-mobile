import { useLayoutEffect } from 'react';

import { useUpdates } from '@/providers/opencode-contexts';

// Only the presence of local interaction/unsaved work is shared, never its contents.
export function useUpdateBlocker(active: boolean) {
  const { block } = useUpdates();
  useLayoutEffect(() => active ? block() : undefined, [active, block]);
}
