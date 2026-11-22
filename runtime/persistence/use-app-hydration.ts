import { useEffect, useState } from 'react';

import type { AppCore } from '@/runtime/core/create-app-core';

export function useAppHydration(persistence: AppCore['persistence']) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void persistence.hydrate().catch((error) => console.warn('Could not hydrate app settings.', error)).then(() => {
      if (!active) return;
      stop = persistence.observeSettings();
      setHydrated(true);
    });
    return () => { active = false; stop?.(); };
  }, [persistence]);
  return hydrated;
}
