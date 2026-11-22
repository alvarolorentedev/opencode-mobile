// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { describe, expect, it, vi } from 'vitest';

import { UpdateBlockingSettingSelectField } from '@/features/updates/index';
import { LocalTtsSection } from '@/features/voice/ui/settings/local-tts-section';
import { VoiceSection, type VoiceSectionProps } from '@/features/voice/ui/settings/voice-section';
import { VoiceFlowScreen } from '@/features/voice/ui/voice-flow-screen';
import { VoiceInputSetup } from '@/features/voice/ui/voice-input-setup';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import { Colors } from '@/shared/ui/theme/theme';
import { ToggleGroupItem } from '@/shared/ui/toggle-group';
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
  useTranslation: () => ({ t: (key: string) => key }),
}));

type Element = { type: unknown; props: Record<string, any> };
function all(root: Element | Element[], type: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap((child) => all(child, type));
  if (!root || typeof root !== 'object') return [];
  return [...(root.type === type ? [root] : []), ...all(root.props?.children, type)];
}

function setup(foss: boolean) {
  variant.foss = foss;
  return renderHook(VoiceSection, {
    availableSpeechVoices: [],
    chatPreferences: { ...defaultChatPreferences, voiceWakeMode: 'local', ttsEngine: 'local' },
    isRefreshingSpeechVoices: false,
    isTestingVoice: false,
    localVoice: { status: 'unsupported', enrollment: { cancel: vi.fn(async () => {}) } } as unknown as VoiceSectionProps['localVoice'],
    onEnableVoiceInput: vi.fn(),
    onOpenVoiceSettings: vi.fn(),
    onTestVoicePlayback: vi.fn(),
    palette: Colors.light,
    selectedSpeechVoiceLabel: 'System',
    selectedWorkingSound: { value: 'soft' },
    ttsSetup: { activePack: undefined, statuses: {}, packs: [], error: undefined, isPreviewing: false, setEngine: vi.fn(), sizeLabel: () => '' } as unknown as VoiceSectionProps['ttsSetup'],
    updateChatPreferences: vi.fn(),
  });
}

describe('voice settings variant visibility', () => {
  it('hides Sherpa input and playback selectors and setup flows in FOSS despite saved local preferences', async () => {
    const runtime = setup(true);
    expect(all(runtime.result.current, ToggleGroupItem)).toHaveLength(0);
    expect(all(runtime.result.current, VoiceInputSetup)).toHaveLength(0);
    expect(all(runtime.result.current, VoiceFlowScreen)).toHaveLength(0);
    expect(all(runtime.result.current, LocalTtsSection)).toHaveLength(0);
    expect(all(runtime.result.current, UpdateBlockingSettingSelectField)).toHaveLength(2);
  });

  it('keeps both local mode selectors in non-FOSS builds', async () => {
    const runtime = setup(false);
    expect(all(runtime.result.current, ToggleGroupItem)).toHaveLength(4);
  });
});
