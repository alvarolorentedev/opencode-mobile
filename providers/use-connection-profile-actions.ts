import { useConnectionProfiles } from '@/providers/use-connection-profiles';
import type { ConnectionActionsInput } from '@/providers/opencode-provider-action-inputs';
import type { useConnectionConnectActions } from '@/providers/use-connection-connect-actions';

type ConnectionProfileActionsInput = ConnectionActionsInput
  & Pick<ReturnType<typeof useConnectionConnectActions>, 'switchConnection' | 'updateSettings' | 'connectSetup'>;

export function useConnectionProfileActions({ settings, switchConnection, updateSettings, connectSetup }: ConnectionProfileActionsInput) {
  const connectionProfiles = useConnectionProfiles({ settings, switchConnection, updateSettings, profileSnapshot: connectSetup.profiles });
  return { connectionProfiles };
}
