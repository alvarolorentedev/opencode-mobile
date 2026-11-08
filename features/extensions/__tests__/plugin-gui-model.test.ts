import { describe, expect, it } from 'vitest';

import { formatPluginMessage, pluginRpcAllowed } from '@/features/extensions/model/plugin-gui';

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
});
