import { AppState } from 'react-native';

import type { Observability } from '@/shared/observability/types';

let installed = false;

// Lifecycle instrumentation is intentionally tiny: one AppState listener, no
// timers while backgrounded, and a best-effort flush on the way out.
export function installObservabilityLifecycle(target: Observability) {
  if (installed) return;
  installed = true;
  let backgroundedAt = AppState.currentState === 'active' ? 0 : Date.now();
  target.markStartup('lifecycle');
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      const backgroundedFor = backgroundedAt ? Math.max(0, Date.now() - backgroundedAt) : 0;
      backgroundedAt = 0;
      target.info('app.lifecycle', { phase: 'foreground', foreground: true, durationMs: backgroundedFor });
    } else {
      if (!backgroundedAt) backgroundedAt = Date.now();
      target.info('app.lifecycle', { phase: 'background', foreground: false });
      void target.flush();
    }
  });
}
