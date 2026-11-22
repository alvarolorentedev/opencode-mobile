import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { changeAppLanguage } from '@/shared/i18n/index';
import { startWorkingSoundAsync, stopWorkingSoundAsync, unloadWorkingSoundAsync } from '@/shared/platform/voice/working-sound';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { useNativeSurfaces } from '@/features/sessions/runtime';
import { useWidgetState } from '@/features/widgets/runtime';
import { useWorkspaces } from '@/runtime/workspace/workspace-context';
import { useAppCore } from '@/runtime/core';
import type { WorkspaceSnapshot } from '@/runtime/workspace/workspace-types';

export function WorkspaceNative({ runtime, preferences, ready, busy, active = true }: { runtime: WorkspaceSnapshot; preferences: ChatPreferences; ready: boolean; busy: boolean; active?: boolean }) {
  const registry = useWorkspaces();
  const { connections } = useAppCore();
  const connected = active && runtime.values.connectionValue.connection.status === 'connected';
  const activeSessions = useMemo(() => [...new Map(Object.entries(registry.snapshots).flatMap(([key, snapshot]) => {
    if (snapshot.values.connectionValue.connection.status !== 'connected') return [];
    const [id] = JSON.parse(key) as string[];
    return snapshot.native.activeSessions.map((session) => [JSON.stringify([id, session.projectPath, session.sessionId]), { ...session, connectionScope: snapshot.native.connectionScope }] as const);
  })).values()].sort((a, b) => Number(b.status.type !== 'idle') - Number(a.status.type !== 'idle') || b.updatedAt - a.updatedAt), [registry.snapshots]);
  useNativeSurfaces({ ready, connected: active && Object.values(registry.snapshots).some((snapshot) => snapshot.values.connectionValue.connection.status === 'connected'), connectionScope: runtime.native.connectionScope,
    language: preferences.language, activeSessions });
  const widgets = useWidgetState({ ...runtime.native, hydrated: ready, connected,
    showPreviews: preferences.showWidgetPreviews !== false, language: preferences.language });
  const { handleWidgetEvent } = widgets;
  useEffect(() => {
    const entry = registry.connections.find((item) => item.settings === runtime.native.settings);
    if (!entry || !connected) return;
    return connections.get(entry.id)?.events.observe(handleWidgetEvent);
  }, [connections, registry.connections, runtime.native.settings, connected, handleWidgetEvent]);
  useEffect(() => { if (ready) changeAppLanguage(preferences.language); }, [preferences.language, ready]);
  const phase = runtime.values.conversationValue.conversation.phase;
  useEffect(() => {
    if (Platform.OS !== 'web' && preferences.workingSoundEnabled && busy && phase !== 'listening' && phase !== 'speaking') {
      void startWorkingSoundAsync(preferences.workingSoundVariant, preferences.workingSoundVolume).catch(() => undefined);
    } else void stopWorkingSoundAsync().catch(() => undefined);
  }, [busy, phase, preferences.workingSoundEnabled, preferences.workingSoundVariant, preferences.workingSoundVolume]);
  useEffect(() => () => { void unloadWorkingSoundAsync().catch(() => undefined); }, []);
  return null;
}
