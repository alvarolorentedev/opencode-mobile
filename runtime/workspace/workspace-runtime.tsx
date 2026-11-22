import { memo, useCallback, useLayoutEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { defaultChatPreferences, type ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { serverPreferences, type useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import { useOpencodeProviderComposition } from '@/runtime/composition/use-opencode-provider-composition';
import { workspaceKey } from '@/shared/contracts/workspace';
import type { WorkspaceRuntimeInput, WorkspaceSnapshot } from '@/runtime/workspace/workspace-types';
import { useAppCore } from '@/runtime/core';

type Manager = ReturnType<typeof useWorkspaceConnections>;
type Props = Omit<WorkspaceRuntimeInput, 'setSettings' | 'setChatPreferences' | 'preferences'> & {
  defaults: ChatPreferences;
  updateSettings: Manager['updateSettings'];
  updatePreferences: Manager['updatePreferences'];
  publish: (key: string, snapshot: WorkspaceSnapshot) => void;
  forget: (key: string) => void;
};
export const WorkspaceRuntime = memo(function WorkspaceRuntime({ defaults, updateSettings, updatePreferences, publish, forget, ...input }: Props) {
  const { store } = useAppCore();
  const id = input.connection.id;
  const key = workspaceKey({ connectionId: id, projectPath: input.projectPath ?? '' });
  const preferences = useMemo(() => ({ ...defaults, ...serverPreferences(defaultChatPreferences), ...input.connection.preferences }), [defaults, input.connection.preferences]);
  const setSettings = useCallback<Dispatch<SetStateAction<OpencodeConnectionSettings>>>((next) => {
    const entry = store.getState().registry.connections.find((candidate) => candidate.id === id);
    if (entry) updateSettings(id, typeof next === 'function' ? next(entry.settings) : next, key);
  }, [id, key, store, updateSettings]);
  const setChatPreferences = useCallback<Dispatch<SetStateAction<ChatPreferences>>>((next) => {
    const { registry, shell } = store.getState();
    const entry = registry.connections.find((candidate) => candidate.id === id);
    if (!entry) return;
    updatePreferences(id, typeof next === 'function' ? next({ ...shell.chatPreferences, ...serverPreferences(defaultChatPreferences), ...entry.preferences }) : next);
  }, [id, store, updatePreferences]);
  const runtime = useOpencodeProviderComposition({ ...input, preferences, setSettings, setChatPreferences });
  useLayoutEffect(() => { publish(key, runtime); }, [key, publish, runtime]);
  useLayoutEffect(() => () => forget(key), [forget, key]);
  return null;
});
