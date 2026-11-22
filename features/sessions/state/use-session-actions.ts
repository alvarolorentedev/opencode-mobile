import type { SessionActionsInput } from '@/features/sessions/model/action-inputs';
import { useSessionCrudActions } from '@/features/sessions/state/use-session-crud-actions';
import { useSessionFavoriteActions } from '@/features/sessions/state/use-session-favorite-actions';

export function useSessionActions(input: SessionActionsInput) {
  const crud = useSessionCrudActions(input);
  const favorites = useSessionFavoriteActions(input);
  return { ...crud, ...favorites };
}
