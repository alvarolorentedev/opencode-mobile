import type { ServerContract } from '@/lib/opencode/client';
import type { ConnectionState } from '@/providers/opencode-provider-types';
export type ConnectionLifecycle = { phase: 'disabled' | 'idle' | 'preparing' | 'probing' | 'connected' | 'failed'; operation: number; connection: ConnectionState; contract: ServerContract };
export type ConnectionTransition =
  | { type: 'start'; operation: number; message: string }
  | { type: 'probe'; operation: number }
  | { type: 'settle'; operation: number; connection: ConnectionState; contract?: ServerContract }
  | { type: 'disable'; operation: number };
export function connectionTransition(state: ConnectionLifecycle, event: ConnectionTransition): ConnectionLifecycle {
  if (event.operation < state.operation) return state;
  switch (event.type) {
    case 'start': return { ...state, operation: event.operation, phase: 'preparing', connection: { status: 'connecting', message: event.message } };
    case 'probe': return { ...state, phase: 'probing' };
    case 'settle': return { ...state, operation: event.operation, phase: event.connection.status === 'connected' ? 'connected' : 'failed', connection: event.connection, contract: event.contract ?? state.contract };
    case 'disable': return { ...state, operation: event.operation, phase: 'disabled', connection: { status: 'idle', message: 'Disconnected' } };
  }
}
