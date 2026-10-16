import type { ConnectionActionsInput } from '@/providers/opencode-provider-action-inputs';
import { useConnectionConnectActions } from '@/providers/use-connection-connect-actions';
import { useConnectionProfileActions } from '@/providers/use-connection-profile-actions';
import { useConnectionLinkActions } from '@/providers/use-connection-link-actions';
import { useServicesState } from '@/providers/use-services-state';

export function useConnectionActions(input: ConnectionActionsInput) {
  const connectActions = useConnectionConnectActions(input);
  const profileActions = useConnectionProfileActions({ ...input, ...connectActions });
  const linkActions = useConnectionLinkActions({ ...input, ...connectActions });
  const services = useServicesState({ settings: input.settings, scopeGenerationRef: input.scopeGenerationRef });
  return { ...connectActions, ...profileActions, ...linkActions, ...services };
}
