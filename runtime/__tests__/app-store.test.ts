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

  it('merges registry patches without dropping connections', () => {
    const store = createAppStore(defaults);
    const connections = [{ id: 'c', name: 'C', enabled: true, settings: defaults.settings, preferences: {}, projects: ['/p'] }];
    store.getState().setRegistry({ ready: true, connections });
    store.getState().setRegistry((current) => ({
      focus: { connectionId: 'c', projectPath: '/p' },
      ready: current.ready,
    }));
    expect(store.getState().registry.ready).toBe(true);
    expect(store.getState().registry.focus).toEqual({ connectionId: 'c', projectPath: '/p' });
    expect(store.getState().registry.connections).toBe(connections);
  });

  it('scopes selection by workspace and preserves sibling scopes', () => {
    const store = createAppStore(defaults);
    store.getState().setSelection('["a","/one"]', { currentSessionId: 's1' });
    store.getState().setSelection('["a","/two"]', (current) => ({ currentSessionId: 's2', activeSessionsVisible: !current.activeSessionsVisible }));
    expect(store.getState().selection['["a","/one"]']).toMatchObject({ currentSessionId: 's1', isBootstrappingChat: false });
    expect(store.getState().selection['["a","/two"]']).toMatchObject({ currentSessionId: 's2', activeSessionsVisible: true });
  });

  it('retains independent conversation turns and clears only the disposed workspace', () => {
    const { getState } = createAppStore(defaults);
    const actions = getState();
    actions.setConversationValue('one', 'phase', 'listening');
    actions.setConversationValue('one', 'turnSequence', (value) => value + 1);
    actions.setConversationValue('two', 'phase', 'armed');
    expect(getState().conversation.one).toMatchObject({ phase: 'listening', readbackPhase: 'idle', turnSequence: 1 });
    actions.clearConversation('one');
    expect(getState().conversation.one).toBeUndefined();
    expect(getState().conversation.two).toMatchObject({ phase: 'armed', turnSequence: 0 });
  });

  it('clears removed connection outboxes while preserving sibling connections and local IDs', () => {
    const store = createAppStore(defaults);
    const first = '["a","/one",""]';
    const other = '["b","/one",""]';
    const outbox = { sequence: 1, bySession: { session: [] } };
    store.getState().setPrompt(first, { outbox });
    store.getState().setPrompt(other, { outbox });
    store.getState().clearPromptOutboxes('a');
    expect(store.getState().prompt[first].outbox).toEqual({ sequence: 1, bySession: {} });
    expect(store.getState().prompt[other].outbox).toBe(outbox);
  });
});
