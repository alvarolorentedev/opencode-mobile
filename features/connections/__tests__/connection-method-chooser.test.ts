import { describe, expect, it, vi } from 'vitest';

import { uiImports } from '../../../tests/helpers/ui.mjs';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[] | null | undefined, testID: string): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, testID)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.props?.testID === testID || root.type === testID) return root;
  return find(root.props?.children, testID);
}

async function chooser({ foss = false, platform = 'android', enabled = true } = {}) {
  const runtime = hookRuntime();
  const { ConnectionMethodChooser } = await loadTs('features/connections/ui/connection-method-chooser.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }), Fragment: 'Fragment' },
    'expo-constants': { expoConfig: { extra: { foss } } },
    'react-native': { Platform: { OS: platform }, Linking: { openURL: vi.fn(async () => undefined) }, View: 'View' },
    '@/shared/contracts/cloud-link': { CONNECT_LEARN_MORE_URL: 'https://opencodecloud.link/' },
    '@/features/connections/context': { useConnection: () => ({ connectSetup: { enabled } }) },
    '@/shared/ui/theme/use-palette': { usePalette: () => ({}) },
  }, { Error });
  runtime.mount(ConnectionMethodChooser, { onScan: vi.fn(), onManual: vi.fn(), onPair: vi.fn() });
  return (testID: string) => find(runtime.value, testID);
}

describe('connection method chooser', () => {
  it('shows only manual setup in FOSS builds', async () => {
    const element = await chooser({ foss: true });
    expect(element('connection-method-manual')).toBeDefined();
    expect(element('connection-method-scan')).toBeUndefined();
    expect(element('connection-method-connect')).toBeUndefined();
    expect(element('connect-learn-more')).toBeUndefined();
  });

  it('keeps unavailable methods visible with their normal guidance outside FOSS', async () => {
    const native = await chooser({ enabled: false });
    expect(native('connection-method-scan')?.props.disabled).toBe(false);
    expect(native('connection-method-connect')?.props.disabled).toBe(true);
    expect(native('connect-learn-more')).toBeDefined();

    const web = await chooser({ platform: 'web', enabled: false });
    expect(web('connection-method-scan')?.props.disabled).toBe(true);
    expect(web('connection-method-connect')?.props.disabled).toBe(true);
    expect(web('connect-learn-more')).toBeDefined();
  });
});
