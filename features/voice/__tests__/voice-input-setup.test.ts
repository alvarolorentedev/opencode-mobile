// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { VoiceFlowScreen } from '@/features/voice/ui/voice-flow-screen';
import { VoiceInputSetup } from '@/features/voice/ui/voice-input-setup';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import { Button } from '@/shared/ui/button';
import { SettingSwitchRow } from '@/shared/ui/settings/setting-rows';
import { textContent } from '../../../tests/helpers/ui.mjs';
import { Colors } from '@/shared/ui/theme/theme';
import { renderHook } from '../../../tests/helpers/render-hook';

const variant = vi.hoisted(() => ({ foss: false, platform: 'android' }));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform(variant));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { get foss() { return variant.foss; } } } } }));
vi.mock('expo-router', () => ({ useIsFocused: () => false }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

type Element = { type: unknown; props: Record<string, any> };
function all(root: Element | Element[], type: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap((child) => all(child, type));
  if (!root || typeof root !== 'object') return [];
  return [...(root.type === type ? [root] : []), ...all(root.props?.children, type), ...all(root.props?.footer, type)];
}
function setup({ ready = false, profile = false, initialStep = 1 } = {}) {
  const cancel = vi.fn(async () => {});
  const stop = vi.fn(async () => {});
  const install = vi.fn(async () => false);
  const update = vi.fn();
  const done = vi.fn();
  const close = vi.fn();
  const localVoice = { status: ready ? 'ready' : 'missing', baseStatus: 'missing', commandStatus: 'missing', microphone: { granted: ready }, install, refresh: vi.fn(), refreshMicrophone: vi.fn(), enrollment: { cancel, hasProfile: profile, status: 'idle', enroll: vi.fn() } };
  const test = { status: 'idle', stop, start: vi.fn() };
  type Props = Parameters<typeof VoiceInputSetup>[0];
  const props = {
    initialStep, chatPreferences: { ...defaultChatPreferences, localCommandModel: 'moonshine-tiny-en', localWakePhrase: 'hey-code', localSpeakerVerification: true },
    localVoice: localVoice as unknown as Props['localVoice'], test: test as Props['test'], palette: Colors.light,
    updateChatPreferences: update, onDone: done, onClose: close, onOpenSettings: vi.fn(),
  } satisfies Props;
  const runtime = renderHook(VoiceInputSetup, props);
  const button = (key: string) => all(runtime.result.current, Button).find((item) => textContent(item) === key)!;
  const rerender = (nextVoice: typeof localVoice) => runtime.rerender({ ...props, localVoice: nextVoice as unknown as Props['localVoice'] });
  return { runtime, rerender, localVoice, test, cancel, stop, install, update, done, close, button };
}

describe('guided voice setup', () => {
  it('does not request permission, install, record or test on entry', async () => {
    const view = setup();
    expect(view.install).not.toHaveBeenCalled();
    expect(view.update).not.toHaveBeenCalled();
    expect(view.test.start).not.toHaveBeenCalled();
    act(() => view.button('settings:connection.setup.continue').props.onPress());
    expect(view.button('settings:voice.setup.downloadContinue').props.disabled).toBe(true);
  });

  it('keeps failed downloads on Prepare and advances only on success', async () => {
    const view = setup({ initialStep: 2 });
    view.rerender({ ...view.localVoice, microphone: { granted: true } });
    await act(async () => { await view.button('settings:voice.setup.downloadContinue').props.onPress(); });
    expect(view.button('settings:voice.setup.downloadContinue')).toBeDefined();
    view.install.mockResolvedValue(true);
    await act(async () => { await view.button('settings:voice.setup.downloadContinue').props.onPress(); });
    expect(view.button('settings:voice.setup.skipProfile')).toBeDefined();
  });

  it('explicitly disables speaker verification when skipping a new profile', async () => {
    const view = setup({ ready: true, initialStep: 3 });
    act(() => view.button('settings:voice.setup.skipProfile').props.onPress());
    expect(view.update).toHaveBeenCalledWith({ localSpeakerVerification: false });
    view.button('settings:voice.setup.skipTest').props.onPress();
    expect(view.update).toHaveBeenLastCalledWith({ voiceWakeMode: 'local', localSpeakerVerification: false });
    expect(view.done).toHaveBeenCalledOnce();
    expect(view.test.start).not.toHaveBeenCalled();
  });

  it('preserves existing profile preferences and stops capture/test on dismissal', async () => {
    const view = setup({ ready: true, profile: true, initialStep: 3 });
    act(() => view.button('settings:connection.setup.continue').props.onPress());
    expect(view.update).not.toHaveBeenCalled();
    await act(async () => { await all(view.runtime.result.current, VoiceFlowScreen)[0].props.onClose(); });
    expect(view.cancel).toHaveBeenCalled();
    expect(view.stop).toHaveBeenCalled();
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.done).not.toHaveBeenCalled();
  });

  it('does not override a verification choice after a new enrollment', async () => {
    const view = setup({ ready: true, initialStep: 3 });
    view.rerender({ ...view.localVoice, enrollment: { ...view.localVoice.enrollment, hasProfile: true } });
    act(() => all(view.runtime.result.current, SettingSwitchRow)[0].props.onValueChange(false));
    expect(view.update).toHaveBeenLastCalledWith({ localSpeakerVerification: false });
    view.update.mockClear();
    view.button('settings:connection.setup.continue').props.onPress();
    expect(view.update).not.toHaveBeenCalled();
  });

  it('does not activate an unprepared engine, even when opening the last step directly', async () => {
    const view = setup({ initialStep: 4 });
    view.button('settings:voice.setup.skipTest').props.onPress();
    expect(view.update).not.toHaveBeenCalled();
    expect(view.done).not.toHaveBeenCalled();
  });
});
