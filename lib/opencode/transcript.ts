import type { SessionMessageRecord, TranscriptDetail, TranscriptEntry } from '@/lib/opencode/format';

// How much of the native timeline the transcript renders. `conversation` is the
// default: user and assistant messages only. Higher levels add tool calls and
// reasoning as flat, collapsible rows.
export type TranscriptVerbosity = 'conversation' | 'tools' | 'verbose';

export const TRANSCRIPT_VERBOSITIES: readonly TranscriptVerbosity[] = ['conversation', 'tools', 'verbose'];

// Details rendered as collapsible (non-bubble) rows outside the message card.
export function isCollapsibleDetail(detail: TranscriptDetail) {
  return detail.kind === 'tool' || detail.kind === 'reasoning' || detail.kind === 'subtask' || detail.kind === 'step' || detail.kind === 'agent';
}

// Whether a detail is surfaced at the given verbosity. Files are attachments
// and are always shown with their message; patches stay review chips.
export function isDetailVisible(detail: TranscriptDetail, verbosity: TranscriptVerbosity) {
  if (verbosity === 'conversation') return false;
  if (detail.kind === 'tool' || detail.kind === 'patch') return true;
  return verbosity === 'verbose'
    && (detail.kind === 'reasoning' || detail.kind === 'subtask' || detail.kind === 'step' || detail.kind === 'agent');
}

export function getTranscriptActivityLabel(entry: TranscriptEntry) {
  const runningTool = entry.details.find((detail) => detail.kind === 'tool' && detail.status === 'running');
  if (runningTool) {
    return runningTool.label;
  }

  const latestTool = [...entry.details].reverse().find((detail) => detail.kind === 'tool');
  if (latestTool) {
    return latestTool.label;
  }

  const latestPatch = [...entry.details].reverse().find((detail) => detail.kind === 'patch');
  if (latestPatch) {
    return latestPatch.label;
  }

  const latestReasoning = [...entry.details].reverse().find((detail) => detail.kind === 'reasoning');
  if (latestReasoning) {
    return latestReasoning.label;
  }

  const latestStep = [...entry.details].reverse().find((detail) => detail.kind === 'step' || detail.kind === 'subtask');
  if (latestStep) {
    return latestStep.label;
  }

  return undefined;
}

export function isTranscriptDisplayMessage(entry: TranscriptEntry, verbosity: TranscriptVerbosity = 'conversation') {
  if (entry.role === 'user') {
    return true;
  }

  if (entry.text.trim() || entry.error || entry.details.some((detail) => detail.kind === 'file')) {
    return true;
  }

  // A tool-only or reasoning-only turn is hidden at conversation verbosity but
  // surfaces as collapsible rows at higher levels. Patch-only turns are tool
  // output too.
  return entry.details.some((detail) => isDetailVisible(detail, verbosity));
}

export function summarizeTranscriptDetails(details: TranscriptDetail[], labels?: { patches: (count: number) => string; files: (count: number) => string }) {
  const patches = details.filter((detail) => detail.kind === 'patch').length;
  const files = details.filter((detail) => detail.kind === 'file').length;
  const runningTool = details.find((detail) => detail.kind === 'tool' && detail.status === 'running');
  const failedRetry = details.find((detail) => detail.kind === 'retry');
  const summaries: string[] = [];

  if (runningTool) {
    summaries.push(runningTool.label);
  }

  if (patches > 0) {
    summaries.push(labels?.patches(patches) ?? `Updated ${patches} patch${patches === 1 ? '' : 'es'}`);
  }

  if (files > 0) {
    summaries.push(labels?.files(files) ?? `${files} file${files === 1 ? '' : 's'}`);
  }

  if (failedRetry) {
    summaries.push(failedRetry.label);
  }

  return summaries;
}

/**
 * Match a reply to its user turn. Prefers the explicit parent link, then falls
 * back to the newest user message at or before it: v2 assistant messages carry
 * no `parentID`, and a paginated window can drop the parent record entirely.
 */
export function getUserTurnForMessage(records: SessionMessageRecord[], messageId: string) {
  const message = records.find((record) => record.info.id === messageId)?.info;
  if (!message) return undefined;
  if (message.role === 'user') return message.id;
  const parentId = message.parentID;
  const parent = records.find((record) => record.info.role === 'user' && record.info.id === parentId)?.info.id;
  if (parent) return parent;

  let owner: string | undefined;
  for (const record of records) {
    if (record.info.role === 'user') owner = record.info.id;
    if (record.info.id === messageId) return owner;
  }
  return undefined;
}

type PatchDetail = Extract<TranscriptDetail, { kind: 'patch' }>;

// Positional turn ownership: v2 assistant messages carry no `parentID`, so a
// reply belongs to the newest user message at or before it.
function getTurnOwnerIds(messages: SessionMessageRecord[]) {
  const owners = new Map<string, string>();
  let user: SessionMessageRecord | undefined;
  for (const record of messages) {
    if (record.info.role === 'user') user = record;
    if (user) owners.set(record.info.id, user.info.id);
  }
  return owners;
}

// V2 records changes on assistant snapshots; V1 carries user-turn summaries.
export function getDiffTurnMessages(messages: SessionMessageRecord[]) {
  const turns: SessionMessageRecord[] = [];
  let user: SessionMessageRecord | undefined;
  let included = false;
  for (const record of messages) {
    if (record.info.role === 'user') {
      user = record; included = Boolean(record.info.summary?.diffs.length);
      if (included) turns.push(record);
    } else if (user && !included && record.parts.some((part) => part.type === 'patch' && part.files.length)) {
      turns.push(user); included = true;
    }
  }
  return turns;
}

// The turn the Files-changed surface shows and fetches. Display and fetch both
// resolve here so they cannot drift: a still-valid pin wins, then the newest
// turn that recorded a change, then the newest user message for a turn that is
// still running before its first snapshot.
export function resolveDiffTurn(messages: SessionMessageRecord[], pinnedTurnId?: string) {
  const turns = getDiffTurnMessages(messages);
  if (pinnedTurnId && turns.some((turn) => turn.info.id === pinnedTurnId)) {
    return pinnedTurnId;
  }
  const latestTurn = turns[turns.length - 1]?.info.id;
  if (latestTurn) {
    return latestTurn;
  }
  return [...messages].reverse().find((record) => record.info.role === 'user')?.info.id;
}

// Filename-only patch details for one turn. The changes overlay renders these
// only when the structured turn diff is unavailable, and they must not
// aggregate patches from other turns.
export function getTurnPatchDetails(transcript: TranscriptEntry[], messages: SessionMessageRecord[], turnId?: string): PatchDetail[] {
  if (!turnId) {
    return transcript.flatMap((entry) => entry.details.filter((detail): detail is PatchDetail => detail.kind === 'patch'));
  }
  const owners = getTurnOwnerIds(messages);
  return transcript
    .filter((entry) => owners.get(entry.id) === turnId)
    .flatMap((entry) => entry.details.filter((detail): detail is PatchDetail => detail.kind === 'patch'));
}
