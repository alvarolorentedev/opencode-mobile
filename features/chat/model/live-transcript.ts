import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import type { MessageError } from '@/shared/protocol/opencode/message-types';
import type { Part, ToolPart } from '@/shared/protocol/opencode/types';
import { extractErrorMessage, numberField, stringField } from '@/shared/protocol/opencode/v2/fields';
import { toFileDetail } from '@/shared/protocol/opencode/v2/mappers';

// V2 stream events own the open transcript. The reducer keeps the parts the
// server streams (text, reasoning, tools, steps) so a turn paints without
// re-reading its page; the turn-end reconcile replaces it with the canonical
// message.
type LiveTool = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  raw: string;
  status: 'running' | 'completed' | 'error';
  content?: unknown[];
  metadata?: Record<string, unknown>;
  error?: string;
};

export type LiveTranscriptMessage = {
  sessionID: string;
  messageID: string;
  created: number;
  model?: { providerID: string; id: string; variant?: string };
  text: { ordinal: number; text: string }[];
  reasoning: { ordinal: number; text: string }[];
  tools: LiveTool[];
  order: { kind: 'text' | 'reasoning' | 'tool'; key: string }[];
  cost: number;
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  snapshotFiles: string[];
  finish?: string;
  error?: MessageError;
  retry?: { attempt: number; message: string };
};

export type LiveEventResult =
  | { kind: 'update'; message: LiveTranscriptMessage; ledger?: boolean }
  | { kind: 'consumed' }
  | { kind: 'unsupported' };

export type LiveTranscriptBuffer = {
  partition?: string;
  messages: Map<string, Map<string, LiveTranscriptMessage>>;
  reconcileOnPage: Map<string, Set<string>>;
  localUsers: Map<string, SessionMessageRecord[]>;
  localSends: Map<string, number>;
};

export function getLiveTranscriptBuffer(scopes: Map<string, LiveTranscriptBuffer>, scopeKey: string): LiveTranscriptBuffer {
  const existing = scopes.get(scopeKey);
  if (existing) return existing;
  const buffer: LiveTranscriptBuffer = { messages: new Map(), reconcileOnPage: new Map(), localUsers: new Map(), localSends: new Map() };
  scopes.set(scopeKey, buffer);
  return buffer;
}

function eventData(event: OpencodeEvent): Record<string, unknown> | undefined {
  if (event.type === 'compatibility' || !('data' in event)) return undefined;
  return event.data as Record<string, unknown>;
}

function ensure(previous: LiveTranscriptMessage | undefined, sessionID: string, messageID: string, created: number): LiveTranscriptMessage {
  return previous ?? { sessionID, messageID, created, text: [], reasoning: [], tools: [], order: [], cost: 0, snapshotFiles: [] };
}

function addOrder(message: LiveTranscriptMessage, kind: 'text' | 'reasoning' | 'tool', key: string) {
  if (message.order.some((item) => item.kind === kind && item.key === key)) return;
  message.order.push({ kind, key });
}

function addTokens(current: LiveTranscriptMessage['tokens'], value: unknown) {
  const tokens = value as Record<string, unknown> | undefined;
  if (!tokens) return current;
  const cache = (tokens.cache ?? {}) as Record<string, unknown>;
  const next = current ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
  return {
    input: next.input + numberField(tokens.input),
    output: next.output + numberField(tokens.output),
    reasoning: next.reasoning + numberField(tokens.reasoning),
    cache: { read: next.cache.read + numberField(cache.read), write: next.cache.write + numberField(cache.write) },
  };
}

function addFiles(current: string[], value: unknown) {
  if (!Array.isArray(value)) return current;
  const next = [...current];
  for (const item of value) if (typeof item === 'string' && !next.includes(item)) next.push(item);
  return next;
}

function errorDetail(value: unknown, type: unknown): MessageError {
  return { name: stringField(type, 'SessionError'), data: { message: extractErrorMessage(value) } };
}

function updateText(message: LiveTranscriptMessage, ordinal: number, update: (text: string) => string) {
  const entry = message.text.find((item) => item.ordinal === ordinal);
  if (entry) entry.text = update(entry.text);
  else {
    message.text.push({ ordinal, text: update('') });
    addOrder(message, 'text', String(ordinal));
  }
}

