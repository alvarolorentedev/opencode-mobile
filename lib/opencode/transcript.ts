import type { SessionMessageRecord, TranscriptDetail, TranscriptEntry } from '@/lib/opencode/format';

// How much non-bubble activity the transcript renders. The order is the
// settings control order, from least to most detail.
export const TIMELINE_DETAIL_ORDER = ['messages', 'reasoning', 'everything'] as const;
export type TimelineDetail = (typeof TIMELINE_DETAIL_ORDER)[number];
export const DEFAULT_TIMELINE_DETAIL: TimelineDetail = 'everything';

// Details rendered as non-bubble activity rows. V1-only steps/subtasks/agent
// parts are still omitted.
export function isActivityDetail(detail: TranscriptDetail) {
  return detail.kind === 'tool' || detail.kind === 'reasoning' || detail.kind === 'patch';
}

// Files are attachments shown with their message; reasoning, tools, and
// patches render as activity rows.
export function isDetailVisible(detail: TranscriptDetail) {
  return detail.kind === 'reasoning' || detail.kind === 'tool' || detail.kind === 'patch';
}

// File-mutating tools are represented by the patch/review surface; their
// collapsible rows would duplicate it. They still feed the activity label.
const HIDDEN_TOOL_NAMES = new Set(['edit', 'write', 'multiedit', 'apply_patch']);
const SHELL_TOOL_NAMES = new Set(['bash', 'shell', 'sh', 'zsh', 'fish']);

export function isShellTool(tool: string) {
  return SHELL_TOOL_NAMES.has(tool);
}

export function isDetailShown(detail: TranscriptDetail) {
  if (detail.kind === 'tool' && HIDDEN_TOOL_NAMES.has(detail.tool)) {
    // File-mutating tools stay off the row list unless they resolved a diff;
    // a resolved diff is visible content and must keep the message displayable.
    return Boolean(detail.files?.length);
  }

  return isDetailVisible(detail);
}

// Bubble content for a message row. Patch-only assistant messages become
// activity rows; the changes chip above the composer remains the review entry.
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

export type TranscriptRow =
  | { key: string; type: 'message'; entry: TranscriptEntry }
  | { key: string; type: 'activity'; group: ActivityGroup };

// Rows rendered inside an activity run. Consecutive reads become one plain
// one-line list. Patch summaries are removed when a file-change tool in the
// same run already supplies the same files as diff cards.
export type ActivityChildRow =
  | { key: string; kind: 'read'; reads: ToolDetail[] }
  | { key: string; kind: 'item'; item: ActivityItem };

function normalizeActivityPath(file: string) {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function buildActivityChildRows(items: ActivityItem[]): ActivityChildRow[] {
  const diffFiles = new Set<string>();
  for (const item of items) {
    if (item.kind === 'tool' && item.files) {
      for (const file of item.files) diffFiles.add(normalizeActivityPath(file.file));
    }
  }

  const rows: ActivityChildRow[] = [];
  let reads: ToolDetail[] | undefined;
  const flushReads = () => {
    if (!reads) return;
    rows.push({ key: `read:${reads[0].id}`, kind: 'read', reads });
    reads = undefined;
  };

  for (const item of items) {
    if (item.kind === 'tool' && item.tool === 'read') {
      reads ??= [];
      reads.push(item);
      continue;
    }

    flushReads();
    if (item.kind === 'patch') {
      const files = item.body
        .split('\n')
        .map((file) => file.trim())
        .filter((file) => file && !diffFiles.has(normalizeActivityPath(file)));
      if (files.length > 0) {
        rows.push({ key: item.id, kind: 'item', item: { ...item, body: files.join('\n') } });
      }
      continue;
    }

    rows.push({ key: item.id, kind: 'item', item });
  }

  flushReads();
  return rows;
}

// Flatten the transcript into message rows and contiguous activity groups. A
// message bubble breaks contiguity. The selected detail level filters activity
// only: `messages` hides all activity, `reasoning` keeps reasoning rows, and
// `everything` uses the full timeline. At full detail, every visible
// reasoning/tool/patch detail joins the same run, in wire order, until a bubble
// appears. Hidden file tools are counted in the header so the summary matches
// the web app, but they only become rows when they resolved a diff. The group
// key is its first seen detail id, so the row identity (and its expanded state)
// survives as streamed details accumulate.
export function buildTranscriptRows(entries: TranscriptEntry[], timelineDetail: TimelineDetail = DEFAULT_TIMELINE_DETAIL): TranscriptRow[] {
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

    if (timelineDetail === 'messages') continue;

    if (timelineDetail === 'reasoning') {
      for (const detail of entry.details) {
        if (detail.kind !== 'reasoning') continue;
        ensureGroup(detail.id).items.push(detail);
      }
      continue;
    }

    for (const detail of entry.details) {
      if (detail.kind === 'tool' && HIDDEN_TOOL_NAMES.has(detail.tool)) {
        const group = ensureGroup(detail.id);
        trackTool(group, detail);
        // File-mutating tools normally stay off the row list, but a resolved
        // diff is exactly the content the timeline needs to show.
        if (detail.files?.length) group.items.push(detail);
        continue;
      }

      if (!isActivityDetail(detail) || !isDetailShown(detail)) continue;
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

export function isTranscriptDisplayMessage(entry: TranscriptEntry) {
  if (entry.role === 'user') {
    return true;
  }

  if (entry.text.trim() || entry.error || entry.details.some((detail) => detail.kind === 'file')) {
    return true;
  }

  // Tool-only, reasoning-only, and patch-only turns render as activity rows.
  return entry.details.some((detail) => isDetailShown(detail));
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
