import { skipToken, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import type { WorkspaceCatalog } from '@/shared/contracts/workspace';
import { changeAppLanguage } from '@/shared/i18n/index';
import { startWorkingSoundAsync, stopWorkingSoundAsync, unloadWorkingSoundAsync } from '@/shared/platform/voice/working-sound';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { buildClient } from '@/shared/protocol/opencode/client';
import type { Session, Todo } from '@/shared/protocol/opencode/types';
import { todosKey, transcriptMetadataKey, type TranscriptMetadata } from '@/shared/server-data/session-plans';
import { getActiveSessions, MAX_ACTIVE_SESSIONS, projectSessionsKey, useNativeSurfaces } from '@/features/sessions/runtime';
import { getConversationPhase } from '@/features/voice/runtime';
import { useWidgetState } from '@/features/widgets/runtime';
import { useAppCore, useAppStore, useConnectionLifecycles, useProjectScope } from '@/runtime/core';

const EMPTY_SESSIONS: Session[] = [];
const EMPTY = {};

export function WorkspaceNative({ catalogs, preferences, ready, busy }: {
  catalogs: Record<string, WorkspaceCatalog>;
  preferences: ChatPreferences;
  ready: boolean;
  busy: boolean;
}) {
  const { client, connected, identity, manager, scopeKey, settings } = useProjectScope();
  const { connectionId, connectionScope } = identity;
  const contract = client.__opencode.contract;
  const { connections } = useAppCore();
  const records = useAppStore((state) => state.registry.connections);
  const currentSessionId = useAppStore((state) => state.selection[scopeKey]?.currentSessionId);
  const lifecycles = useConnectionLifecycles();
  const activeSessions = useMemo(() => records.flatMap(({ id, enabled, settings }) => {
    const catalog = catalogs[id];
    if (!enabled || !catalog || lifecycles.get(id)?.connection.status !== 'connected') return [];
    const connectionScope = getConnectionScope(settings);
    return getActiveSessions({ sessions: catalog.sessions, statuses: catalog.statuses,
      hideSubagentChats: preferences.hideSubagentChats === true, maxTotal: MAX_ACTIVE_SESSIONS })
      .map((session) => ({ ...session, connectionScope }));
  }).sort((a, b) => Number(b.status.type !== 'idle') - Number(a.status.type !== 'idle') || b.updatedAt - a.updatedAt),
  [catalogs, lifecycles, preferences.hideSubagentChats, records]);
  useNativeSurfaces({ ready, connected: Boolean(connectionId) && [...lifecycles.values()].some(({ connection }) => connection.status === 'connected'),
    connectionScope, language: preferences.language, activeSessions });

  const catalogClient = useMemo(() => manager?.getCatalogClient() ?? buildClient({ ...settings, directory: '' }, contract),
    [contract, manager, settings]);
  const isCurrentCatalogClient = useCallback((candidate: object) => candidate === connections.get(connectionId)?.getCatalogClient(), [connectionId, connections]);
  const isStreamConnected = useCallback(() => manager?.realtime.getStatus() === 'connected', [manager]);
  const { data: sessions = EMPTY_SESSIONS } = useQuery<Session[]>({ queryKey: projectSessionsKey(identity, client), queryFn: skipToken });
  const { data: metadata } = useQuery<TranscriptMetadata>({ queryKey: transcriptMetadataKey(identity, client), queryFn: skipToken });
  const { data: todosBySession = EMPTY } = useQuery<Record<string, Todo[]>>({ queryKey: todosKey(identity, client), queryFn: skipToken });
  const widgets = useWidgetState({ catalogClient, contract, settings, connectionScope, isCurrentCatalogClient, isStreamConnected,
    sessions, todoRecordsBySession: metadata?.todoRecordsBySession ?? EMPTY, todosBySession, currentSessionId, hydrated: ready, connected,
    showPreviews: preferences.showWidgetPreviews !== false, language: preferences.language });
  const { handleWidgetEvent } = widgets;
  useEffect(() => {
    if (connected) return manager?.events.observe(handleWidgetEvent);
  }, [manager, connected, handleWidgetEvent]);
  useEffect(() => { if (ready) changeAppLanguage(preferences.language); }, [preferences.language, ready]);
  const phase = useAppStore(({ conversation }) => {
    const state = conversation[scopeKey];
    return state ? getConversationPhase(state.phase, state.readbackPhase, preferences.wakePhraseRequired) : 'off';
  });
  useEffect(() => {
    if (Platform.OS !== 'web' && preferences.workingSoundEnabled && busy && phase !== 'listening' && phase !== 'speaking') {
      void startWorkingSoundAsync(preferences.workingSoundVariant, preferences.workingSoundVolume).catch(() => undefined);
    } else void stopWorkingSoundAsync().catch(() => undefined);
  }, [busy, phase, preferences.workingSoundEnabled, preferences.workingSoundVariant, preferences.workingSoundVolume]);
  useEffect(() => () => { void unloadWorkingSoundAsync().catch(() => undefined); }, []);
  return null;
}
