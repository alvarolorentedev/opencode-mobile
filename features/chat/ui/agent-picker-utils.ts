import { getPrimaryAgents, type AgentOption } from '@/shared/contracts/model-options';
import { compareLabels } from '@/shared/utilities/compare-labels';

const PRIMARY_AGENT_ORDER = ['build', 'plan'] as const;

const PRIMARY_AGENT_RANK = new Map<string, number>(PRIMARY_AGENT_ORDER.map((id, index) => [id, index]));

const AGENT_DESCRIPTION_KEYS: Record<string, string> = {
  build: 'chat:composer.agentDescriptions.build',
  plan: 'chat:composer.agentDescriptions.plan',
  general: 'chat:composer.agentDescriptions.general',
  explore: 'chat:composer.agentDescriptions.explore',
  summary: 'chat:composer.agentDescriptions.summary',
  title: 'chat:composer.agentDescriptions.title',
  compaction: 'chat:composer.agentDescriptions.compaction',
};

// Built-in descriptions are a localized fallback when the server omits copy.
export function agentDescriptionKey(agentId: string) {
  return AGENT_DESCRIPTION_KEYS[agentId.toLowerCase()];
}

export function orderAgentsForPicker(agents: AgentOption[]): AgentOption[] {
  return getPrimaryAgents(agents).sort((left, right) => {
    const leftId = left.id.toLowerCase();
    const rightId = right.id.toLowerCase();
    const leftPrimary = PRIMARY_AGENT_RANK.get(leftId);
    const rightPrimary = PRIMARY_AGENT_RANK.get(rightId);

    if (leftPrimary !== undefined || rightPrimary !== undefined) {
      if (leftPrimary === undefined) return 1;
      if (rightPrimary === undefined) return -1;
      return leftPrimary - rightPrimary;
    }

    return compareLabels(left.label, right.label) || compareLabels(left.id, right.id);
  });
}
