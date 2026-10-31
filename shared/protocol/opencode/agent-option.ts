import type { Agent } from '@/shared/protocol/opencode/types';
import type { AgentOption } from '@/shared/contracts/model-options';

export function toAgentOption(agent: Agent): AgentOption {
  return {
    id: agent.name,
    label: agent.name.charAt(0).toUpperCase() + agent.name.slice(1),
    description: agent.description,
  };
}
