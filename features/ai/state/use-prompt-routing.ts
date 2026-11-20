import { useCallback, useMemo } from 'react';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Config, Session, SessionStatus } from '@/shared/protocol/opencode/types';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { getLatestContextTokens } from '@/shared/presentation/usage';
import { classifyPromptWithLocalModel } from '@/features/ai/model/auto-model/runtime';
import { getLocalAutoModelStatus } from '@/features/ai/model/auto-model/models';
import { getEffectiveSessionModel, getInitialMode, getVisibleModels } from '@/features/ai/model/opencode-model-selection';
import type { ModelOption } from '@/shared/contracts/model-options';
import { estimatePromptTokens, getAutoModelSuggestions, getClassifierModelId, resolveAutoModelSelection, type AutoModelSelection } from '@/features/ai/model/opencode-auto-model';
import type { ProviderOption } from '@/features/ai/model/types';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { classifyPromptWithServer } from '@/features/ai/services/model-routing-service';

type PromptRoutingInput = {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  availableModels: ModelOption[];
  availableProviders: ProviderOption[];
  availableAgents: import('@/shared/contracts/model-options').AgentOption[];
  currentConfig?: Config;
  chatPreferences: ChatPreferences;
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  messagesBySession: Record<string, SessionMessageRecord[]>;
};

type RoutePromptInput = {
  sessionId: string;
  prompt: string;
  attachments?: { mime?: string; filename?: string }[];
};

export function usePromptRouting({
  client,
  isCurrentClient,
  availableModels,
  availableProviders,
  availableAgents,
  currentConfig,
  chatPreferences,
  sessions,
  sessionStatuses,
  messagesBySession,
}: PromptRoutingInput) {
  const visibleModels = useMemo(
    () => getVisibleModels(availableModels, availableProviders.filter((provider) => provider.configured), chatPreferences.enabledModelIds),
    [availableModels, availableProviders, chatPreferences.enabledModelIds],
  );

  return useCallback(async ({ sessionId, prompt, attachments }: RoutePromptInput): Promise<AutoModelSelection | undefined> => {
    const preferences = chatPreferences.autoModel;
    if (!preferences.enabled || !prompt.trim() || visibleModels.length === 0) {
      return undefined;
    }

    const status = sessionStatuses[sessionId];
    if (status && status.type !== 'idle') {
      return undefined;
    }

    const currentSession = sessions.find((session) => session.id === sessionId);
    const fallbackAgent = getInitialMode(availableAgents, currentConfig, chatPreferences.mode);
    const effectiveModel = getEffectiveSessionModel(visibleModels, currentConfig, availableAgents, currentSession, fallbackAgent);
    const defaultModelId = effectiveModel ? `${effectiveModel.providerID}/${effectiveModel.id}` : undefined;
    const suggestions = getAutoModelSuggestions(visibleModels, defaultModelId);
    const tierModels = new Set((['simple', 'standard', 'complex'] as const)
      .map((tier) => preferences.tiers[tier] === 'auto' ? suggestions[tier] : preferences.tiers[tier])
      .filter((modelId): modelId is string => Boolean(modelId)));
    if (tierModels.size <= 1) {
      return undefined;
    }

    const contextTokens = getLatestContextTokens(messagesBySession[sessionId] ?? []);

    let tier;
    if (preferences.classifier === 'local') {
      if (getLocalAutoModelStatus() !== 'ready') {
        return undefined;
      }
      tier = await classifyPromptWithLocalModel({
        prompt,
        sessionTitle: currentSession?.title,
        contextTokens,
        attachments,
      });
    } else {
      if (client.__opencode.contract !== 'v2' || !client.api?.generate) {
        return undefined;
      }
      const classifierModelId = getClassifierModelId(preferences, visibleModels);
      const classifierModel = classifierModelId
        ? visibleModels.find((model) => model.id === classifierModelId)
        : undefined;
      if (!classifierModel) {
        return undefined;
      }
      tier = await classifyPromptWithServer({
        client,
        modelID: classifierModel.modelID,
        providerID: classifierModel.providerID,
        prompt,
        sessionTitle: currentSession?.title,
        contextTokens,
        attachments,
      });
    }

    if (!tier || !isCurrentClient(client)) {
      return undefined;
    }

    const selection = resolveAutoModelSelection({
      tier,
      preferences,
      models: visibleModels,
      defaultModelId,
      currentModel: effectiveModel,
      attachments,
      contextTokens,
      promptTokens: estimatePromptTokens(prompt),
    });
    return selection && isCurrentClient(client) ? selection : undefined;
  }, [availableAgents, chatPreferences, client, currentConfig, isCurrentClient, messagesBySession, sessionStatuses, sessions, visibleModels]);
}
