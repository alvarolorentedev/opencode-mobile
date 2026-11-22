import type { ModelOption } from '@/shared/contracts/model-options';
import { normalizeAutoModelPreferences } from '@/shared/preferences/auto-model';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import { reconcileEnabledModelIds } from './opencode-model-selection';

export function patchModelPreferences(
  current: ChatPreferences, patch: Partial<ChatPreferences>, configuredModels: ModelOption[],
): ChatPreferences {
  const priorModelIds = patch.enabledModelIds !== undefined && !current.knownModelIds.length
    ? configuredModels.map((model) => model.id)
    : current.knownModelIds;
  const modelIds = reconcileEnabledModelIds(
    configuredModels, patch.enabledModelIds ?? current.enabledModelIds, priorModelIds, current.autoEnableNewModels,
  );
  return {
    ...current, ...patch, ...modelIds,
    autoModel: patch.autoModel ? normalizeAutoModelPreferences(patch.autoModel) : current.autoModel,
  };
}
