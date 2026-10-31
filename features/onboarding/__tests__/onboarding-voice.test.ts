import { uiImports, textContent } from '../../../tests/helpers/ui.mjs';
import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

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
  const autoModelPreferences = await loadTs('shared/preferences/auto-model.ts');
  const { defaultChatPreferences } = await loadTs('shared/preferences/opencode-preferences.ts', {
    ...uiImports,
    '@/shared/preferences/auto-model': autoModelPreferences
  });
  const update = vi.fn();
  const localVoice = { status: ready ? 'ready' : 'missing', microphone: { granted: ready }, clearError: vi.fn(), refresh: vi.fn(), enrollment: { hasProfile: ready, cancel: vi.fn(async () => {}) } };
  const pack = { id: 'piper-en', vendor: 'Piper', languageLabel: 'English', speakers: [{ id: 0, label: 'English' }] };
  const ttsSetup = { packs: [pack], activePack: ready ? pack : undefined, sizeLabel: () => '21 MB', statuses: { 'piper-en': ready ? 'ready' : 'missing' }, setEngine: vi.fn(), install: vi.fn() };
  const enable = vi.fn();
  const preview = vi.fn();
  const { VoiceSection } = await loadTs('features/voice/ui/settings/voice-section.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': jsx,
    'react-i18next': translation,
    'expo-router': { useIsFocused: () => true },
    'react-native': { ...native, Platform: { OS: os } },
    "@/shared/platform/voice/speech-output": { stopSpeaking: vi.fn() },
    "@/features/voice/state/use-voice-setup-test": { useVoiceTest: () => undefined },
    "@/shared/platform/voice/tts/catalog": { isPackLanguageCompatible: () => true },
    "@/features/voice/ui/voice-input-setup": { VoiceInputSetup: 'Setup' },
    "@/features/voice/ui/voice-flow-screen": { VoiceFlowScreen: 'Flow' },
    "@/features/voice/ui/voice-language": { voiceLanguageOptions: () => [{ label: 'Follow system', value: '' }] },
    "@/features/voice/ui/settings/local-tts-section": { LocalTtsSection: 'LocalTts' },
    "@/features/voice/ui/settings/voice-more-settings": { VoiceMoreSettings: 'More' },
    "./setting-rows": { Button: 'Button' },
    "@/shared/ui/settings/setting-rows": { SettingSelectField: 'Select', SettingSwitchRow: 'Switch' },
    "@/shared/ui/settings/settings-panel": { SettingTarget: 'Target', useSettingsTarget: () => undefined }
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

describe('mode-dependent voice settings', () => {
  it('is read-only on entry, with no local packs under System', async () => {
    const view = await voice();
    expect(view.update).not.toHaveBeenCalled();
    expect(view.ttsSetup.install).not.toHaveBeenCalled();
    expect(view.enable).not.toHaveBeenCalled();
    expect(all(view.runtime.value, 'LocalTts')).toHaveLength(0);
    expect(all(view.runtime.value, 'Select')).toHaveLength(2);
    const buttons = all(view.runtime.value, 'Button');
    buttons.find((button) => textContent(button) === 'settings:voice.check.enable')!.props.onPress();
    expect(view.enable).toHaveBeenCalledOnce();
    buttons.find((button) => textContent(button) === 'settings:voice.localTts.preview')!.props.onPress();
    expect(view.preview).toHaveBeenCalledOnce();
    const autoPlay = all(view.runtime.value, 'Switch').find((item) => item.props.title === 'settings:voice.autoPlay.title')!;
    autoPlay.props.onValueChange(true);
    expect(view.update).toHaveBeenLastCalledWith({ autoPlayAssistantReplies: true });
    const confirm = all(view.runtime.value, 'Switch').find((item) => item.props.title === 'settings:voice.confirmCommands.title')!;
    confirm.props.onValueChange(false);
    expect(view.update).toHaveBeenLastCalledWith({ confirmVoiceCommands: false });
    const wake = all(view.runtime.value, 'Switch').find((item) => item.props.title === 'settings:voice.requireWakePhrase.title')!;
    wake.props.onValueChange(false);
    expect(view.update).toHaveBeenLastCalledWith({ wakePhraseRequired: false });
  });

  it('shows the unprepared local playback tab without activating or downloading', async () => {
    const view = await voice();
    all(view.runtime.value, 'ToggleGroup')[1].props.onValueChange('local');
    view.runtime.flush();
    expect(view.ttsSetup.setEngine).not.toHaveBeenCalled();
    expect(view.ttsSetup.install).not.toHaveBeenCalled();
    expect(all(view.runtime.value, 'ToggleGroup')[1].props.value).toBe('local');
    expect(all(view.runtime.value, 'Select').some((field) => field.props.options.some((option: any) => option.value === '__system__'))).toBe(false);
    all(view.runtime.value, 'Button').find((button) => textContent(button) === 'settings:voice.setup.manageDownloads')!.props.onPress();
    view.runtime.flush();
    expect(all(view.runtime.value, 'LocalTts')).toHaveLength(1);
    all(view.runtime.value, 'ToggleGroup')[1].props.onValueChange('system');
    expect(view.ttsSetup.setEngine).toHaveBeenCalledWith('system');
  });

  it('reuses ready engines and opens a single setup flow for unprepared input', async () => {
    const ready = await voice('android', true);
    all(ready.runtime.value, 'ToggleGroup')[1].props.onValueChange('local');
    expect(ready.ttsSetup.setEngine).toHaveBeenCalledWith('local');
    all(ready.runtime.value, 'ToggleGroup')[0].props.onValueChange('local');
    expect(ready.update).toHaveBeenCalledWith({ voiceWakeMode: 'local' });
    const missing = await voice();
    all(missing.runtime.value, 'ToggleGroup')[0].props.onValueChange('local');
    missing.runtime.flush();
    expect(missing.update).not.toHaveBeenCalled();
    all(missing.runtime.value, 'Button').find((button) => textContent(button) === 'settings:voice.setup.setUpInput')!.props.onPress();
    missing.runtime.flush();
    expect(all(missing.runtime.value, 'Setup')).toHaveLength(1);
    all(missing.runtime.value, 'Setup')[0].props.onClose();
    missing.runtime.flush();
    expect(all(missing.runtime.value, 'ToggleGroup')[0].props.value).toBe('system');
    expect(missing.update).not.toHaveBeenCalled();
    expect(missing.ttsSetup.install).not.toHaveBeenCalled();
  });

  it('validates OS voices and keeps unsupported web input non-blocking', async () => {
    const view = await voice('web');
    const field = all(view.runtime.value, 'Select').find((item) => item.props.label === 'settings:voice.voiceSelect.label')!;
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
    const { useSpeechVoices } = await loadTs('features/voice/ui/use-speech-voices.ts', {
    ...uiImports,
    react: runtime.react,
    "@/shared/platform/voice/system-tts": { getSpeechVoiceOptions: () => options.promise }
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
    const { useSpeechVoices } = await loadTs('features/voice/ui/use-speech-voices.ts', {
    ...uiImports,
    react: runtime.react,
    "@/shared/platform/voice/system-tts": { getSpeechVoiceOptions: () => options.promise }
  });
    runtime.mount(useSpeechVoices, {});
    runtime.unmount();
    options.resolve([{ id: 'late-voice' }]);
    await runtime.settle();
    expect(runtime.value.voices).toHaveLength(0);
  });
});
