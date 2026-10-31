// Chat preference model, defaults, and the system prompt derived from them.
// Kept separate from provider orchestration so preference shape and prompt
// wording are changed in one place.

import { DEFAULT_ACCENT_COLOR, DEFAULT_THEME_MODE, type AccentColor, type ThemeMode } from '@/shared/ui/theme/appearance';
import { defaultAutoModelPreferences, type AutoModelPreferences } from '@/shared/preferences/auto-model';
import type { TimelineDetail } from '@/shared/presentation/transcript';
import { DEFAULT_WAKE_PHRASE } from '@/shared/platform/voice/wake-phrase';
import { DEFAULT_LOCAL_WAKE_PHRASE, DEFAULT_LOCAL_COMMAND_MODEL, type LocalCommandModelId, type LocalWakePhraseId } from '@/shared/platform/voice/local-wake-word/types';
export type ResponseScope = 'brief' | 'balanced' | 'detailed';
export const TRANSCRIPT_FONT_SIZE_MIN = 12;
export const TRANSCRIPT_FONT_SIZE_MAX = 24;
export const DEFAULT_TRANSCRIPT_FONT_SIZE = 16;

export function normalizeTranscriptFontSize(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(TRANSCRIPT_FONT_SIZE_MAX, Math.max(TRANSCRIPT_FONT_SIZE_MIN, Math.round(value)))
    : DEFAULT_TRANSCRIPT_FONT_SIZE;
}

export { defaultAutoModelPreferences, normalizeAutoModelPreferences } from '@/shared/preferences/auto-model';
export type { AutoModelClassifier, AutoModelPreferences, AutoModelTierPreference } from '@/shared/preferences/auto-model';

export type ChatPreferences = {
  mode: string;
  // App-level appearance. Stored with chat preferences because the shell is
  // global, but deliberately excluded from serverPreferences so connections do
  // not overwrite the user's theme.
  themeMode: ThemeMode;
  accentColor: AccentColor;
  promptDelivery: 'steer' | 'queue';
  transcriptFontSize: number;
  // How much non-bubble activity appears in the feed. `messages` keeps only
  // message bubbles, `reasoning` adds reasoning rows, and `everything` keeps
  // the full detailed timeline.
  timelineDetail: TimelineDetail;
  // Flat transcript renders messages full-width without bubble chrome so more
  // of the conversation is visible at once. Defaults to the bubble layout.
  flatTranscript: boolean;
  // Slim interface reduces control sizes, paddings, and header heights on the
  // text-heavy screens so the transcript/output/code gets more room.
  slimInterface: boolean;
  // App UI language preference. `undefined` follows the OS locale; it is stored
  // alongside chat preferences because it is global and not connection-scoped.
  language?: string;
  providerId?: string;
  modelId?: string;
  enabledModelIds: string[];
  providerModelSelections: Record<string, string>;
  modelVariantSelections: Record<string, string | null>;
  recentModelIds: string[];
  // Per-connection model routing preferences. Model IDs are validated against
  // the active catalog at send time rather than erased when a catalog is slow.
  autoModel: AutoModelPreferences;
  autoApprove: boolean;
  autoPlayAssistantReplies: boolean;
  preferOnDeviceRecognition: boolean;
  // Conversation-mode voice commands are reviewed before submission by default.
  confirmVoiceCommands: boolean;
  readInterimAssistantReplies: boolean;
  // Conversation mode only starts a turn after hearing this phrase. Stored
  // globally because it is a voice-input preference, not connection state.
  conversationWakePhrase: string;
  // When false, conversation mode listens immediately and re-arms after every
  // reply. Confirmation remains the submission gate.
  wakePhraseRequired: boolean;
  // `phrase` uses the OS recognizer text gate. `local` runs the opt-in
  // sherpa-onnx wake-word and speaker-verification path.
  voiceWakeMode: 'phrase' | 'local';
  localWakePhrase: LocalWakePhraseId;
  localCommandModel: LocalCommandModelId;
  localSpeakerVerification: boolean;
  localSpeakerThreshold: number;
  speechLocale?: string;
  speechRate: number;
  speechVoiceId?: string;
  // Playback engine. System is always available; local is opt-in and requires
  // an explicitly selected, installed model pack.
  ttsEngine: 'system' | 'local';
  localTtsPackId?: string;
  localTtsSpeakerId: number;
  workingSoundEnabled: boolean;
  workingSoundVariant: 'soft' | 'glass';
  workingSoundVolume: number;
  responseScope: ResponseScope;
  includeNextActions: boolean;
  hideSubagentChats: boolean;
  showWidgetPreviews: boolean;
};

export const defaultChatPreferences: ChatPreferences = {
  mode: 'build',
  themeMode: DEFAULT_THEME_MODE,
  accentColor: DEFAULT_ACCENT_COLOR,
  promptDelivery: 'steer',
  transcriptFontSize: DEFAULT_TRANSCRIPT_FONT_SIZE,
  timelineDetail: 'everything',
  flatTranscript: false,
  slimInterface: false,
  enabledModelIds: [],
  providerModelSelections: {},
  modelVariantSelections: {},
  recentModelIds: [],
  autoModel: defaultAutoModelPreferences,
  autoApprove: false,
  autoPlayAssistantReplies: false,
  preferOnDeviceRecognition: true,
  confirmVoiceCommands: true,
  readInterimAssistantReplies: false,
  conversationWakePhrase: DEFAULT_WAKE_PHRASE,
  wakePhraseRequired: true,
  voiceWakeMode: 'phrase',
  localWakePhrase: DEFAULT_LOCAL_WAKE_PHRASE,
  localCommandModel: DEFAULT_LOCAL_COMMAND_MODEL,
  localSpeakerVerification: true,
  localSpeakerThreshold: 0.5,
  speechRate: 1,
  ttsEngine: 'system',
  localTtsSpeakerId: 0,
  workingSoundEnabled: false,
  workingSoundVariant: 'soft',
  workingSoundVolume: 0.18,
  responseScope: 'brief',
  includeNextActions: true,
  hideSubagentChats: true,
  showWidgetPreviews: true,
};

