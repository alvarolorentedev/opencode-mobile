import type { ConnectPhase } from '@/features/cloud-link/state/connect/catalog';
export type ConnectLifecycle = {
  initialization: 'loading' | 'ready' | 'error'; phase: ConnectPhase;
  operation: 'idle' | 'running'; error?: string; notice?: string;
  retryable: boolean; purchaseRecovery?: 'unverified' | 'verified';
};
export const initialConnectLifecycle: ConnectLifecycle = { initialization: 'loading', phase: 'idle', operation: 'idle', retryable: false };
export type ConnectTransition =
  | { type: 'started'; preserveError: boolean }
  | { type: 'completed' }
  | { type: 'failed'; message: string }
  | { type: 'phase'; phase: ConnectPhase }
  | { type: 'initialization'; status: ConnectLifecycle['initialization'] }
  | { type: 'recovery'; checkpoint?: ConnectLifecycle['purchaseRecovery'] }
  | { type: 'error'; message?: string }
  | { type: 'notice'; message?: string }
  | { type: 'retry'; allowed: boolean }
  | { type: 'environmentChanged' };
export function connectTransition(state: ConnectLifecycle, event: ConnectTransition): ConnectLifecycle {
  switch (event.type) {
    case 'started': return { ...state, operation: 'running', error: event.preserveError ? state.error : undefined, notice: undefined, retryable: false };
    case 'completed': return { ...state, operation: 'idle' };
    case 'failed': return { ...state, error: event.message, retryable: true, phase: state.phase === 'delayed' ? 'delayed' : 'idle' };
    case 'phase': return { ...state, phase: event.phase };
    case 'initialization': return { ...state, initialization: event.status };
    case 'recovery': return { ...state, purchaseRecovery: event.checkpoint };
    case 'error': return { ...state, error: event.message };
    case 'notice': return { ...state, notice: event.message };
    case 'retry': return { ...state, retryable: event.allowed };
    case 'environmentChanged': return { ...initialConnectLifecycle, purchaseRecovery: state.purchaseRecovery };
  }
}
