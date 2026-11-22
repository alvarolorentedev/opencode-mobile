// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import '../../../tests/helpers/native-primitives';
import { ConnectionMethodChooser } from '@/features/connections/ui/connection-method-chooser';
import type { WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import { connectionViewProbe } from '../../../tests/helpers/connection-view-probe';
import { renderHook } from '../../../tests/helpers/render-hook';

const native = vi.hoisted(() => ({ platform: 'android', foss: false }));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform(native));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { get foss() { return native.foss; } } } } }));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('react-i18next', async (original) => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({}));

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[] | null | undefined, testID: string): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, testID)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.props?.testID === testID || root.type === testID) return root;
  return find(root.props?.children, testID);
}

function chooser({ foss = false, platform = 'android', enabled = true } = {}) {
  Object.assign(native, { platform, foss });
  const controls = { connectSetup: { enabled } } as WorkspaceRegistry['connectionControls'];
  const runtime = renderHook(ConnectionMethodChooser, { onScan: vi.fn(), onManual: vi.fn(), onPair: vi.fn() }, connectionViewProbe(controls));
  return (testID: string) => find(runtime.result.current, testID);
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
