import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import { parseConnectMetadata } from '@/lib/connect';
import { isAccentMode } from '@/constants/accent';
import { normalizeTranscriptFontSize, type ChatPreferences } from '@/providers/opencode-preferences';

function parseObject(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}

export function parseConnectionSettings(raw: string): Partial<OpencodeConnectionSettings> {
  const value = parseObject(raw);
  const settings: Partial<OpencodeConnectionSettings> = {};
  for (const key of ['serverUrl', 'username', 'directory', 'password'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') throw new Error(`Invalid connection ${key}.`);
    settings[key] = value[key];
  }
  if (value.connect !== undefined) {
    const connect = parseConnectMetadata(value.connect);
    if (!connect || connect.deviceId !== settings.username?.trim()) throw new Error('Invalid Cloud Link identity.');
    settings.connect = connect;
  }
  return settings;
}

export function parseChatPreferences(raw: string): Partial<ChatPreferences> {
  const value = parseObject(raw);
  const preferences: Record<string, unknown> = {};
  for (const key of ['mode', 'providerId', 'modelId', 'language', 'speechLocale', 'speechVoiceId']) {
    if (typeof value[key] === 'string') preferences[key] = value[key];
  }
  for (const key of ['flatTranscript', 'slimInterface', 'autoApprove', 'autoPlayAssistantReplies', 'preferOnDeviceRecognition', 'resumeListeningAfterReply', 'workingSoundEnabled', 'includeNextActions', 'hideSubagentChats']) {
    if (typeof value[key] === 'boolean') preferences[key] = value[key];
  }
  for (const key of ['enabledModelIds', 'recentModelIds']) {
    const entries = value[key];
    if (Array.isArray(entries) && entries.every((entry) => typeof entry === 'string')) preferences[key] = [...entries];
  }
  const selections = value.providerModelSelections;
  if (selections && typeof selections === 'object' && !Array.isArray(selections) && Object.values(selections).every((entry) => typeof entry === 'string')) {
    preferences.providerModelSelections = { ...selections };
  }
  for (const [key, options] of Object.entries({ reasoning: ['low', 'default', 'high'], responseScope: ['brief', 'balanced', 'detailed'], workingSoundVariant: ['soft', 'glass'] })) {
    if (typeof value[key] === 'string' && options.includes(value[key])) preferences[key] = value[key];
  }
  if (isAccentMode(value.accent)) preferences.accent = value.accent;
  if (typeof value.transcriptFontSize === 'number') preferences.transcriptFontSize = normalizeTranscriptFontSize(value.transcriptFontSize);
  if (typeof value.speechRate === 'number' && Number.isFinite(value.speechRate)) preferences.speechRate = Math.min(1.5, Math.max(0.5, value.speechRate));
  if (typeof value.workingSoundVolume === 'number' && Number.isFinite(value.workingSoundVolume)) preferences.workingSoundVolume = Math.min(1, Math.max(0, value.workingSoundVolume));
  return preferences as Partial<ChatPreferences>;
}
