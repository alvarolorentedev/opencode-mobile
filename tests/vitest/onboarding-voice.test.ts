import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
function all(root: Element | Element[], type: string): Element[] {
  if (Array.isArray(root)) return root.flatMap((child) => all(child, type));
  if (!root || typeof root !== 'object') return [];
  return [...(root.type === type ? [root] : []), ...all(root.props?.children, type)];
}
const jsx = { jsx: (type: unknown, props: object) => ({ type, props }), jsxs: (type: unknown, props: object) => ({ type, props }) };
const native = { Platform: { OS: 'android' }, StyleSheet: { create: (styles: object) => styles }, View: 'View' };
const translation = { useTranslation: () => ({ t: (key: string) => key }) };

async function voice(os = 'android', ready = false) {
  const runtime = hookRuntime();
  const autoModelPreferences = await loadTs('lib/auto-model/preferences.ts');
  const { defaultChatPreferences } = await loadTs('providers/opencode-preferences.ts', {
    '@/constants/appearance': {}, '@/lib/auto-model/preferences': autoModelPreferences, '@/lib/voice/wake-phrase': {}, '@/lib/voice/local-wake-word/types': {},
  });
  const update = vi.fn();
  const localVoice = { clearError: vi.fn(), refresh: vi.fn() };
  const ttsSetup = { activePack: ready ? { id: 'piper-en' } : undefined, statuses: { 'piper-en': ready ? 'ready' : 'missing' }, setEngine: vi.fn(), install: vi.fn() };
  const enable = vi.fn();
  const preview = vi.fn();
  const { VoiceSection } = await loadTs('components/settings/sections/voice-section.tsx', {
    react: runtime.react, 'react/jsx-runtime': jsx, 'react-i18next': translation,
    'react-native': { ...native, Platform: { OS: os } },
    'react-native-paper': { Button: 'Button', HelperText: 'HelperText', List: { Accordion: 'Accordion' }, SegmentedButtons: 'Segments', Text: 'Text' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@/components/ui/numeric-slider': { NumericSlider: 'Slider' }, '@/components/ui/text-input': { TextInput: 'Input' },
    '@/lib/voice/wake-phrase': { normalizeWakePhrase: (value: string) => value },
    '@/components/settings/settings-utils': { WORKING_SOUND_OPTIONS: [] },
    './local-voice-section': { LocalVoiceSection: 'LocalVoice' }, './local-tts-section': { LocalTtsSection: 'LocalTts' },
    './setting-rows': { SettingSelectField: 'Select', SettingSwitchRow: 'Switch' },
  });
  runtime.mount(VoiceSection, {
    onboarding: true, chatPreferences: defaultChatPreferences, palette: {},
    availableSpeechVoices: [{ id: 'voice-en', label: 'English', language: 'en-US' }],
    selectedWorkingSound: { value: 'soft' }, localVoice, ttsSetup,
    updateChatPreferences: update, onEnableVoiceInput: enable, onTestVoicePlayback: preview,
    voiceCapabilities: { recognitionAvailable: true, permission: { available: true, canAskAgain: true, granted: false } },
  });
  return { runtime, update, localVoice, ttsSetup, enable, preview, preferences: defaultChatPreferences };
}

describe('onboarding voice controls', () => {
  it('keeps setup read-only until an explicit action and hides advanced settings', async () => {
    const view = await voice();
    expect(view.update).not.toHaveBeenCalled();
    expect(view.ttsSetup.install).not.toHaveBeenCalled();
    expect(view.enable).not.toHaveBeenCalled();
    expect(all(view.runtime.value, 'Slider')).toHaveLength(0);
    expect(all(view.runtime.value, 'Accordion')).toHaveLength(0);
    const buttons = all(view.runtime.value, 'Button');
    buttons.find((button) => button.props.children === 'settings:voice.check.enable')!.props.onPress();
    expect(view.enable).toHaveBeenCalledOnce();
    buttons.find((button) => button.props.icon === 'play')!.props.onPress();
    expect(view.preview).toHaveBeenCalledOnce();
    all(view.runtime.value, 'Switch')[0].props.onValueChange(true);
    expect(view.update).toHaveBeenLastCalledWith({ autoPlayAssistantReplies: true });
  });

  it('opens model setup without activating or downloading a missing playback pack', async () => {
    const view = await voice();
    all(view.runtime.value, 'Segments')[1].props.onValueChange('local');
    view.runtime.flush();
    expect(all(view.runtime.value, 'LocalTts')).toHaveLength(1);
    expect(view.ttsSetup.setEngine).not.toHaveBeenCalled();
    expect(view.ttsSetup.install).not.toHaveBeenCalled();
    expect(all(view.runtime.value, 'Segments')[1].props.value).toBe('system');
    all(view.runtime.value, 'Segments')[1].props.onValueChange('system');
    view.runtime.flush();
    expect(all(view.runtime.value, 'LocalTts')).toHaveLength(0);
    expect(view.ttsSetup.setEngine).toHaveBeenCalledWith('system');
  });

  it('reuses installed playback and local input models, preserving setup errors', async () => {
    const view = await voice('android', true);
    all(view.runtime.value, 'Segments')[1].props.onValueChange('local');
    expect(view.ttsSetup.setEngine).toHaveBeenCalledWith('local');
    all(view.runtime.value, 'Segments')[0].props.onValueChange('local');
    expect(view.update).toHaveBeenCalledWith({ voiceWakeMode: 'local' });
    expect(view.localVoice.refresh).toHaveBeenCalledOnce();
    view.runtime.update({ chatPreferences: { ...view.preferences, voiceWakeMode: 'local', localCommandModel: 'whisper-tiny-multi' }, localVoice: { ...view.localVoice, error: 'Download failed' } });
    const local = all(view.runtime.value, 'LocalVoice')[0];
    expect(local.props.chatPreferences.localCommandModel).toBe('whisper-tiny-multi');
    expect(local.props.localVoice.error).toBe('Download failed');
  });

  it('uses valid OS voices and keeps unsupported web setup non-blocking', async () => {
    const view = await voice('web');
    expect(all(view.runtime.value, 'Segments')).toHaveLength(1);
    const field = all(view.runtime.value, 'Select')[0];
    field.props.onValueChange('missing');
    expect(view.update).not.toHaveBeenCalled();
    field.props.onValueChange('voice-en');
    expect(view.update).toHaveBeenCalledWith({ speechVoiceId: 'voice-en', speechLocale: 'en-US' });
    field.props.onValueChange('__system__');
    expect(view.update).toHaveBeenLastCalledWith({ speechVoiceId: undefined });
    view.runtime.update({ voiceCapabilities: { recognitionAvailable: false, permission: { available: false } } });
    expect(all(view.runtime.value, 'HelperText').some((item) => item.props.children === 'onboarding:permissions.voice.unsupported')).toBe(true);
  });
});

describe('voice enumeration lifecycle', () => {
  it('finishes loading after an enumeration failure', async () => {
    const runtime = hookRuntime();
    const options = deferred();
    const { useSpeechVoices } = await loadTs('components/settings/use-speech-voices.ts', {
      react: runtime.react, '@/lib/voice/speech-output': { getSpeechVoiceOptions: () => options.promise },
    });
    runtime.mount(useSpeechVoices, {});
    options.reject(new Error('Unavailable'));
    await runtime.settle();
    expect(runtime.value.isLoading).toBe(false);
    expect(runtime.value.voices).toHaveLength(0);
    runtime.unmount();
  });

  it('ignores enumeration results after leaving the screen', async () => {
    const runtime = hookRuntime();
    const options = deferred();
    const { useSpeechVoices } = await loadTs('components/settings/use-speech-voices.ts', {
      react: runtime.react, '@/lib/voice/speech-output': { getSpeechVoiceOptions: () => options.promise },
    });
    runtime.mount(useSpeechVoices, {});
    runtime.unmount();
    options.resolve([{ id: 'late-voice' }]);
    await runtime.settle();
    expect(runtime.value.voices).toHaveLength(0);
  });
});
