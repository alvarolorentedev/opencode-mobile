import { uiImports } from '../../../tests/helpers/ui.mjs';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';
import { describe, expect, it, vi } from 'vitest';

type Element = { type: unknown; props: Record<string, any> };
function all(root: Element | Element[], type: string): Element[] {
  if (Array.isArray(root)) return root.flatMap((child) => all(child, type));
  if (!root || typeof root !== 'object') return [];
  return [...(root.type === type ? [root] : []), ...all(root.props?.children, type)];
}

async function setup(foss: boolean) {
  const runtime = hookRuntime();
  const constants = { __esModule: true, default: { expoConfig: { extra: { foss } } } };
  const { VoiceSection } = await loadTs('features/voice/ui/settings/voice-section.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': {
      jsx: (type: unknown, props: object) => ({ type, props }),
      jsxs: (type: unknown, props: object) => ({ type, props }),
    },
    'expo-constants': constants,
    'expo-router': { useIsFocused: () => false },
    'react-native': { Platform: { OS: 'android' }, StyleSheet: { create: (styles: object) => styles, hairlineWidth: 1 }, View: 'View' },
    '@/shared/platform/voice/speech-output': { stopSpeaking: vi.fn() },
    '@/features/voice/state/use-voice-setup-test': { useVoiceTest: () => undefined },
    '@/shared/platform/voice/tts/catalog': { isPackLanguageCompatible: () => true },
    '@/shared/ui/settings/settings-panel': { SettingTarget: 'SettingTarget', useSettingsTarget: () => undefined },
    '@/features/voice/ui/voice-input-setup': { VoiceInputSetup: 'VoiceInputSetup' },
    '@/features/voice/ui/voice-flow-screen': { VoiceFlowScreen: 'VoiceFlowScreen' },
    '@/features/voice/ui/voice-language': { voiceLanguageOptions: () => [{ value: '', label: 'System' }] },
    '@/features/voice/ui/settings/local-tts-section': { LocalTtsSection: 'LocalTtsSection' },
    '@/features/voice/ui/settings/voice-more-settings': { VoiceMoreSettings: 'VoiceMoreSettings' },
    '@/shared/ui/settings/setting-rows': { SettingSelectField: 'SettingSelectField', SettingSwitchRow: 'SettingSwitchRow' },
  }, runtime.globals);
  const props = {
    availableSpeechVoices: [], chatPreferences: {
      voiceWakeMode: 'local', ttsEngine: 'local', localSpeakerVerification: false,
      localTtsSpeakerId: 0, speechLocale: '', wakePhraseRequired: true,
      confirmVoiceCommands: false, autoPlayAssistantReplies: false,
    },
    isRefreshingSpeechVoices: false, isTestingVoice: false,
    localVoice: { status: 'unsupported', microphone: undefined, enrollment: { cancel: vi.fn(async () => {}) } },
    onEnableVoiceInput: vi.fn(), onOpenVoiceSettings: vi.fn(), onTestVoicePlayback: vi.fn(),
    palette: {}, selectedSpeechVoiceLabel: 'System', selectedWorkingSound: { value: 'none' },
    ttsSetup: { activePack: undefined, statuses: {}, packs: [], error: undefined, isPreviewing: false, setEngine: vi.fn(), sizeLabel: () => '' },
    updateChatPreferences: vi.fn(),
  } as any;
  runtime.mount(VoiceSection, props);
  return runtime;
}

describe('voice settings variant visibility', () => {
  it('hides Sherpa input and playback selectors and setup flows in FOSS despite saved local preferences', async () => {
    const runtime = await setup(true);
    expect(all(runtime.value, 'ToggleGroupItem')).toHaveLength(0);
    expect(all(runtime.value, 'VoiceInputSetup')).toHaveLength(0);
    expect(all(runtime.value, 'VoiceFlowScreen')).toHaveLength(0);
    expect(all(runtime.value, 'LocalTtsSection')).toHaveLength(0);
    expect(all(runtime.value, 'SettingSelectField')).toHaveLength(2);
  });

  it('keeps both local mode selectors in non-FOSS builds', async () => {
    const runtime = await setup(false);
    expect(all(runtime.value, 'ToggleGroupItem')).toHaveLength(4);
  });
});
