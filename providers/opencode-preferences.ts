// Chat preference model, defaults, and the system prompt derived from them.
// Kept separate from provider orchestration so preference shape and prompt
// wording are changed in one place.

import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_THEME_MODE,
  type AccentColor,
  type ThemeMode,
} from '@/constants/appearance';
import { DEFAULT_WAKE_PHRASE } from '@/lib/voice/wake-phrase';
export type ResponseScope = 'brief' | 'balanced' | 'detailed';
export const TRANSCRIPT_FONT_SIZE_MIN = 12;
export const TRANSCRIPT_FONT_SIZE_MAX = 24;
export const DEFAULT_TRANSCRIPT_FONT_SIZE = 16;

export function normalizeTranscriptFontSize(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(TRANSCRIPT_FONT_SIZE_MAX, Math.max(TRANSCRIPT_FONT_SIZE_MIN, Math.round(value)))
    : DEFAULT_TRANSCRIPT_FONT_SIZE;
}

export type ChatPreferences = {
  mode: string;
  // App-level appearance. Stored with chat preferences because the shell is
  // global, but deliberately excluded from serverPreferences so connections do
  // not overwrite the user's theme.
  themeMode: ThemeMode;
  accentColor: AccentColor;
  promptDelivery: 'steer' | 'queue';
  transcriptFontSize: number;
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
  autoApprove: boolean;
  autoPlayAssistantReplies: boolean;
  preferOnDeviceRecognition: boolean;
  resumeListeningAfterReply: boolean;
  // Conversation mode only starts a turn after hearing this phrase. Stored
  // globally because it is a voice-input preference, not connection state.
  conversationWakePhrase: string;
  speechLocale?: string;
  speechRate: number;
  speechVoiceId?: string;
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
  flatTranscript: false,
  slimInterface: false,
  enabledModelIds: [],
  providerModelSelections: {},
  modelVariantSelections: {},
  recentModelIds: [],
  autoApprove: false,
  autoPlayAssistantReplies: false,
  preferOnDeviceRecognition: true,
  resumeListeningAfterReply: true,
  conversationWakePhrase: DEFAULT_WAKE_PHRASE,
  speechRate: 1,
  workingSoundEnabled: false,
  workingSoundVariant: 'soft',
  workingSoundVolume: 0.18,
  responseScope: 'brief',
  includeNextActions: true,
  hideSubagentChats: true,
  showWidgetPreviews: true,
};

function buildResponseStyleSystemPrompt(scope: ResponseScope, includeNextActions: boolean) {
  const scopeInstruction =
    scope === 'brief'
      ? 'Keep responses tightly scoped. Use short paragraphs or brief bullets and avoid extra background unless the user asks for it.'
      : scope === 'detailed'
        ? 'Give fuller explanations when helpful, but still stay conversational and focused on the user request.'
        : 'Keep responses concise and user-friendly, with only the context needed to understand the answer.';

  const nextActionsInstruction = includeNextActions
    ? 'When there are useful next actions, end with a simple explanation of the recommended next step or a short numbered list.'
    : 'Do not add next actions unless the user explicitly asks for them.';

  return `${scopeInstruction} ${nextActionsInstruction}`;
}

export function buildSystemPrompt(preferences: ChatPreferences) {
  return buildResponseStyleSystemPrompt(preferences.responseScope, preferences.includeNextActions);
}
