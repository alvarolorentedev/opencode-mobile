import { z } from 'zod';

import { ACCENT_COLORS, THEME_MODES } from '@/constants/appearance';
import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import { parseConnectMetadata } from '@/lib/connect';
import { stripServerUrlCredentials } from '@/lib/opencode/client/url';
import { normalizeWakePhrase } from '@/lib/voice/wake-phrase';
import { normalizeLocalCommandModel, normalizeLocalWakePhrase } from '@/lib/voice/local-wake-word/types';
import { normalizeTranscriptFontSize, type ChatPreferences } from '@/providers/opencode-preferences';

const ConnectionSettingsSchema = z.object({
  serverUrl: z.string().optional(),
  username: z.string().optional(),
  directory: z.string().optional(),
  password: z.string().optional(),
  connect: z.unknown().optional(),
});

export function parseConnectionSettings(raw: string): Partial<OpencodeConnectionSettings> {
  const parsed = ConnectionSettingsSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error('Invalid connection settings.');

  const value = parsed.data;
  const settings: Partial<OpencodeConnectionSettings> = {};
  for (const key of ['serverUrl', 'username', 'directory', 'password'] as const) {
    if (value[key] !== undefined) settings[key] = value[key];
  }
  if (settings.serverUrl) settings.serverUrl = stripServerUrlCredentials(settings.serverUrl);
  if (value.connect !== undefined) {
    const connect = parseConnectMetadata(value.connect);
    if (!connect || connect.deviceId !== settings.username?.trim()) throw new Error('Invalid Cloud Link identity.');
    settings.connect = connect;
  }
  return settings;
}

const optionalString = z.string().optional().catch(undefined);
const optionalBoolean = z.boolean().optional().catch(undefined);
const optionalNumber = (transform: (value: number) => number) => z.unknown().transform((value) => (
  typeof value === 'number' && Number.isFinite(value) ? transform(value) : undefined
));

const ChatPreferencesSchema = z.object({
  mode: optionalString,
  providerId: optionalString,
  modelId: optionalString,
  language: optionalString,
  speechLocale: optionalString,
  speechVoiceId: optionalString,
  ttsEngine: z.enum(['system', 'local']).optional().catch(undefined),
  localTtsPackId: optionalString,
  localTtsSpeakerId: optionalNumber((value) => Math.min(999, Math.max(0, Math.trunc(value)))).optional(),
  flatTranscript: optionalBoolean,
  slimInterface: optionalBoolean,
  autoApprove: optionalBoolean,
  autoPlayAssistantReplies: optionalBoolean,
  preferOnDeviceRecognition: optionalBoolean,
  readInterimAssistantReplies: optionalBoolean,
  workingSoundEnabled: optionalBoolean,
  includeNextActions: optionalBoolean,
  hideSubagentChats: optionalBoolean,
  showWidgetPreviews: optionalBoolean,
  enabledModelIds: z.array(z.string()).optional().catch(undefined),
  recentModelIds: z.array(z.string()).optional().catch(undefined),
  providerModelSelections: z.record(z.string(), z.string()).optional().catch(undefined),
  modelVariantSelections: z.record(z.string(), z.union([z.string(), z.null()])).optional().catch(undefined),
  themeMode: z.enum(THEME_MODES).optional().catch(undefined),
  accentColor: z.enum(ACCENT_COLORS).optional().catch(undefined),
  promptDelivery: z.enum(['steer', 'queue']).optional().catch(undefined),
  responseScope: z.enum(['brief', 'balanced', 'detailed']).optional().catch(undefined),
  workingSoundVariant: z.enum(['soft', 'glass']).optional().catch(undefined),
  conversationWakePhrase: z.unknown().transform((value) => (
    typeof value === 'string' ? normalizeWakePhrase(value) : undefined
  )).optional(),
  voiceWakeMode: z.enum(['phrase', 'local']).optional().catch(undefined),
  localWakePhrase: z.unknown().transform((value) => (
    value === undefined ? undefined : normalizeLocalWakePhrase(value)
  )).optional(),
  localCommandModel: z.unknown().transform((value) => (
    value === undefined ? undefined : normalizeLocalCommandModel(value)
  )).optional(),
  localSpeakerVerification: optionalBoolean,
  localSpeakerThreshold: optionalNumber((value) => Math.min(0.95, Math.max(0.2, value))).optional(),
  transcriptFontSize: optionalNumber(normalizeTranscriptFontSize).optional(),
  speechRate: optionalNumber((value) => Math.min(1.5, Math.max(0.5, value))).optional(),
  workingSoundVolume: optionalNumber((value) => Math.min(1, Math.max(0, value))).optional(),
});

export function parseChatPreferences(raw: string): Partial<ChatPreferences> {
  const parsed = ChatPreferencesSchema.parse(JSON.parse(raw));
  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => value !== undefined),
  ) as Partial<ChatPreferences>;
}
