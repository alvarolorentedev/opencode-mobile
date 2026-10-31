import type { ServerContract } from '@/shared/protocol/opencode/client';

// Which server-owned surfaces the connected contract exposes, plus the
// permission policy that backs the auto-approve toggle.

export type ServerCapabilities = {
  contract: ServerContract;
  fileSave: boolean;
  fileStatus: boolean;
  mcpOAuth: boolean;
  savedPermissions: boolean;
  autoApprove: boolean;
  promptDeliveryAvailable: boolean;
  mcpIntegrationId: boolean;
  contextMentions: boolean;
  shellCommand: boolean;
};

export function getServerCapabilities(contract: ServerContract): ServerCapabilities {
  const full = contract === 'v1';
  return {
    contract,
    fileSave: true,
    fileStatus: true,
    mcpOAuth: true,
    // Server-persisted "always allow" rules are a V2 surface.
    savedPermissions: !full,
    autoApprove: !full,
    promptDeliveryAvailable: !full,
    mcpIntegrationId: !full,
    // API-dependent composer surfaces are V2-only for now.
    contextMentions: !full,
    shellCommand: !full,
  };
}
