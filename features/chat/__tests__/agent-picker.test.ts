import { describe, expect, it } from 'vitest';

import { getPrimaryAgents, type AgentOption } from '@/shared/contracts/model-options';
import { agentDescriptionKey, orderAgentsForPicker } from '@/features/chat/ui/agent-picker-utils';
import { getInitialMode } from '@/features/ai/model/opencode-model-selection';
import { toAgentOption } from '@/shared/protocol/opencode/agent-option';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

function agent(id: string, metadata: Partial<AgentOption> = {}): AgentOption {
  return { id, label: id.charAt(0).toUpperCase() + id.slice(1), mode: 'primary', ...metadata };
}
const catalog = [
  agent('summary', { hidden: true }), agent('title', { hidden: true }), agent('compaction', { hidden: true }),
  agent('general', { mode: 'subagent' }), agent('explore', { mode: 'subagent' }),
  agent('plugin-review', { mode: 'all' }), agent('custom-review'), agent('plan'), agent('build'),
];

describe('primary agent selection', () => {
  it('uses metadata for built-in, custom and plugin agents without mutating the catalog', () => {
    expect(getPrimaryAgents(catalog).map((item) => item.id)).toEqual(['plugin-review', 'custom-review', 'plan', 'build']);
    expect(catalog).toHaveLength(9);
    expect(getPrimaryAgents([agent('summary'), agent('general', { mode: 'all' })])).toHaveLength(2);
    expect(getPrimaryAgents([agent('legacy', { mode: undefined })])).toEqual([]);
  });

  it('retains valid choices, then prefers the configured default, Build and server order', () => {
    const config = { default_agent: 'custom-review', agent: { 'plugin-review': {} } };
    expect(getInitialMode(catalog, config, 'plan')).toBe('plan');
    expect(getInitialMode(catalog, config, 'summary')).toBe('custom-review');
    expect(getInitialMode(catalog, { default_agent: 'general' }, 'removed-or-disabled')).toBe('build');
    expect(getInitialMode(catalog.slice(0, -1), undefined, 'removed-or-disabled')).toBe('plugin-review');
    expect(getInitialMode(catalog.slice(0, 5), config, 'summary')).toBeUndefined();
    expect(getInitialMode([], config, 'plan')).toBeUndefined();
  });

  it('preserves V1 metadata and does not infer missing mode or visibility', () => {
    expect(toAgentOption({ name: 'review', mode: 'all', hidden: true, description: 'Custom review' })).toEqual({
      id: 'review', label: 'Review', mode: 'all', hidden: true, description: 'Custom review',
    });
    expect(toAgentOption({ name: 'old' })).toMatchObject({ mode: undefined, hidden: undefined });
  });
});

describe('agent picker ordering and descriptions', () => {
  it('places Build and Plan first, then eligible agents alphabetically', () => {
    expect(orderAgentsForPicker(catalog).map((item) => item.id)).toEqual(['build', 'plan', 'custom-review', 'plugin-review']);
    expect(orderAgentsForPicker([agent('BUILD'), agent('Plan')]).map((item) => item.id)).toEqual(['BUILD', 'Plan']);
  });

  it('breaks identical labels by ID and retains exact duplicates in server order', () => {
    expect(orderAgentsForPicker([agent('zeta', { label: 'Same' }), agent('alpha', { label: 'Same' }), agent('zeta', { label: 'Same' })]).map((item) => item.id))
      .toEqual(['alpha', 'zeta', 'zeta']);
  });

  it('provides localized built-in fallbacks without inventing custom descriptions', () => {
    expect(agentDescriptionKey('build')).toBe('chat:composer.agentDescriptions.build');
    expect(agentDescriptionKey('custom-review')).toBeUndefined();
  });
});

describe('agent mention discovery', () => {
  it('keeps visible subagents and plugin agents, excludes hidden agents, and preserves mention payloads', async () => {
    const runtime = hookRuntime();
    const { useComposerSuggestions } = await loadTs('features/chat/ui/use-composer-suggestions.ts', { react: runtime.react });
    runtime.mount(useComposerSuggestions, {
      draft: '@', selection: { start: 1, end: 1 }, enabled: true, commands: [],
      agents: [agent('custom-task', { mode: 'subagent' }), agent('plugin-task', { mode: 'subagent' }), agent('secret', { mode: 'subagent', hidden: true }), agent('summary', { hidden: true })],
      skills: [], references: [], searchFiles: async () => [],
    });
    expect(runtime.value.groups[0].items.map((item: { label: string }) => item.label)).toEqual(['@custom-task', '@plugin-task']);
    expect(runtime.value.groups[0].items[0].context).toEqual({ kind: 'agent', name: 'custom-task', token: '@custom-task' });
    runtime.unmount();
  });
});
