import { memo, useCallback, useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import { defaultChatPreferences, type ChatPreferences } from '@/providers/opencode-preferences';
import { serverPreferences, type useWorkspaceConnections } from '@/providers/use-workspace-connections';
import { useOpencodeProviderComposition } from '@/providers/use-opencode-provider-composition';
import { workspaceKey, type WorkspaceRuntimeInput, type WorkspaceSnapshot } from '@/providers/workspace-types';

type Manager = ReturnType<typeof useWorkspaceConnections>;
type Props = Omit<WorkspaceRuntimeInput, 'setSettings' | 'setChatPreferences' | 'preferences'> & {
  defaults: ChatPreferences;
  updateSettings: Manager['updateSettings'];
  updatePreferences: Manager['updatePreferences'];
  publish: (key: string, snapshot: WorkspaceSnapshot) => void;
  forget: (key: string) => void;
};
export const WorkspaceRuntime = memo(function WorkspaceRuntime({ defaults, updateSettings, updatePreferences, publish, forget, ...input }: Props) {
  const id = input.connection.id;
  const key = workspaceKey({ connectionId: id, projectPath: input.projectPath ?? '' });
  const preferences = useMemo(() => ({ ...defaults, ...serverPreferences(defaultChatPreferences), providerId: undefined, modelId: undefined, ...input.connection.preferences }), [defaults, input.connection.preferences]);
  const latest = useRef({ settings: input.connection.settings, preferences });
  useLayoutEffect(() => { latest.current = { settings: input.connection.settings, preferences }; });
  const setSettings = useCallback<Dispatch<SetStateAction<OpencodeConnectionSettings>>>((next) => {
    updateSettings(id, typeof next === 'function' ? next(latest.current.settings) : next, key);
  }, [id, key, updateSettings]);
  const setChatPreferences = useCallback<Dispatch<SetStateAction<ChatPreferences>>>((next) => {
    updatePreferences(id, typeof next === 'function' ? next(latest.current.preferences) : next);
  }, [id, updatePreferences]);
  const runtime = useOpencodeProviderComposition({ ...input, preferences, setSettings, setChatPreferences });
  useLayoutEffect(() => { publish(key, runtime); }, [key, publish, runtime]);
  useLayoutEffect(() => () => forget(key), [forget, key]);
  return null;
});
