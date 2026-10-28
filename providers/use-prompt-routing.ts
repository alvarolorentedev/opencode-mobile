import { useCallback, useMemo } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import type { Session, SessionStatus } from '@/lib/opencode/types';
import { getLatestContextTokens } from '@/lib/opencode/usage';
import { classifyPromptWithLocalModel } from '@/lib/auto-model/runtime';
import { getLocalAutoModelStatus } from '@/lib/auto-model/models';
import { getVisibleModels, type ModelOption } from '@/providers/opencode-model-selection';
import {
  estimatePromptTokens,
  getAutoModelSuggestions,
  getClassifierModelId,
  resolveAutoModelSelection,
  type AutoModelSelection,
} from '@/providers/opencode-auto-model';
import type { ProviderOption } from '@/providers/opencode-provider-types';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import { classifyPromptWithServer } from '@/providers/services/model-routing-service';

type PromptRoutingInput = {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  availableModels: ModelOption[];
  availableProviders: ProviderOption[];
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

    const suggestions = getAutoModelSuggestions(visibleModels, chatPreferences.modelId);
    const tierModels = new Set((['simple', 'standard', 'complex'] as const)
      .map((tier) => preferences.tiers[tier] === 'auto' ? suggestions[tier] : preferences.tiers[tier])
      .filter((modelId): modelId is string => Boolean(modelId)));
    if (tierModels.size <= 1) {
      return undefined;
    }

    const currentSession = sessions.find((session) => session.id === sessionId);
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
      defaultModelId: chatPreferences.modelId,
      currentModel: currentSession?.model,
      modelVariantSelections: chatPreferences.modelVariantSelections,
      attachments,
      contextTokens,
      promptTokens: estimatePromptTokens(prompt),
    });
    return selection && isCurrentClient(client) ? selection : undefined;
  }, [chatPreferences, client, isCurrentClient, messagesBySession, sessionStatuses, sessions, visibleModels]);
}
