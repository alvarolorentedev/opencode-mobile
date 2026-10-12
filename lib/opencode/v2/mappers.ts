import type { SessionMessageRecord } from '../format/types';
import type { Part, ToolPart } from '../types';
import type { PendingQuestionPrompt, PendingQuestionRequest } from '../client';
import { extractErrorMessage, numberField, stringField } from './fields';
import type { V2Context, V2Form, V2Message, V2Permission } from './shared';

export function toFileDetail(file: unknown) {
  const record = (file ?? {}) as Record<string, unknown>;
  const source = (record.source ?? {}) as Record<string, unknown>;
  const mime = stringField(record.mime, 'application/octet-stream');
  return {
    type: 'file' as const,
    mime,
    filename: stringField(record.name, 'Attachment'),
    url: typeof record.data === 'string'
      ? `data:${mime};base64,${record.data}`
      : stringField(record.uri, stringField(source.uri)),
  };
}

function toolContentToText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (item && typeof item === 'object' && 'type' in item) {
        const record = item as Record<string, unknown>;
        if (record.type === 'text') return stringField(record.text);
        if (record.type === 'file') return `[file] ${stringField(record.uri)}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function toToolDetail(messageId: string, sessionID: string, index: number, tool: Record<string, unknown>): ToolPart {
  const state = (tool.state ?? {}) as Record<string, unknown>;
  const status = stringField(state.status, 'running');
  const input = state.input && typeof state.input === 'object' ? state.input as Record<string, unknown> : {};
  const base = {
    id: `${messageId}-tool-${stringField(tool.id, String(index))}`,
    sessionID,
    messageID: messageId,
    type: 'tool' as const,
    callID: stringField(tool.id, String(index)),
    tool: stringField(tool.name, 'tool'),
    metadata: state.metadata as Record<string, unknown> | undefined,
  };

  if (status === 'completed') {
    return {
      ...base,
      state: {
        status: 'completed',
        input,
        output: toolContentToText(state.content),
        attachments: Array.isArray(state.content) ? state.content.filter((item) => item?.type === 'file').map((file, fileIndex) => ({ ...toFileDetail(file), id: `${messageId}-tool-file-${fileIndex}`, sessionID, messageID: messageId })) : [],
        title: stringField(tool.name, 'tool'),
        metadata: state.metadata as Record<string, unknown> | undefined,
      },
    };
  }

  if (status === 'error') {
    return {
      ...base,
      state: {
        status: 'error',
        input,
        error: extractErrorMessage(state.error),
        metadata: state.metadata as Record<string, unknown> | undefined,
      },
    };
  }

  return {
    ...base,
    state: {
      status: 'running',
      input,
      title: stringField(tool.name, 'tool'),
      metadata: state.metadata as Record<string, unknown> | undefined,
    },
  };
}

export function toMessageRecord(message: V2Message, sessionID: string): SessionMessageRecord | undefined {
  const type = stringField(message.type);
  const created = numberField((message.time as Record<string, unknown> | undefined)?.created);
  const baseInfo = { id: message.id, sessionID, time: { created } };

  if (type === 'user') {
    const parts: Part[] = [];
    const text = stringField((message as Record<string, unknown>).text);
    if (text) {
      parts.push({ id: `${message.id}-text-0`, sessionID, messageID: message.id, type: 'text', text });
    }
    const files = (message as Record<string, unknown>).files;
    if (Array.isArray(files)) {
      files.forEach((file, index) => {
        parts.push({
          id: `${message.id}-file-${index}`,
          sessionID,
          messageID: message.id,
          ...toFileDetail(file),
        });
      });
    }
    return { info: { ...baseInfo, role: 'user' }, parts };
  }

  if (type === 'assistant') {
    const content = Array.isArray((message as Record<string, unknown>).content) ? (message as Record<string, unknown>).content as unknown[] : [];
    const parts: Part[] = content.map((raw, index) => {
      const part = (raw ?? {}) as Record<string, unknown>;
      const partType = stringField(part.type);
      if (partType === 'text') {
        return { id: `${message.id}-text-${index}`, sessionID, messageID: message.id, type: 'text', text: stringField(part.text) };
      }
      if (partType === 'reasoning') {
        return { id: `${message.id}-reasoning-${index}`, sessionID, messageID: message.id, type: 'reasoning', text: stringField(part.text) };
      }
      return toToolDetail(message.id, sessionID, index, part);
    });

    const snapshot = (message as Record<string, unknown>).snapshot as { files?: string[] } | undefined;
    if (snapshot?.files?.length) parts.push({ id: `${message.id}-patch`, sessionID, messageID: message.id, type: 'patch', files: snapshot.files });
    const model = (message as Record<string, unknown>).model as Record<string, unknown> | undefined;
    const tokens = (message as Record<string, unknown>).tokens as Record<string, unknown> | undefined;
    const cost = numberField((message as Record<string, unknown>).cost);
    const finish = stringField((message as Record<string, unknown>).finish, 'stop');
    const error = (message as Record<string, unknown>).error as Record<string, unknown> | undefined;
    const retry = (message as Record<string, unknown>).retry as Record<string, unknown> | undefined;

    // V2 keeps the automatic-retry state on the assistant message rather than
    // as a part. Surface it as a `retry` part so the transcript shows the same
    // "Retry N" detail the TUI does while the server retries.
    if (retry) {
      parts.push({
        id: `${message.id}-retry`,
        sessionID,
        messageID: message.id,
        type: 'retry',
        attempt: numberField(retry.attempt),
        error: { name: 'SessionError', data: { message: extractErrorMessage(retry.error) } },
      });
    }

    if (tokens || typeof (message as Record<string, unknown>).cost === 'number') {
    parts.push({
      id: `${message.id}-step-finish`,
      sessionID,
      messageID: message.id,
      type: 'step-finish',
      reason: finish,
      cost,
      tokens: {
        input: numberField(tokens?.input),
        output: numberField(tokens?.output),
        reasoning: numberField(tokens?.reasoning),
        cache: {
          read: numberField((tokens?.cache as Record<string, unknown> | undefined)?.read),
          write: numberField((tokens?.cache as Record<string, unknown> | undefined)?.write),
        },
      },
    });
    }

    return {
      info: {
        ...baseInfo,
        role: 'assistant',
        providerID: stringField(model?.providerID),
        modelID: stringField(model?.id),
        error: error ? { name: stringField(error.name, 'SessionError'), data: { message: extractErrorMessage(error) } } : undefined,
      },
      parts,
    };
  }

  if (type.startsWith('compaction')) {
    return {
      info: { ...baseInfo, role: 'assistant', providerID: '', modelID: '' },
      parts: [{ id: `${message.id}-compaction`, sessionID, messageID: message.id, type: 'compaction', auto: stringField((message as Record<string, unknown>).reason) === 'auto' }],
    };
  }

  // Keep native timeline markers in the paginated window even when hidden by the UI.
  return { info: { ...baseInfo, role: 'assistant', providerID: '', modelID: '' }, parts: [] };
}

export function mapPermission(permission: V2Permission, ctx?: V2Context): import('../client').PendingPermissionRequest {
  ctx?.permissionSession.set(permission.id, permission.sessionID);
  const source = permission.source as Record<string, unknown> | undefined;
  return {
    id: permission.id,
    sessionID: permission.sessionID,
    permission: permission.action,
    patterns: permission.resources,
    metadata: permission.metadata ?? {},
    always: permission.save ?? [],
    tool: source && source.type === 'tool' ? { messageID: stringField(source.messageID), callID: stringField(source.id, permission.id) } : undefined,
  };
}

export function mapSavedPermission(permission: {
  id: string;
  action: string;
  resource: string;
  time?: { created?: number };
}): { id: string; action: string; resource: string; createdAt?: number } {
  return {
    id: stringField(permission.id),
    action: stringField(permission.action),
    resource: stringField(permission.resource),
    ...(typeof permission.time?.created === 'number' ? { createdAt: permission.time.created } : {}),
  };
}

export function formToQuestion(form: V2Form, ctx?: V2Context): PendingQuestionRequest {
  ctx?.formSession.set(form.id, form);
  const fields = Array.isArray(form.fields) ? form.fields : [];
  return {
    id: form.id,
    sessionID: form.sessionID,
    title: stringField(form.title) || undefined,
    questions: fields.map((field) => {
      const record = field as Record<string, unknown>;
      const options = Array.isArray(record.options) ? record.options : [];
      const type = stringField(record.type) as PendingQuestionPrompt['type'];
      const when = Array.isArray(record.when)
        ? record.when.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') {
              return [];
            }
            const condition = entry as Record<string, unknown>;
            const key = stringField(condition.key);
            if (!key) {
              return [];
            }
            const value = condition.value;
            return [{
              key,
              op: condition.op === 'neq' ? 'neq' as const : 'eq' as const,
              value: typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : '',
            }];
          })
        : undefined;
      const defaultValue = record.default;
      return {
        header: stringField(record.title, stringField(record.key)),
        question: stringField(record.description) || stringField(record.title) || stringField(record.key),
        key: stringField(record.key) || undefined,
        options: options.map((option) => {
          const item = (option ?? {}) as Record<string, unknown>;
          const label = stringField(item.label);
          return {
            label,
            description: stringField(item.description) || undefined,
            value: stringField(item.value) || label,
          };
        }),
        multiple: type === 'multiselect',
        custom: record.custom === true || options.length === 0,
        type,
        required: record.required === true,
        placeholder: stringField(record.placeholder) || undefined,
        defaultValue: typeof defaultValue === 'string' || typeof defaultValue === 'number' || typeof defaultValue === 'boolean'
          ? defaultValue
          : undefined,
        url: stringField(record.url) || undefined,
        when,
      };
    }),
  };
}

function resolveOptionValue(record: Record<string, unknown>, raw: string): string {
  const options = Array.isArray(record.options) ? record.options : [];
  const match = options.find((option) => {
    const item = (option ?? {}) as Record<string, unknown>;
    return stringField(item.label) === raw || stringField(item.value) === raw;
  });
  if (!match) {
    return raw;
  }
  const item = match as Record<string, unknown>;
  return stringField(item.value) || stringField(item.label) || raw;
}

export function toAnswer(form: V2Form, answers: unknown): Record<string, string | number | boolean | string[]> {
  const fields = Array.isArray(form.fields) ? form.fields : [];
  const list = Array.isArray(answers) ? answers : [];
  const answer: Record<string, string | number | boolean | string[]> = {};
  fields.forEach((field, index) => {
    const record = field as Record<string, unknown>;
    const key = stringField(record.key, String(index));
    const value = list[index];
    const type = stringField(record.type);

    if (type === 'multiselect') {
      const selected = Array.isArray(value) ? value.map((item) => String(item)) : value === undefined || value === null ? [] : [String(value)];
      answer[key] = selected.map((item) => resolveOptionValue(record, item));
      return;
    }

    const raw = Array.isArray(value)
      ? value.length > 0 ? String(value[0]) : ''
      : value === undefined || value === null ? '' : String(value);
    const resolved = resolveOptionValue(record, raw);

    if (type === 'number' || type === 'integer') {
      const numeric = Number(resolved);
      answer[key] = resolved !== '' && Number.isFinite(numeric) ? numeric : resolved;
      return;
    }

    if (type === 'boolean') {
      answer[key] = resolved === 'true' || resolved === '1' || resolved === 'yes' || resolved === 'on';
      return;
    }

    answer[key] = resolved;
  });
  return answer;
}
