import type { AgentOption } from '@/shared/contracts/model-options';
import { compareLabels } from '@/shared/utilities/compare-labels';

const PRIMARY_AGENT_ORDER = ['build', 'plan', 'general', 'explore'] as const;
const MAINTENANCE_AGENT_ORDER = ['summary', 'title', 'compaction'] as const;

const PRIMARY_AGENT_RANK = new Map<string, number>(PRIMARY_AGENT_ORDER.map((id, index) => [id, index]));
const MAINTENANCE_AGENT_RANK = new Map<string, number>(MAINTENANCE_AGENT_ORDER.map((id, index) => [id, index]));

const AGENT_DESCRIPTION_KEYS: Record<string, string> = {
  build: 'chat:composer.agentDescriptions.build',
  plan: 'chat:composer.agentDescriptions.plan',
  general: 'chat:composer.agentDescriptions.general',
  explore: 'chat:composer.agentDescriptions.explore',
  summary: 'chat:composer.agentDescriptions.summary',
  title: 'chat:composer.agentDescriptions.title',
  compaction: 'chat:composer.agentDescriptions.compaction',
};

// The picker uses app-local descriptions instead of server copy so every mode
// reads consistently and maintenance agents without a server description are
// still understandable.
export function agentDescriptionKey(agentId: string) {
  return AGENT_DESCRIPTION_KEYS[agentId.toLowerCase()];
}

export function orderAgentsForPicker(agents: AgentOption[]): AgentOption[] {
  return [...agents].sort((left, right) => {
    const leftId = left.id.toLowerCase();
    const rightId = right.id.toLowerCase();
    const leftPrimary = PRIMARY_AGENT_RANK.get(leftId);
    const rightPrimary = PRIMARY_AGENT_RANK.get(rightId);

    if (leftPrimary !== undefined || rightPrimary !== undefined) {
      if (leftPrimary === undefined) return 1;
      if (rightPrimary === undefined) return -1;
      return leftPrimary - rightPrimary;
    }

    const leftMaintenance = MAINTENANCE_AGENT_RANK.get(leftId);
    const rightMaintenance = MAINTENANCE_AGENT_RANK.get(rightId);

    if (leftMaintenance !== undefined || rightMaintenance !== undefined) {
      if (leftMaintenance === undefined) return -1;
      if (rightMaintenance === undefined) return 1;
      return leftMaintenance - rightMaintenance;
    }

    return compareLabels(left.label, right.label);
  });
}