function updateReasoning(message: LiveTranscriptMessage, ordinal: number, update: (text: string) => string) {
  const entry = message.reasoning.find((item) => item.ordinal === ordinal);
  if (entry) entry.text = update(entry.text);
  else {
    message.reasoning.push({ ordinal, text: update('') });
    addOrder(message, 'reasoning', String(ordinal));
  }
}

function tool(message: LiveTranscriptMessage, id: string): LiveTool {
  let entry = message.tools.find((item) => item.id === id);
  if (!entry) {
    entry = { id, name: 'tool', input: {}, raw: '', status: 'running' };
    message.tools.push(entry);
    addOrder(message, 'tool', id);
  }
  return entry;
}

function parseInput(raw: string): Record<string, unknown> | undefined {
  if (!raw.trim()) return undefined;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

// Returns undefined when the event cannot be placed without a message id.
export function reduceLiveEvent(previous: LiveTranscriptMessage | undefined, event: OpencodeEvent): LiveEventResult {
  const data = eventData(event);
  const sessionID = stringField(data?.sessionID);
  if (!data || !sessionID) return { kind: 'unsupported' };
  const type = event.type;

  if (type === 'session.usage.updated') return { kind: 'consumed' };

  const messageID = stringField(data.assistantMessageID);
  if (!messageID) return { kind: 'unsupported' };
  const created = numberField((event as { created?: number }).created, Date.now());
  const message = ensure(previous, sessionID, messageID, created);
  const ordinal = numberField(data.ordinal);

  switch (type) {
    case 'session.step.started': {
      const model = data.model as Record<string, unknown> | undefined;
      message.model = {
        providerID: stringField(model?.providerID),
        id: stringField(model?.id),
        ...(stringField(model?.variant) ? { variant: stringField(model?.variant) } : {}),
      };
      message.created = numberField(data.started, created);
      return { kind: 'update', message };
    }
    case 'session.step.ended':
    case 'session.step.failed': {
      message.cost += numberField(data.cost);
      message.tokens = addTokens(message.tokens, data.tokens);
      const finish = stringField(data.finish);
      if (finish) message.finish = finish;
      message.snapshotFiles = addFiles(message.snapshotFiles, data.files);
      if (type === 'session.step.failed') {
        const error = data.error as Record<string, unknown> | undefined;
        message.error = errorDetail(error, error?.type);
      }
      return { kind: 'update', message, ledger: true };
    }
    case 'session.text.started':
      updateText(message, ordinal, (text) => text);
      return { kind: 'update', message };
    case 'session.text.delta':
      updateText(message, ordinal, (text) => text + stringField(data.delta));
      return { kind: 'update', message };
    case 'session.text.ended':
      updateText(message, ordinal, () => stringField(data.text));
      return { kind: 'update', message };
    case 'session.reasoning.started':
      updateReasoning(message, ordinal, (text) => text);
      return { kind: 'update', message };
    case 'session.reasoning.delta':
      updateReasoning(message, ordinal, (text) => text + stringField(data.delta));
      return { kind: 'update', message };
    case 'session.reasoning.ended':
      updateReasoning(message, ordinal, () => stringField(data.text));
      return { kind: 'update', message };
    case 'session.tool.input.started': {
      const entry = tool(message, stringField(data.id));
      entry.name = stringField(data.name, entry.name);
      return { kind: 'update', message };
    }
    case 'session.tool.input.delta': {
      const entry = tool(message, stringField(data.id));
      entry.raw += stringField(data.delta);
      entry.input = parseInput(entry.raw) ?? entry.input;
      return { kind: 'update', message };
    }
    case 'session.tool.input.ended': {
      const entry = tool(message, stringField(data.id));
      entry.raw = stringField(data.text);
      entry.input = parseInput(entry.raw) ?? entry.input;
      return { kind: 'update', message };
    }
    case 'session.tool.called': {
      const entry = tool(message, stringField(data.id));
      const input = data.input;
      if (input && typeof input === 'object' && !Array.isArray(input)) entry.input = input as Record<string, unknown>;
      return { kind: 'update', message };
    }
    case 'session.tool.progress': {
      const entry = tool(message, stringField(data.id));
      const metadata = data.metadata;
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) entry.metadata = { ...entry.metadata, ...metadata as Record<string, unknown> };
      return { kind: 'update', message };
    }
    case 'session.tool.success': {
      const entry = tool(message, stringField(data.id));
      entry.status = 'completed';
      entry.content = Array.isArray(data.content) ? data.content : [];
      const metadata = data.metadata;
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) entry.metadata = metadata as Record<string, unknown>;
      return { kind: 'update', message, ledger: true };
    }
    case 'session.tool.failed': {
      const entry = tool(message, stringField(data.id));
      entry.status = 'error';
      entry.error = extractErrorMessage(data.error);
      if (Array.isArray(data.content)) entry.content = data.content;
      const metadata = data.metadata;
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) entry.metadata = metadata as Record<string, unknown>;
      return { kind: 'update', message, ledger: true };
    }
    case 'session.retry.scheduled': {
      const error = data.error as Record<string, unknown> | undefined;
      message.retry = { attempt: numberField(data.attempt), message: extractErrorMessage(error) };
      return { kind: 'update', message };
    }
    default:
      return { kind: 'unsupported' };
  }
}

