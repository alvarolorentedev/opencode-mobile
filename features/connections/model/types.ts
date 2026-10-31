import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';

import type { Diagnostics } from '@/shared/protocol/services/diagnostics-service';

import type { NetworkStatus } from '@/shared/network/network-status';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import type { ServerCapabilities } from '@/shared/protocol/opencode/capabilities';

import type { ConnectionState , ServiceManagementApi } from '@/shared/contracts/domain';

export type ConnectionContextValue = {
  connectionProfiles: import('@/features/connections/state/use-connection-profiles').ConnectionProfilesState;
  connectSetup: import('@/shared/contracts/cloud-link-setup').ConnectSetup;
  settings: OpencodeConnectionSettings;
  updateSettings: (patch: Partial<OpencodeConnectionSettings>) => void;
  switchConnection: (
    next: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username' | 'password' | 'headers' | 'connect'>,
    modelPreferences?: Partial<ChatPreferences>,
  ) => Promise<ConnectionState>;
  connection: ConnectionState;
  serverCapabilities: ServerCapabilities;
  connect: () => Promise<ConnectionState>;
  services: ServiceManagementApi;
};

export type DiagnosticsContextValue = {
  diagnostics?: Diagnostics;
  refreshDiagnostics: () => Promise<void>;
  eventStreamStatus: 'idle' | 'connecting' | 'connected' | 'error';
  // Grouped transport state so diagnostics can show why a 4G link feels slow
  // without widening the public context surface one field at a time.
  transport: {
    network: NetworkStatus;
    reconnect: { attempt: number; maxAttempts: number; retryAt?: number };
  };
};
