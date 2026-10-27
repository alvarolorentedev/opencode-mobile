import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { changeAppLanguage } from '@/lib/i18n';
import { startWorkingSoundAsync, stopWorkingSoundAsync, unloadWorkingSoundAsync } from '@/lib/voice/working-sound';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import { useNativeSurfaces } from '@/providers/use-native-surfaces';
import { useWidgetState } from '@/providers/use-widget-state';
import { useWorkspaces } from '@/providers/workspace-context';
import type { WorkspaceSnapshot } from '@/providers/workspace-types';

export function WorkspaceNative({ runtime, preferences, ready, busy, active = true }: { runtime: WorkspaceSnapshot; preferences: ChatPreferences; ready: boolean; busy: boolean; active?: boolean }) {
  const registry = useWorkspaces();
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
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        try { for await (const event of entry.events(runtime.catalogClient, controller.signal)) handleWidgetEvent(event); }
        catch { /* Keep the last widget snapshot during transport recovery. */ }
        if (!controller.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();
    return () => controller.abort();
  }, [registry.connections, runtime.catalogClient, runtime.native.settings, connected, handleWidgetEvent]);
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
