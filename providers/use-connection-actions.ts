import type { ConnectionActionsInput } from '@/providers/opencode-provider-action-inputs';
import type { WorkspaceRuntimeInput } from '@/providers/workspace-types';
import { useConnectionConnectActions } from '@/providers/use-connection-connect-actions';
import { useConnectionLinkActions } from '@/providers/use-connection-link-actions';

export function useConnectionActions(input: ConnectionActionsInput, shared: WorkspaceRuntimeInput) {
  const connectActions = useConnectionConnectActions({ ...input, connectSetup: shared.connectSetup });
  const linkActions = useConnectionLinkActions({ ...input, ...connectActions });
  return { ...connectActions, ...linkActions, connectionProfiles: shared.connectionProfiles, servicesValue: shared.servicesValue };
}
