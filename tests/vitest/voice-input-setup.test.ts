import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
function all(root: Element | Element[], type: string): Element[] {
  if (Array.isArray(root)) return root.flatMap((child) => all(child, type));
  if (!root || typeof root !== 'object') return [];
  return [...(root.type === type ? [root] : []), ...all(root.props?.children, type), ...all(root.props?.footer, type)];
}
async function setup({ ready = false, profile = false, initialStep = 1 } = {}) {
  const runtime = hookRuntime();
  const models = { 'moonshine-tiny-en': { id: 'moonshine-tiny-en', label: 'English', tarballBytes: 108_000_000 } };
  const cancel = vi.fn(async () => {});
  const stop = vi.fn(async () => {});
  const install = vi.fn(async () => false);
  const update = vi.fn();
  const done = vi.fn();
  const close = vi.fn();
  const { VoiceInputSetup } = await loadTs('components/settings/voice-input-setup.tsx', {
    react: runtime.react, 'react/jsx-runtime': { jsx: (type: unknown, props: object) => ({ type, props }), jsxs: (type: unknown, props: object) => ({ type, props }) },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) },
    'react-native': { AppState: { addEventListener: () => ({ remove: vi.fn() }) }, Image: 'Image', View: 'View', StyleSheet: { create: (value: object) => value } },
    'react-native-paper': { HelperText: 'Help', Text: 'Text' },
    '@/lib/voice/local-wake-word/model-constants': { LOCAL_COMMAND_MODELS: models, LOCAL_VOICE_BASE_DOWNLOAD_BYTES: 45_000_000 },
    '@/lib/voice/local-wake-word/types': { LOCAL_WAKE_PHRASES: { 'hey-code': { id: 'hey-code', label: 'Hey code' } } },
    './settings-panel': { SettingsDisclosure: 'Disclosure', SettingTarget: 'Target' },
    './sections/setting-rows': { SettingButton: 'Button', SettingSelectField: 'Select', SettingSwitchRow: 'Switch' },
    './voice-language': { voiceLanguageOptions: () => [{ value: '', label: 'System' }, { value: 'en', label: 'English' }] },
    './voice-flow-screen': { VoiceFlowScreen: 'Flow' },
    ...Object.fromEntries(['intro', 'download', 'profile', 'test'].map((name) => [`@/assets/images/voice-input-${name}.png`, name])),
  }, runtime.globals);
  const localVoice = { status: ready ? 'ready' : 'missing', baseStatus: 'missing', commandStatus: 'missing', microphone: { granted: ready }, install, refresh: vi.fn(), refreshMicrophone: vi.fn(), enrollment: { cancel, hasProfile: profile, status: 'idle', enroll: vi.fn() } };
  const test = { status: 'idle', stop, start: vi.fn() };
  runtime.mount(VoiceInputSetup, { initialStep, chatPreferences: { localCommandModel: 'moonshine-tiny-en', localWakePhrase: 'hey-code', localSpeakerVerification: true }, localVoice, test, palette: {}, updateChatPreferences: update, onDone: done, onClose: close });
  const button = (key: string) => all(runtime.value, 'Button').find((item) => item.props.children === key)!;
  return { runtime, localVoice, test, cancel, stop, install, update, done, close, button };
}

describe('guided voice setup', () => {
  it('does not request permission, install, record or test on entry', async () => {
    const view = await setup();
    expect(view.install).not.toHaveBeenCalled();
    expect(view.update).not.toHaveBeenCalled();
    expect(view.test.start).not.toHaveBeenCalled();
    view.button('settings:connection.setup.continue').props.onPress();
    view.runtime.flush();
    expect(view.button('settings:voice.setup.downloadContinue').props.disabled).toBe(true);
  });

  it('keeps failed downloads on Prepare and advances only on success', async () => {
    const view = await setup({ initialStep: 2 });
    view.runtime.update({ localVoice: { ...view.localVoice, microphone: { granted: true } } });
    await view.button('settings:voice.setup.downloadContinue').props.onPress();
    view.runtime.flush();
    expect(view.button('settings:voice.setup.downloadContinue')).toBeDefined();
    view.install.mockResolvedValue(true);
    await view.button('settings:voice.setup.downloadContinue').props.onPress();
    view.runtime.flush();
    expect(view.button('settings:voice.setup.skipProfile')).toBeDefined();
  });

  it('explicitly disables speaker verification when skipping a new profile', async () => {
    const view = await setup({ ready: true, initialStep: 3 });
    view.button('settings:voice.setup.skipProfile').props.onPress();
    view.runtime.flush();
    expect(view.update).toHaveBeenCalledWith({ localSpeakerVerification: false });
    view.button('settings:voice.setup.skipTest').props.onPress();
    expect(view.update).toHaveBeenLastCalledWith({ voiceWakeMode: 'local', localSpeakerVerification: false });
    expect(view.done).toHaveBeenCalledOnce();
    expect(view.test.start).not.toHaveBeenCalled();
  });

  it('preserves existing profile preferences and stops capture/test on dismissal', async () => {
    const view = await setup({ ready: true, profile: true, initialStep: 3 });
    view.button('settings:connection.setup.continue').props.onPress();
    view.runtime.flush();
    expect(view.update).not.toHaveBeenCalled();
    all(view.runtime.value, 'Flow')[0].props.onClose();
    await view.runtime.settle();
    expect(view.cancel).toHaveBeenCalled();
    expect(view.stop).toHaveBeenCalled();
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.done).not.toHaveBeenCalled();
  });

  it('does not override a verification choice after a new enrollment', async () => {
    const view = await setup({ ready: true, initialStep: 3 });
    view.runtime.update({ localVoice: { ...view.localVoice, enrollment: { ...view.localVoice.enrollment, hasProfile: true } } });
    all(view.runtime.value, 'Switch')[0].props.onValueChange(false);
    expect(view.update).toHaveBeenLastCalledWith({ localSpeakerVerification: false });
    view.update.mockClear();
    view.button('settings:connection.setup.continue').props.onPress();
    expect(view.update).not.toHaveBeenCalled();
  });

  it('does not activate an unprepared engine, even when opening the last step directly', async () => {
    const view = await setup({ initialStep: 4 });
    view.button('settings:voice.setup.skipTest').props.onPress();
    expect(view.update).not.toHaveBeenCalled();
    expect(view.done).not.toHaveBeenCalled();
  });
});
