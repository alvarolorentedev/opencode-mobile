import type { Agent, Config } from '@/lib/opencode/types';

export type ModelOption = {
  id: string;
  label: string;
  providerID: string;
  providerLabel: string;
  modelID: string;
  supportsReasoning: boolean;
};

export type AgentOption = {
  id: string;
  label: string;
  description?: string;
};

export type ReasoningLevel = 'low' | 'default' | 'high';
export type ResponseScope = 'brief' | 'balanced' | 'detailed';

export type ChatPreferences = {
  mode: string;
  providerId?: string;
  modelId?: string;
  enabledModelIds: string[];
  providerModelSelections: Record<string, string>;
  reasoning: ReasoningLevel;
  autoApprove: boolean;
  autoPlayAssistantReplies: boolean;
  preferOnDeviceRecognition: boolean;
  resumeListeningAfterReply: boolean;
  speechLocale?: string;
  speechRate: number;
  speechVoiceId?: string;
  workingSoundEnabled: boolean;
  workingSoundVariant: 'soft' | 'glass';
  workingSoundVolume: number;
  responseScope: ResponseScope;
  includeNextActions: boolean;
};

export const defaultChatPreferences: ChatPreferences = {
  mode: 'build',
  enabledModelIds: [],
  providerModelSelections: {},
  reasoning: 'default',
  autoApprove: false,
  autoPlayAssistantReplies: false,
  preferOnDeviceRecognition: true,
  resumeListeningAfterReply: true,
  speechRate: 1,
  workingSoundEnabled: true,
  workingSoundVariant: 'soft',
  workingSoundVolume: 0.18,
  responseScope: 'brief',
  includeNextActions: true,
};

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong while talking to OpenCode.';
}

export function getProjectLabel(path: string) {
  const normalized = path.trim().replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) || normalized || 'Project';
}

export function toAgentOption(agent: Agent): AgentOption {
  return {
    id: agent.name,
    label: agent.name.charAt(0).toUpperCase() + agent.name.slice(1),
    description: agent.description,
  };
}

export function getInitialMode(agents: AgentOption[], config?: Config, storedMode?: string) {
  if (storedMode && agents.some((agent) => agent.id === storedMode)) {
    return storedMode;
  }

  const configuredAgent = config?.agent
    ? Object.entries(config.agent).find(([, value]) => value && (value as { disable?: boolean }).disable !== true)?.[0]
    : undefined;
  if (configuredAgent && agents.some((agent) => agent.id === configuredAgent)) {
    return configuredAgent;
  }

  const preferred = agents.find((agent) => agent.id === 'build') || agents.find((agent) => agent.id === 'general');
  return preferred?.id || agents[0]?.id || defaultChatPreferences.mode;
}

export function getInitialModelId(models: ModelOption[], config?: Config, storedModelId?: string) {
  if (storedModelId && models.some((model) => model.id === storedModelId)) {
    return storedModelId;
  }

  if (config?.model && models.some((model) => model.id === config.model)) {
    return config.model;
  }

  return models[0]?.id;
}

export function getInitialProviderId(models: ModelOption[], config?: Config, storedProviderId?: string, modelId?: string) {
  if (storedProviderId && models.some((model) => model.providerID === storedProviderId)) {
    return storedProviderId;
  }

  const modelMatch = models.find((model) => model.id === modelId);
  if (modelMatch) {
    return modelMatch.providerID;
  }

  if (config?.model) {
    const configMatch = models.find((model) => model.id === config.model);
    if (configMatch) {
      return configMatch.providerID;
    }
  }

  return models[0]?.providerID;
}

export function getModelIdForProvider(models: ModelOption[], providerId?: string, selectedModelId?: string, preferredModelId?: string) {
  const providerModels = providerId ? models.filter((model) => model.providerID === providerId) : models;
  if (providerModels.length === 0) {
    return selectedModelId;
  }

  if (selectedModelId && providerModels.some((model) => model.id === selectedModelId)) {
    return selectedModelId;
  }

  if (preferredModelId && providerModels.some((model) => model.id === preferredModelId)) {
    return preferredModelId;
  }

  return providerModels[0]?.id;
}

export function getEnabledModelIds(models: ModelOption[], storedModelIds?: string[]) {
  const availableModelIds = new Set(models.map((model) => model.id));
  const nextEnabledModelIds = (storedModelIds || []).filter((modelId) => availableModelIds.has(modelId));

  return nextEnabledModelIds.length > 0 ? nextEnabledModelIds : models.map((model) => model.id);
}

