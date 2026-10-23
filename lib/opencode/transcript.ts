import type { SessionMessageRecord, TranscriptDetail, TranscriptEntry } from '@/lib/opencode/format';

// How much of the native timeline the transcript renders. `basic` is the
// default: user and assistant messages only. `reasoning` adds reasoning rows;
// `verbose` also adds tool calls and patches.
export type TranscriptVerbosity = 'basic' | 'reasoning' | 'verbose';

export const TRANSCRIPT_VERBOSITIES: readonly TranscriptVerbosity[] = ['basic', 'reasoning', 'verbose'];

// Details rendered as collapsible (non-bubble) rows outside the message card.
// Patches are activity items too, but they remain review chips in the bubble
// until verbose detail is selected. V1-only steps/subtasks/agent parts are not
// shown.
export function isCollapsibleDetail(detail: TranscriptDetail) {
  return detail.kind === 'tool' || detail.kind === 'reasoning';
}

export function isActivityDetail(detail: TranscriptDetail) {
  return detail.kind === 'tool' || detail.kind === 'reasoning' || detail.kind === 'patch';
}

// Verbose detail renders patches inside the activity run, so the aggregate
// bubble chip would duplicate the same change. Lower levels keep the chip.
export function shouldShowPatchSummary(verbosity: TranscriptVerbosity) {
  return verbosity !== 'verbose';
}

// Whether a detail is surfaced at the given verbosity. Files are attachments
// and are always shown with their message; patches are tool output.
export function isDetailVisible(detail: TranscriptDetail, verbosity: TranscriptVerbosity) {
  if (detail.kind === 'reasoning') return verbosity !== 'basic';
  if (detail.kind === 'tool' || detail.kind === 'patch') return verbosity === 'verbose';
  return false;
}

// File-mutating tools are represented by the patch/review surface; their
// collapsible rows would duplicate it. They still feed the activity label.
const HIDDEN_TOOL_NAMES = new Set(['edit', 'write', 'multiedit', 'apply_patch']);
const SHELL_TOOL_NAMES = new Set(['bash', 'shell', 'sh', 'zsh', 'fish']);

export function isShellTool(tool: string) {
  return SHELL_TOOL_NAMES.has(tool);
}

export function isDetailShown(detail: TranscriptDetail, verbosity: TranscriptVerbosity) {
  return isDetailVisible(detail, verbosity)
    && !(detail.kind === 'tool' && HIDDEN_TOOL_NAMES.has(detail.tool));
}

// Bubble content for a message row. Patch-only assistant messages become
// activity rows at verbose detail; text-bearing messages still keep their
// patch chips at the lower detail levels.
export function hasMessageBubble(entry: TranscriptEntry) {
  return entry.role === 'user'
    || Boolean(entry.text.trim() || entry.error)
    || entry.details.some((detail) => detail.kind === 'file');
}

export type ToolDetail = Extract<TranscriptDetail, { kind: 'tool' }>;
export type ReasoningDetail = Extract<TranscriptDetail, { kind: 'reasoning' }>;
export type PatchDetail = Extract<TranscriptDetail, { kind: 'patch' }>;
export type ActivityItem = ToolDetail | ReasoningDetail | PatchDetail;
export type ActivityTool = { name: string; count: number };
export type ActivityStatus = 'idle' | 'running' | 'error';

export type ActivityGroup = {
  key: string;
  kind: 'activity';
  items: ActivityItem[];
  tools: ActivityTool[];
  callCount: number;
  status: ActivityStatus;
};

// Kept as an alias for callers that still refer to a detail group by its old
// name. New code should use ActivityGroup.
export type DetailGroup = ActivityGroup;

export type TranscriptRow =
  | { key: string; type: 'message'; entry: TranscriptEntry }
  | { key: string; type: 'activity'; group: ActivityGroup };

// Flatten the transcript into message rows and contiguous activity groups. A
// message bubble breaks contiguity. Every visible reasoning/tool/patch detail
// joins the same run, in wire order, until a bubble appears. Hidden file tools
// are counted in the header at verbose detail so the summary matches the web
// app, but they never become duplicate child rows. The group key is its first
// seen detail id, so the row identity (and its expanded state) survives as
// streamed details accumulate.
export function buildTranscriptRows(entries: TranscriptEntry[], verbosity: TranscriptVerbosity): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let pending: ActivityGroup | undefined;

  const flush = () => {
    if (!pending) return;
    if (pending.items.length > 0) {
      rows.push({ key: `activity:${pending.key}`, type: 'activity', group: pending });
    }
    pending = undefined;
  };

  const ensureGroup = (id: string) => {
    pending ??= {
      key: id,
      kind: 'activity',
      items: [],
      tools: [],
      callCount: 0,
      status: 'idle',
    };
    return pending;
  };

  const trackTool = (group: ActivityGroup, detail: ToolDetail) => {
    group.callCount += 1;
    const existing = group.tools.find((tool) => tool.name === detail.tool);
    if (existing) {
      existing.count += 1;
    } else {
      group.tools.push({ name: detail.tool, count: 1 });
    }

    if (detail.status === 'error') {
      group.status = 'error';
    } else if ((detail.status === 'running' || detail.status === 'pending') && group.status !== 'error') {
      group.status = 'running';
    }
  };

  for (const entry of entries) {
    if (hasMessageBubble(entry)) {
      flush();
      rows.push({ key: `message:${entry.id}`, type: 'message', entry });
    }

    for (const detail of entry.details) {
      if (detail.kind === 'tool' && HIDDEN_TOOL_NAMES.has(detail.tool)) {
        if (verbosity !== 'verbose') continue;
        trackTool(ensureGroup(detail.id), detail);
        continue;
      }

      if (!isActivityDetail(detail) || !isDetailShown(detail, verbosity)) continue;
      const group = ensureGroup(detail.id);
      if (detail.kind === 'tool') trackTool(group, detail);
      group.items.push(detail);
    }
  }

  flush();
  return rows;
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

  return undefined;
}

export function isTranscriptDisplayMessage(entry: TranscriptEntry, verbosity: TranscriptVerbosity = 'basic') {
  if (entry.role === 'user') {
    return true;
  }

  if (entry.text.trim() || entry.error || entry.details.some((detail) => detail.kind === 'file')) {
    return true;
  }

  // A tool-only or reasoning-only turn is hidden at conversation verbosity but
  // surfaces as collapsible rows at higher levels. Patch-only turns are tool
  // output too.
  return entry.details.some((detail) => isDetailShown(detail, verbosity));
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
