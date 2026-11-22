import type { SessionActionsInput } from '@/features/sessions/model/action-inputs';
import { useSessionExecutionActions } from '@/features/sessions/state/use-session-execution-actions';
import { useSessionFavoriteActions } from '@/features/sessions/state/use-session-favorite-actions';

export function useSessionActions(input: SessionActionsInput) {
  const execution = useSessionExecutionActions(input);
  const favorites = useSessionFavoriteActions(input);
  return { ...execution, ...favorites };
}