export function getConfiguredProviderIds(config: Config | undefined, connected: string[], models: ModelOption[]) {
  const configured = new Set<string>([
    ...(config?.enabled_providers || []),
    ...connected,
    ...Object.keys((config?.provider as Record<string, unknown>) || {}),
  ]);

  if (config?.model) {
    const modelMatch = models.find((model) => model.id === config.model);
    if (modelMatch) {
      configured.add(modelMatch.providerID);
    }
  }

  return configured;
}

export function isAutoApproveEnabled(config?: Config) {
  if (!config?.permission) {
    return false;
  }

  const { bash, doom_loop, edit, external_directory, webfetch } = config.permission;
  return edit === 'allow' && bash === 'allow' && webfetch === 'allow' && doom_loop === 'allow' && external_directory === 'allow';
}

function buildReasoningSystemPrompt(level: ReasoningLevel) {
  if (level === 'default') {
    return undefined;
  }

  if (level === 'low') {
    return 'Reasoning effort: low. Keep the solution direct, concise, and avoid unnecessary exploration unless needed.';
  }

  return 'Reasoning effort: high. Spend extra time planning, evaluating tradeoffs, and verifying the best path before acting.';
}

function buildResponseStyleSystemPrompt(scope: ResponseScope, includeNextActions: boolean) {
  const scopeInstruction =
    scope === 'brief'
      ? 'Keep responses tightly scoped. Use short paragraphs or brief bullets and avoid extra background unless the user asks for it.'
      : scope === 'detailed'
        ? 'Give fuller explanations when helpful, but still stay conversational and focused on the user request.'
        : 'Keep responses concise and user-friendly, with only the context needed to understand the answer.';

  const nextActionsInstruction = includeNextActions
    ? 'When there are useful next actions, end with a simple explanation of the recommended next step or a short numbered list.'
    : 'Do not add next actions unless the user explicitly asks for them.';

  return `${scopeInstruction} ${nextActionsInstruction}`;
}

export function buildSystemPrompt(preferences: ChatPreferences) {
  return [
    buildReasoningSystemPrompt(preferences.reasoning),
    buildResponseStyleSystemPrompt(preferences.responseScope, preferences.includeNextActions),
  ]
    .filter(Boolean)
    .join('\n\n') || undefined;
}

export function getSelectedModelParts(modelId?: string) {
  if (!modelId) {
    return undefined;
  }

  const providerID = modelId.split('/')[0];
  const selectedModelID = modelId.split('/').slice(1).join('/');
  if (!providerID || !selectedModelID) {
    return undefined;
  }

  return {
    providerID,
    modelID: selectedModelID,
  };
}

export function mergePermissionConfig(config: Config | undefined, enabled: boolean): Config {
  return {
    ...(config || {}),
    permission: {
      ...config?.permission,
      edit: enabled ? 'allow' : 'ask',
      bash: enabled ? 'allow' : 'ask',
      webfetch: enabled ? 'allow' : 'ask',
      doom_loop: enabled ? 'allow' : 'ask',
      external_directory: enabled ? 'allow' : 'ask',
    },
  };
}

function getPendingRequestSessionId(request: Record<string, unknown>) {
  const candidate =
    request.sessionID ??
    request.sessionId ??
    request.session ??
    (request.session as { id?: string } | undefined)?.id ??
    (request.message as { sessionID?: string; sessionId?: string } | undefined)?.sessionID ??
    (request.message as { sessionID?: string; sessionId?: string } | undefined)?.sessionId ??
    (request.tool as { sessionID?: string; sessionId?: string } | undefined)?.sessionID ??
    (request.tool as { sessionID?: string; sessionId?: string } | undefined)?.sessionId;

  return typeof candidate === 'string' ? candidate : undefined;
}

export function groupPendingRequestsBySession<T extends { id?: string } & Record<string, unknown>>(requests: T[]) {
  return requests.reduce<Record<string, T[]>>((acc, request) => {
    const sessionId = getPendingRequestSessionId(request);
    if (!sessionId) {
      return acc;
    }

    const existing = acc[sessionId] || [];
    if (request.id && existing.some((item) => item.id === request.id)) {
      return acc;
    }

    acc[sessionId] = [...existing, request];
    return acc;
  }, {});
}
