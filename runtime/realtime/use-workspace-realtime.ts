import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import type { createRealtime, RealtimeScopeInput } from '@/runtime/realtime/create-realtime';
import type { StreamStatus } from '@/runtime/realtime/transport';

const idle = (): StreamStatus => 'idle';
const noSubscription = () => () => undefined;

export function useWorkspaceRealtime(realtime: ReturnType<typeof createRealtime> | undefined, input: RealtimeScopeInput) {
  const scope = useRef<ReturnType<NonNullable<typeof realtime>['createScope']> | undefined>(undefined);
  useLayoutEffect(() => {
    scope.current = realtime?.createScope();
    return () => { scope.current?.dispose(); scope.current = undefined; };
  }, [realtime]);
  useLayoutEffect(() => { scope.current?.update(input); });
  return useSyncExternalStore(realtime?.subscribe ?? noSubscription, realtime?.getStatus ?? idle, idle);
}
