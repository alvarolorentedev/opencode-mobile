import type { TranscriptRow } from '@/lib/opencode/transcript';
import type { SessionStatus } from '@/lib/opencode/types';

export const STARTER_PROMPT_KEYS = [
  'chat:starter.prompts.polish',
  'chat:starter.prompts.review',
  'chat:starter.prompts.implement',
];

export function getModelVariantLabel(variantId: string | undefined, t: (key: string) => string) {
  if (!variantId) return t('chat:reasoning.default');
  return ['low', 'default', 'high', 'max'].includes(variantId) ? t(`chat:reasoning.${variantId}`) : variantId;
}

export function getAutoApproveIcon(autoApprove: boolean) {
  return autoApprove ? 'alert-outline' : 'shield-outline';
}

// The live activity row has to describe work that is not represented by a
// transcript activity row yet (a brand-new turn, a pending prompt, or a
// Messages-only transcript). Precedence follows what the user can act on: an
// in-flight local send wins over server state, retries are called out, and a
// pending prompt falls back to a waiting label.
export type ChatActivityState = 'sending' | 'waiting' | 'working' | 'retrying';

// The progress anchor belongs to the current turn. A row from a previous turn
// may still be visible above a freshly sent user message, but it must not hide
// the live status row that covers the new turn's startup.
export function getCurrentTurnActivityKey(rows: TranscriptRow[]): string | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.type === 'activity') return row.key;
    if (row.type === 'message' && row.entry.role === 'user') return undefined;
  }
  return undefined;
}

export function getChatActivityState({
  awaitingUserInput,
  sendingStateActive,
  submitting,
  pendingActive,
  status,
}: {
  awaitingUserInput: boolean;
  sendingStateActive: boolean;
  submitting: boolean;
  pendingActive: boolean;
  status?: SessionStatus;
}): ChatActivityState | undefined {
  if (awaitingUserInput) return undefined;
  if (submitting || sendingStateActive) return 'sending';
  if (status?.type === 'retry') return 'retrying';
  if (status && status.type !== 'idle') return 'working';
  if (pendingActive) return 'waiting';
  return undefined;
}
