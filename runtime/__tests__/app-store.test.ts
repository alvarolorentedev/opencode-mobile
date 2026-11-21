import { describe, expect, it } from 'vitest';

import { createAppStore } from '@/runtime/core/store';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

const defaults = {
  settings: { serverUrl: 'http://one', username: '', password: '', directory: '' },
  chatPreferences: { themeMode: 'system' } as ChatPreferences,
  controlPlaneUrl: 'https://control',
};

describe('app store', () => {
  it('keeps separate store instances isolated', () => {
    const a = createAppStore(defaults), b = createAppStore(defaults);
    a.getState().setShellValue('onboardingVersion', 3);
    expect(a.getState().shell.onboardingVersion).toBe(3);
    expect(b.getState().shell.onboardingVersion).toBe(0);
  });

  it('applies functional updates against the latest value and preserves other fields', () => {
    const store = createAppStore(defaults);
    store.getState().setShellValue('favoriteSessions', (current) => [
      ...current,
      { sessionId: 's', connectionScope: 'scope', projectPath: '/p', favoritedAt: 1 },
    ]);
    store.getState().setShellValue('onboardingActive', true);
    expect(store.getState().shell.favoriteSessions).toHaveLength(1);
    expect(store.getState().shell.onboardingActive).toBe(true);
    expect(store.getState().shell.controlPlaneUrl).toBe('https://control');
    expect(store.getState().shell.settings).toBe(defaults.settings);
  });
});