function contentText(content: unknown[] | undefined) {
  return (content ?? []).map((item) => {
    if (!item || typeof item !== 'object') return '';
    const record = item as Record<string, unknown>;
    if (record.type === 'text') return stringField(record.text);
    if (record.type === 'file') return `[file] ${stringField(record.uri)}`;
    return '';
  }).filter(Boolean).join('\n');
}

function toolPart(message: LiveTranscriptMessage, entry: LiveTool): ToolPart {
  const base = {
    id: `${message.messageID}-tool-${entry.id}`,
    sessionID: message.sessionID,
    messageID: message.messageID,
    type: 'tool' as const,
    callID: entry.id,
    tool: entry.name,
    metadata: entry.metadata,
  };
  if (entry.status === 'completed') {
    return {
      ...base,
      state: {
        status: 'completed',
        input: entry.input,
        output: contentText(entry.content),
        title: entry.name,
        metadata: entry.metadata,
        attachments: (entry.content ?? []).filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'file')
          .map((file, index) => ({ ...toFileDetail(file), id: `${message.messageID}-tool-file-${index}`, sessionID: message.sessionID, messageID: message.messageID })),
      },
    };
  }
  if (entry.status === 'error') {
    return {
      ...base,
      state: { status: 'error', input: entry.input, error: entry.error || 'Tool failed', metadata: entry.metadata },
    };
  }
  return {
    ...base,
    state: { status: 'running', input: entry.input, title: entry.name, metadata: entry.metadata },
  };
}

export function liveTranscriptRecord(message: LiveTranscriptMessage): SessionMessageRecord {
  const parts: Part[] = message.order.map((item): Part => {
    if (item.kind === 'text') {
      const ordinal = Number(item.key);
      return {
        id: `${message.messageID}-text-${item.key}`,
        sessionID: message.sessionID,
        messageID: message.messageID,
        type: 'text',
        text: message.text.find((entry) => entry.ordinal === ordinal)?.text ?? '',
      };
    }
    if (item.kind === 'reasoning') {
      const ordinal = Number(item.key);
      return {
        id: `${message.messageID}-reasoning-${item.key}`,
        sessionID: message.sessionID,
        messageID: message.messageID,
        type: 'reasoning',
        text: message.reasoning.find((entry) => entry.ordinal === ordinal)?.text ?? '',
      };
    }
    return toolPart(message, message.tools.find((entry) => entry.id === item.key)!);
  });
  if (message.snapshotFiles.length) {
    parts.push({ id: `${message.messageID}-patch`, sessionID: message.sessionID, messageID: message.messageID, type: 'patch', files: message.snapshotFiles });
  }
  if (message.retry) {
    parts.push({
      id: `${message.messageID}-retry`,
      sessionID: message.sessionID,
      messageID: message.messageID,
      type: 'retry',
      attempt: message.retry.attempt,
      error: { name: 'SessionError', data: { message: message.retry.message } },
    });
  }
  if (message.tokens || message.cost > 0) {
    const tokens = message.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    parts.push({
      id: `${message.messageID}-step-finish`,
      sessionID: message.sessionID,
      messageID: message.messageID,
      type: 'step-finish',
      reason: message.finish ?? 'stop',
      ...(message.snapshotFiles.length ? { snapshot: message.snapshotFiles[message.snapshotFiles.length - 1] } : {}),
      cost: message.cost,
      tokens,
    });
  }
  return {
    info: {
      id: message.messageID,
      sessionID: message.sessionID,
      role: 'assistant',
      time: { created: message.created },
      providerID: message.model?.providerID ?? '',
      modelID: message.model?.id ?? '',
      ...(message.model?.variant ? { variant: message.model.variant } : {}),
      ...(message.error ? { error: message.error } : {}),
    },
    parts,
  };
}

