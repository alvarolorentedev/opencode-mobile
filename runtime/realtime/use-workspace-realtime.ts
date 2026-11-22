import { useLayoutEffect, useRef } from 'react';

import type { createRealtime, RealtimeScopeInput } from '@/runtime/realtime/create-realtime';

export function useWorkspaceRealtime(realtime: ReturnType<typeof createRealtime> | undefined, input: RealtimeScopeInput) {
  const scope = useRef<ReturnType<NonNullable<typeof realtime>['createScope']> | undefined>(undefined);
  useLayoutEffect(() => {
    scope.current = realtime?.createScope();
    return () => { scope.current?.dispose(); scope.current = undefined; };
  }, [realtime]);
  useLayoutEffect(() => { scope.current?.update(input); });
}
