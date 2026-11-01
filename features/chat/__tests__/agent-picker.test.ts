import { describe, expect, it } from 'vitest';

import type { AgentOption } from '@/shared/contracts/model-options';
import { agentDescriptionKey, orderAgentsForPicker } from '@/features/chat/ui/agent-picker-utils';

function agent(id: string): AgentOption {
  return { id, label: id.charAt(0).toUpperCase() + id.slice(1) };
}

describe('agent picker ordering', () => {
  it('places primary, custom, and maintenance agents in the expected order', () => {
    const agents = [
      'summary',
      'explore',
      'custom-b',
      'plan',
      'compaction',
      'build',
      'custom-a',
      'title',
      'general',
    ].map(agent);

    expect(orderAgentsForPicker(agents).map((entry) => entry.id)).toEqual([
      'build',
      'plan',
      'general',
      'explore',
      'custom-a',
      'custom-b',
      'summary',
      'title',
      'compaction',
    ]);
  });

  it('does not drop unknown agents and keeps server order for duplicate labels', () => {
    const agents = [agent('zeta'), agent('alpha'), agent('zeta')];

    expect(orderAgentsForPicker(agents).map((entry) => entry.id)).toEqual(['alpha', 'zeta', 'zeta']);
  });

  it('matches agent IDs case-insensitively', () => {
    expect(orderAgentsForPicker([agent('BUILD'), agent('Plan')]).map((entry) => entry.id)).toEqual(['BUILD', 'Plan']);
  });
});

describe('agent picker descriptions', () => {
  it('maps built-in modes to localized description keys', () => {
    for (const id of ['build', 'plan', 'general', 'explore', 'summary', 'title', 'compaction']) {
      expect(agentDescriptionKey(id)).toBe(`chat:composer.agentDescriptions.${id}`);
    }
  });

  it('does not provide app-local descriptions for custom agents', () => {
    expect(agentDescriptionKey('custom-a')).toBeUndefined();
  });
});
