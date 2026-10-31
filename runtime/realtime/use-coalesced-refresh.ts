import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// Collapse a burst of server events into one refresh. The latest callback is
// read through a ref so callers can recreate the refresh function without
// resetting the pending timer.
export function useCoalescedRefresh(refresh: () => Promise<unknown>, delayMs = 200) {
  const latest = useRef(refresh);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => { latest.current = refresh; });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void latest.current().catch(() => undefined);
    }, delayMs);
  }, [delayMs]);
}
