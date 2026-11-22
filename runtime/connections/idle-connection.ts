import type { ConnectionLifecycle } from '@/features/connections/index';

export const idleConnection: ConnectionLifecycle = {
  phase: 'idle',
  operation: 0,
  connection: { status: 'idle', message: 'Disconnected' },
  contract: 'v2',
};
