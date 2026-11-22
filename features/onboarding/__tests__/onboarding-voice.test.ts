// @vitest-environment happy-dom

import { nativePrimitives } from '../../../tests/helpers/native-primitives';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { UpdateBlockingSettingSelectField } from '@/features/updates/index';
import { LocalTtsSection } from '@/features/voice/ui/settings/local-tts-section';
import { VoiceSection, type VoiceSectionProps } from '@/features/voice/ui/settings/voice-section';
import { VoiceInputSetup } from '@/features/voice/ui/voice-input-setup';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import { Colors } from '@/shared/ui/theme/theme';
import { Button } from '@/shared/ui/button';
import { SettingSwitchRow } from '@/shared/ui/settings/setting-rows';
import { FieldDescription } from '@/shared/ui/text-field';
import { useSpeechVoices } from '@/features/voice/ui/use-speech-voices';
import { deferred, settleReact } from '../../../tests/helpers/controlled-clock';
import { textContent } from '../../../tests/helpers/text-content';
import { ToggleGroup } from '@/shared/ui/toggle-group';
import { renderHook } from '../../../tests/helpers/render-hook';

const variant = vi.hoisted(() => ({ platform: 'android' }));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform(variant));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { foss: false } } } }));
vi.mock('expo-router', () => ({ useIsFocused: () => true }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

type Element = { type: unknown; props: Record<string, any> };
function all(root: Element | Element[], type: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap((child) => all(child, type));
  if (!root || typeof root !== 'object') return [];
  return [...(root.type === type ? [root] : []), ...all(root.props?.children, type)];
}
function voice(os = 'android', ready = false) {
  variant.platform = os;
  const update = vi.fn();
  const localVoice = { status: ready ? 'ready' : 'missing', microphone: { granted: ready }, clearError: vi.fn(), refresh: vi.fn(), enrollment: { hasProfile: ready, cancel: vi.fn(async () => {}) } };
  const pack = { id: 'piper-en', vendor: 'Piper', languageLabel: 'English', speakers: [{ id: 0, label: 'English' }] };
  const ttsSetup = { packs: [pack], activePack: ready ? pack : undefined, sizeLabel: () => '21 MB', statuses: { 'piper-en': ready ? 'ready' : 'missing' }, setEngine: vi.fn(), install: vi.fn() };
  const enable = vi.fn();
  const preview = vi.fn();
  const props: VoiceSectionProps = {
    onboarding: true, chatPreferences: defaultChatPreferences, palette: Colors.light,
    availableSpeechVoices: [{ id: 'voice-en', label: 'English', language: 'en-US', quality: 'default' }],
    isRefreshingSpeechVoices: false, isTestingVoice: false,
    selectedSpeechVoiceLabel: 'English', selectedWorkingSound: { value: 'soft' },
    localVoice: localVoice as unknown as VoiceSectionProps['localVoice'],
    ttsSetup: ttsSetup as unknown as VoiceSectionProps['ttsSetup'],
    updateChatPreferences: update, onEnableVoiceInput: enable, onTestVoicePlayback: preview,
    onOpenVoiceSettings: vi.fn(),
    voiceCapabilities: { recognitionAvailable: true, onDeviceSupported: false, permission: { restricted: false, available: true, canAskAgain: true, granted: false } },
  };
  const runtime = renderHook(VoiceSection, props);
  return { runtime, props, update, localVoice, ttsSetup, enable, preview, preferences: defaultChatPreferences };
}

describe('mode-dependent voice settings', () => {
  it('is read-only on entry, with no local packs under System', async () => {
    const view = voice();
    expect(view.update).not.toHaveBeenCalled();
    expect(view.ttsSetup.install).not.toHaveBeenCalled();
    expect(view.enable).not.toHaveBeenCalled();
    expect(all(view.runtime.result.current, LocalTtsSection)).toHaveLength(0);
    expect(all(view.runtime.result.current, UpdateBlockingSettingSelectField)).toHaveLength(2);
    const buttons = all(view.runtime.result.current, Button);
    act(() => buttons.find((button) => textContent(button) === 'settings:voice.check.enable')!.props.onPress());
    expect(view.enable).toHaveBeenCalledOnce();
    act(() => buttons.find((button) => textContent(button) === 'settings:voice.localTts.preview')!.props.onPress());
    expect(view.preview).toHaveBeenCalledOnce();
    const autoPlay = all(view.runtime.result.current, SettingSwitchRow).find((item) => item.props.title === 'settings:voice.autoPlay.title')!;
    act(() => autoPlay.props.onValueChange(true));
    expect(view.update).toHaveBeenLastCalledWith({ autoPlayAssistantReplies: true });
    const confirm = all(view.runtime.result.current, SettingSwitchRow).find((item) => item.props.title === 'settings:voice.confirmCommands.title')!;
    act(() => confirm.props.onValueChange(false));
    expect(view.update).toHaveBeenLastCalledWith({ confirmVoiceCommands: false });
    const wake = all(view.runtime.result.current, SettingSwitchRow).find((item) => item.props.title === 'settings:voice.requireWakePhrase.title')!;
    act(() => wake.props.onValueChange(false));
    expect(view.update).toHaveBeenLastCalledWith({ wakePhraseRequired: false });
  });

  it('shows the unprepared local playback tab without activating or downloading', async () => {
    const view = voice();
    act(() => all(view.runtime.result.current, ToggleGroup)[1].props.onValueChange('local'));
    expect(view.ttsSetup.setEngine).not.toHaveBeenCalled();
    expect(view.ttsSetup.install).not.toHaveBeenCalled();
    expect(all(view.runtime.result.current, ToggleGroup)[1].props.value).toBe('local');
    expect(all(view.runtime.result.current, UpdateBlockingSettingSelectField).some((field) => field.props.options.some((option: any) => option.value === '__system__'))).toBe(false);
    act(() => all(view.runtime.result.current, Button).find((button) => textContent(button) === 'settings:voice.setup.manageDownloads')!.props.onPress());
    expect(all(view.runtime.result.current, LocalTtsSection)).toHaveLength(1);
    act(() => all(view.runtime.result.current, ToggleGroup)[1].props.onValueChange('system'));
    expect(view.ttsSetup.setEngine).toHaveBeenCalledWith('system');
  });

  it('reuses ready engines and opens a single setup flow for unprepared input', async () => {
    const ready = voice('android', true);
    act(() => all(ready.runtime.result.current, ToggleGroup)[1].props.onValueChange('local'));
    expect(ready.ttsSetup.setEngine).toHaveBeenCalledWith('local');
    act(() => all(ready.runtime.result.current, ToggleGroup)[0].props.onValueChange('local'));
    expect(ready.update).toHaveBeenCalledWith({ voiceWakeMode: 'local' });
    const missing = voice();
    act(() => all(missing.runtime.result.current, ToggleGroup)[0].props.onValueChange('local'));
    expect(missing.update).not.toHaveBeenCalled();
    act(() => all(missing.runtime.result.current, Button).find((button) => textContent(button) === 'settings:voice.setup.setUpInput')!.props.onPress());
    expect(all(missing.runtime.result.current, VoiceInputSetup)).toHaveLength(1);
    act(() => all(missing.runtime.result.current, VoiceInputSetup)[0].props.onClose());
    expect(all(missing.runtime.result.current, ToggleGroup)[0].props.value).toBe('system');
    expect(missing.update).not.toHaveBeenCalled();
    expect(missing.ttsSetup.install).not.toHaveBeenCalled();
  });

  it('validates OS voices and keeps unsupported web input non-blocking', async () => {
    const view = voice('web');
    const field = all(view.runtime.result.current, UpdateBlockingSettingSelectField).find((item) => item.props.label === 'settings:voice.voiceSelect.label')!;
    act(() => field.props.onValueChange('missing'));
    expect(view.update).not.toHaveBeenCalled();
    act(() => field.props.onValueChange('voice-en'));
    expect(view.update).toHaveBeenCalledWith({ speechVoiceId: 'voice-en', speechLocale: 'en-US' });
    act(() => field.props.onValueChange('__system__'));
    expect(view.update).toHaveBeenLastCalledWith({ speechVoiceId: undefined });
    view.runtime.rerender({ ...view.props, voiceCapabilities: { recognitionAvailable: false, onDeviceSupported: false, permission: { restricted: false, available: false, granted: false, canAskAgain: false } } });
    expect(all(view.runtime.result.current, FieldDescription).some((item) => item.props.children === 'onboarding:permissions.voice.unsupported')).toBe(true);
  });
});

describe('voice enumeration lifecycle', () => {
  it('finishes loading after an enumeration failure', async () => {
    variant.platform = 'android';
    const options = deferred<Awaited<ReturnType<typeof import('expo-speech').getAvailableVoicesAsync>>>();
    nativePrimitives.getAvailableVoicesAsync.mockReturnValueOnce(options.promise);
    const runtime = renderHook(useSpeechVoices, undefined);
    options.reject(new Error('Unavailable'));
    await settleReact();
    expect(runtime.result.current.isLoading).toBe(false);
    expect(runtime.result.current.voices).toHaveLength(0);
    runtime.unmount();
  });

  it('ignores enumeration results after leaving the screen', async () => {
    variant.platform = 'android';
    const options = deferred<Awaited<ReturnType<typeof import('expo-speech').getAvailableVoicesAsync>>>();
    nativePrimitives.getAvailableVoicesAsync.mockReturnValueOnce(options.promise);
    const runtime = renderHook(useSpeechVoices, undefined);
    runtime.unmount();
    options.resolve([{ identifier: 'late-voice', name: 'Late', language: 'en-US', quality: 'Default' as never }]);
    await settleReact();
    expect(runtime.result.current.voices).toHaveLength(0);
  });
});
