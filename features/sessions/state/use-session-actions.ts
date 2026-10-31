import type { SessionActionsInput } from '@/features/sessions/model/action-inputs';
import { useSessionCrudActions } from '@/features/sessions/state/use-session-crud-actions';
import { useSessionFavoriteActions } from '@/features/sessions/state/use-session-favorite-actions';
import { useSessionInteractionActions } from '@/features/sessions/state/use-session-interaction-actions';
import { useSessionBootstrapActions } from '@/features/sessions/state/use-session-bootstrap-actions';

export function useSessionActions(input: SessionActionsInput) {
  const crud = useSessionCrudActions(input);
  const favorites = useSessionFavoriteActions(input);
  const interactions = useSessionInteractionActions(input);
  const bootstrap = useSessionBootstrapActions({ ...input, createSession: crud.createSession });
  return { ...crud, ...favorites, ...interactions, ...bootstrap };
}