// Re-applies live parts after a page read. A page that was already in flight
// when deltas arrived must not roll the open turn back.
export function overlayLiveRecords(records: SessionMessageRecord[], live: LiveTranscriptMessage[]): SessionMessageRecord[] {
  if (live.length === 0 || records.length === 0) return records;
  const remaining = new Map(live.map((message) => [message.messageID, message]));
  let changed = false;
  const next = records.map((record) => {
    const message = remaining.get(record.info.id);
    if (!message) return record;
    remaining.delete(record.info.id);
    changed = true;
    return liveTranscriptRecord(message);
  });
  const tail = next[next.length - 1];
  for (const message of remaining.values()) {
    if (!tail || message.created >= tail.info.time.created) {
      next.push(liveTranscriptRecord(message));
      changed = true;
    }
  }
  return changed ? next : records;
}

// Seeds the live accumulator from a record already painted before the stream
// started (an opened chat, or a page read that landed first) so later deltas
// extend it instead of replacing its parts.
export function seedLiveMessage(record: SessionMessageRecord): LiveTranscriptMessage {
  const message: LiveTranscriptMessage = {
    sessionID: record.info.sessionID,
    messageID: record.info.id,
    created: record.info.time.created,
    text: [],
    reasoning: [],
    tools: [],
    order: [],
    cost: 0,
    snapshotFiles: [],
    ...(record.info.role === 'assistant' && record.info.providerID
      ? { model: { providerID: record.info.providerID, id: record.info.modelID, ...(record.info.variant ? { variant: record.info.variant } : {}) } }
      : {}),
    ...(record.info.role === 'assistant' && record.info.error ? { error: record.info.error } : {}),
  };
  let ordinal = 0;
  for (const part of record.parts) {
    if (part.type === 'text') {
      message.text.push({ ordinal: ordinal++, text: part.text });
      addOrder(message, 'text', String(ordinal - 1));
      continue;
    }
    if (part.type === 'reasoning') {
      message.reasoning.push({ ordinal: ordinal++, text: part.text });
      addOrder(message, 'reasoning', String(ordinal - 1));
      continue;
    }
    if (part.type === 'tool') {
      ordinal += 1;
      const content: unknown[] = [];
      if (part.state.status === 'completed') {
        if (part.state.output) content.push({ type: 'text', text: part.state.output });
        for (const attachment of part.state.attachments ?? []) {
          content.push({ type: 'file', uri: attachment.url, mime: attachment.mime, name: attachment.filename });
        }
      }
      message.tools.push({
        id: part.callID,
        name: part.tool,
        input: part.state.input,
        raw: '',
        status: part.state.status === 'completed' ? 'completed' : part.state.status === 'error' ? 'error' : 'running',
        ...(content.length ? { content } : {}),
        ...('metadata' in part.state && part.state.metadata ? { metadata: part.state.metadata } : {}),
        ...(part.state.status === 'error' ? { error: part.state.error } : {}),
      });
      addOrder(message, 'tool', part.callID);
      continue;
    }
    if (part.type === 'patch') {
      message.snapshotFiles = addFiles(message.snapshotFiles, part.files);
      continue;
    }
    if (part.type === 'retry') {
      message.retry = { attempt: part.attempt, message: extractErrorMessage(part.error) };
      continue;
    }
    if (part.type === 'step-finish') {
      message.cost += part.cost;
      message.tokens = addTokens(message.tokens, part.tokens);
      message.finish = part.reason;
    }
  }
  return message;
}

export function userMessageRecord(input: {
  id: string;
  sessionID: string;
  text: string;
  createdAt: number;
  attachments: { url: string; mime?: string; filename?: string }[];
}): SessionMessageRecord {
  const parts: Part[] = [];
  if (input.text) {
    parts.push({ id: `${input.id}-text-0`, sessionID: input.sessionID, messageID: input.id, type: 'text', text: input.text });
  }
  input.attachments.forEach((attachment, index) => {
    parts.push({
      id: `${input.id}-file-${index}`,
      sessionID: input.sessionID,
      messageID: input.id,
      type: 'file',
      url: attachment.url,
      mime: attachment.mime || 'application/octet-stream',
      ...(attachment.filename ? { filename: attachment.filename } : {}),
    });
  });
  return { info: { id: input.id, sessionID: input.sessionID, role: 'user', time: { created: input.createdAt } }, parts };
}
