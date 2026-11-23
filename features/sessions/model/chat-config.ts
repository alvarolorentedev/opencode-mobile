import { getPrimaryAgents, type AgentOption, type ModelOption } from '@/shared/contracts/model-options';
import type { Session } from '@/shared/protocol/opencode/types';
import type { SessionMessageRecord } from '@/shared/presentation/format';

export type SessionChatConfig = {
  agent?: string;
  model?: NonNullable<Session['model']>;
  permissions?: NonNullable<Session['permissions']>;
};

function optionModel(option: ModelOption): NonNullable<Session['model']> {
  return { providerID: option.providerID, id: option.modelID };
}

function knownModel(models: ModelOption[], model: NonNullable<Session['model']> | undefined) {
  if (!model) return undefined;
  const option = models.find((candidate) => candidate.providerID === model.providerID
    && (candidate.modelID === model.id || candidate.id === model.id));
  if (!option) return undefined;
  const variant = model.variant && option.variants.some((item) => item.id === model.variant) ? model.variant : undefined;
  return { providerID: option.providerID, id: option.modelID, ...(variant ? { variant } : {}) };
}

function lastUserConfig(messages: readonly SessionMessageRecord[] | undefined): SessionChatConfig {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    const info = messages?.[index]?.info;
    if (info?.role !== 'user') continue;
    const model = info.model
      ? { providerID: info.model.providerID, id: info.model.modelID, ...(info.model.variant ? { variant: info.model.variant } : {}) }
      : undefined;
    return {
      ...(info.agent ? { agent: info.agent } : {}),
      ...(model ? { model } : {}),
    };
  }
  return {};
}

/** The session's own chat configuration, falling back field by field to its newest user message. */
export function resolveSessionChatConfig(
  session: Session | undefined,
  messages: readonly SessionMessageRecord[] | undefined,
): SessionChatConfig {
  const last = lastUserConfig(messages);
  const agent = session?.agent ?? last.agent;
  const model = session?.model ?? last.model;
  return {
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(session?.permissions ? { permissions: [...session.permissions] } : {}),
  };
}

/**
 * A new chat starts from the newest root session in the same project. The
 * auto-approve preference wins over copying that session's permission rules.
 */
export function resolveNewSessionConfig(input: {
  sessions: readonly Session[];
  agents: AgentOption[];
  models: ModelOption[];
  recentModelIds?: string[];
  autoApprove: boolean;
}): SessionChatConfig {
  const latest = input.sessions.find((session) => !session.parentID);
  const latestAgent = latest?.agent;
  const agent = latestAgent && getPrimaryAgents(input.agents).some((option) => option.id === latestAgent)
    ? latestAgent
    : undefined;
  const agentModel = agent ? input.agents.find((option) => option.id === agent)?.model : undefined;
  const recent = input.recentModelIds?.[0]
    ? input.models.find((option) => option.id === input.recentModelIds?.[0])
    : undefined;
  const model = knownModel(input.models, latest?.model)
    ?? (agentModel ? knownModel(input.models, { providerID: agentModel.providerID, id: agentModel.modelID, ...(agentModel.variant ? { variant: agentModel.variant } : {}) }) : undefined)
    ?? (recent ? optionModel(recent) : undefined);
  const permissions = !input.autoApprove && latest?.permissions?.length
    ? [...latest.permissions]
    : undefined;
  return {
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(permissions ? { permissions } : {}),
  };
}
