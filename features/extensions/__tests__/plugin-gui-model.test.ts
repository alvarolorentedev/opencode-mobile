import { describe, expect, it } from 'vitest';

import { formatPluginMessage, activePluginGui, pluginRpcAllowed } from '@/features/extensions/model/plugin-gui';

const plugins = [
  { id: 'flowgraph', label: 'Flowgraph', source: { type: 'package' as const, target: 'flowgraph' } },
  { id: 'quota', label: 'Quota', source: { type: 'package' as const, target: 'quota' } },
];

describe('plugin GUI rules', () => {
  it('accepts an RPC id made from the plugin package words', () => {
    expect(pluginRpcAllowed('@slkiser/opencode-quota.server', 'slkiser.opencode-quota')).toBe(true);
  });

  it('rejects another plugin RPC id', () => {
    expect(pluginRpcAllowed('@slkiser/opencode-quota.server', 'someone.else')).toBe(false);
  });

  it('formats single and double brace placeholders', () => {
    expect(formatPluginMessage('Quota {{word}} / {{count}} row', { word: 'left', count: 3 }))
      .toBe('Quota left / 3 row');
    expect(formatPluginMessage('Quota {word}', { word: 'left' })).toBe('Quota left');
  });

  it('uses the remembered plugin while it is available', () => {
    expect(activePluginGui(plugins, 'quota')?.id).toBe('quota');
  });

  it('falls back to the first plugin when the remembered one is unavailable', () => {
    expect(activePluginGui(plugins, 'missing')?.id).toBe('flowgraph');
    expect(activePluginGui(plugins)?.id).toBe('flowgraph');
    expect(activePluginGui([], 'quota')).toBeUndefined();
  });
});
