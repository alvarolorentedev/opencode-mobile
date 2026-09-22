import { OpenCode } from '@opencode/client';

import {
  createPrefixFetch,
  getRequestHeaders,
  getServerBase,
  type OpencodeConnectionSettings,
  type ScopedOpencodeClient,
} from './client';

type V2Api = ReturnType<typeof OpenCode.make>;

type V2Session = Awaited<ReturnType<V2Api['session']['list']>>['data'][number];
type V2Message = Awaited<ReturnType<V2Api['message']['list']>>['data'][number];
type V2Project = Awaited<ReturnType<V2Api['project']['list']>>[number];
type V2Diff = Awaited<ReturnType<V2Api['session']['diff']>>[number];
type V2Permission = Awaited<ReturnType<V2Api['permission']['request']['list']>>['data'][number];
type V2Form = Awaited<ReturnType<V2Api['form']['list']>>['data'][number];
type V2Provider = Awaited<ReturnType<V2Api['provider']['list']>>['data'][number];
type V2Model = Awaited<ReturnType<V2Api['model']['list']>>['data'][number];
type V2Agent = Awaited<ReturnType<V2Api['agent']['list']>>['data'][number];
type V2Integration = Awaited<ReturnType<V2Api['integration']['list']>>['data'][number];
type V2Shell = Awaited<ReturnType<V2Api['config']['shells']>>[number];

type RawResult = { data?: unknown };

type V2EventEnvelope = {
  id: string;
  type: string;
  location?: { directory?: string };
  data?: Record<string, unknown>;
};

type V1Envelope = {
  directory: string;
  payload: { id: string; type: string; properties: Record<string, unknown> };
};

type AdapterContext = {
  api: V2Api;
  directory?: string;
  permissionSession: Map<string, string>;
  formSession: Map<string, V2Form>;
};

const INPUT_MODALITIES = ['text', 'audio', 'image', 'video', 'pdf'] as const;

function stringField(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberField(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record._tag === 'string') return record._tag;
  }
  return 'OpenCode request failed.';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(extractErrorMessage(error));
}

// V2 routes are absolute (/api/...), so baseUrl path segments are replaced. A reverse
// proxy prefix is preserved by rewriting the outgoing request instead.
function resolveV2Base(settings: OpencodeConnectionSettings) {
  const base = getServerBase(settings.serverUrl);
  const pathPrefix = base.pathPrefix.replace(/\/api$/, '');
  return { base, pathPrefix };
}

function projectToV1(project: V2Project): Record<string, unknown> {
  return {
    id: project.id,
    worktree: project.canonical,
    vcs: project.vcs,
    time: { created: project.time.created, initialized: project.time.updated },
  };
}

function sessionToV1(session: V2Session): Record<string, unknown> {
  return {
    id: session.id,
    title: session.title ?? '',
    time: { created: session.time.created, updated: session.time.updated },
    parentID: session.parentID,
    revert: session.revert,
    share: undefined,
  };
}

function modelToV1(model: V2Model): Record<string, unknown> {
  const cost = model.cost?.[0];
  return {
    id: model.modelID,
    name: model.name,
    providerID: model.providerID,
    capabilities: {
      reasoning: false,
      attachment: model.capabilities.input.some((modality) => modality !== 'text'),
      input: Object.fromEntries(INPUT_MODALITIES.map((modality) => [modality, model.capabilities.input.includes(modality)])),
      toolcall: model.capabilities.tools,
    },
    limit: { context: model.limit.context, output: model.limit.output },
    cost: {
      input: cost?.input ?? 0,
      output: cost?.output ?? 0,
      cache: { read: cost?.cache?.read ?? 0, write: cost?.cache?.write ?? 0 },
    },
    status: model.status,
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

function toolPartFromV2(messageId: string, sessionID: string, index: number, tool: Record<string, unknown>): Record<string, unknown> {
  const state = (tool.state ?? {}) as Record<string, unknown>;
  const status = stringField(state.status, 'running');
  const input = state.input;
  const base = {
    id: `${messageId}-tool-${stringField(tool.id, String(index))}`,
    sessionID,
    messageID: messageId,
    type: 'tool',
    callID: stringField(tool.id, String(index)),
    tool: stringField(tool.name, 'tool'),
    metadata: state.metadata,
  };

  if (status === 'completed') {
    return {
      ...base,
      state: {
        status: 'completed',
        input,
        output: toolContentToText(state.content),
        title: stringField(tool.name, 'tool'),
        metadata: state.metadata,
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
        metadata: state.metadata,
      },
    };
  }

  return {
    ...base,
    state: {
      status: 'running',
      input,
      title: stringField(tool.name, 'tool'),
      metadata: state.metadata,
    },
  };
}

function messageToV1(message: V2Message, sessionID: string): { info: Record<string, unknown>; parts: Record<string, unknown>[] } | undefined {
  const type = stringField(message.type);
  const created = numberField((message.time as Record<string, unknown> | undefined)?.created);
  const baseInfo = { id: message.id, sessionID, time: { created } };

  if (type === 'user') {
    const parts: Record<string, unknown>[] = [];
    const text = stringField((message as Record<string, unknown>).text);
    if (text) {
      parts.push({ id: `${message.id}-text-0`, sessionID, messageID: message.id, type: 'text', text });
    }
    const files = (message as Record<string, unknown>).files;
    if (Array.isArray(files)) {
      files.forEach((file, index) => {
        const record = (file ?? {}) as Record<string, unknown>;
        const source = (record.source ?? {}) as Record<string, unknown>;
        const inline = source.type === 'inline';
        parts.push({
          id: `${message.id}-file-${index}`,
          sessionID,
          messageID: message.id,
          type: 'file',
          mime: stringField(record.mime),
          filename: stringField(record.name, 'Attachment'),
          url: inline ? `data:${stringField(record.mime)};base64,${stringField(record.data)}` : stringField(source.uri),
        });
      });
    }
    return { info: { ...baseInfo, role: 'user' }, parts };
  }

  if (type === 'assistant') {
    const content = Array.isArray((message as Record<string, unknown>).content) ? (message as Record<string, unknown>).content as unknown[] : [];
    const parts: Record<string, unknown>[] = content.map((raw, index) => {
      const part = (raw ?? {}) as Record<string, unknown>;
      const partType = stringField(part.type);
      if (partType === 'text') {
        return { id: `${message.id}-text-${index}`, sessionID, messageID: message.id, type: 'text', text: stringField(part.text) };
      }
      if (partType === 'reasoning') {
        return { id: `${message.id}-reasoning-${index}`, sessionID, messageID: message.id, type: 'reasoning', text: stringField(part.text) };
      }
      return toolPartFromV2(message.id, sessionID, index, part);
    });

    const model = (message as Record<string, unknown>).model as Record<string, unknown> | undefined;
    const tokens = (message as Record<string, unknown>).tokens as Record<string, unknown> | undefined;
    const cost = numberField((message as Record<string, unknown>).cost);
    const finish = stringField((message as Record<string, unknown>).finish, 'stop');
    const error = (message as Record<string, unknown>).error as Record<string, unknown> | undefined;

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
      info: { ...baseInfo, role: 'assistant' },
      parts: [{ id: `${message.id}-compaction`, sessionID, messageID: message.id, type: 'compaction', auto: stringField((message as Record<string, unknown>).reason) === 'auto' }],
    };
  }

  return undefined;
}

function mapStatus(status: unknown): Record<string, unknown> {
  const type = stringField((status as Record<string, unknown> | undefined)?.type, 'busy');
  if (type === 'idle') return { type: 'idle' };
  if (type === 'retry') {
    const record = status as Record<string, unknown>;
    return { type: 'retry', attempt: numberField(record.attempt), message: stringField(record.message), next: numberField(record.next) };
  }
  return { type: 'busy' };
}

function mapPermission(permission: V2Permission, ctx: AdapterContext): Record<string, unknown> {
  ctx.permissionSession.set(permission.id, permission.sessionID);
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

function formToQuestion(form: V2Form, ctx: AdapterContext): Record<string, unknown> {
  ctx.formSession.set(form.id, form);
  const fields = Array.isArray(form.fields) ? form.fields : [];
  return {
    id: form.id,
    sessionID: form.sessionID,
    questions: fields.map((field) => {
      const record = field as Record<string, unknown>;
      const options = Array.isArray(record.options) ? record.options : [];
      return {
        header: stringField(record.title, stringField(record.key)),
        question: stringField(record.description) || stringField(record.title) || stringField(record.key),
        options: options.map((option) => {
          const item = (option ?? {}) as Record<string, unknown>;
          return { label: stringField(item.label), description: stringField(item.description) };
        }),
        multiple: record.type === 'multiselect',
        custom: record.custom === true || options.length === 0,
      };
    }),
  };
}

function toAnswer(form: V2Form, answers: unknown): Record<string, string | number | boolean | string[]> {
  const fields = Array.isArray(form.fields) ? form.fields : [];
  const list = Array.isArray(answers) ? answers : [];
  const answer: Record<string, string | number | boolean | string[]> = {};
  fields.forEach((field, index) => {
    const record = field as Record<string, unknown>;
    const key = stringField(record.key, String(index));
    const value = list[index];
    if (record.type === 'multiselect') {
      answer[key] = Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : String(item))) : [String(value ?? '')];
    } else if (Array.isArray(value)) {
      answer[key] = value.length > 0 ? String(value[0]) : '';
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      answer[key] = value;
    } else {
      answer[key] = value === undefined ? '' : String(value);
    }
  });
  return answer;
}

function mapV2Event(event: V2EventEnvelope, ctx: AdapterContext): V1Envelope | undefined {
  const data = event.data ?? {};
  const sessionID = typeof data.sessionID === 'string' ? data.sessionID : undefined;
  const directory = event.location?.directory ?? '';
  const envelope = (type: string, properties: Record<string, unknown>): V1Envelope => ({
    directory,
    payload: { id: event.id, type, properties },
  });

  switch (event.type) {
    case 'server.connected':
      return envelope('catalog.updated', {});
    case 'session.created':
      return envelope('session.created', { sessionID });
    case 'session.renamed':
    case 'session.moved':
    case 'session.forked':
    case 'session.permissions':
    case 'session.viewed':
    case 'session.agent.selected':
    case 'session.model.selected':
      return envelope('session.updated', { sessionID });
    case 'session.deleted':
      return envelope('session.deleted', { sessionID });
    case 'session.status':
      return envelope('session.status', { sessionID, status: mapStatus(data.status) });
    case 'session.idle':
      return envelope('session.idle', { sessionID });
    case 'session.execution.started':
      return envelope('session.status', { sessionID, status: { type: 'busy' } });
    case 'session.execution.succeeded':
    case 'session.execution.interrupted':
      return envelope('session.idle', { sessionID });
    case 'session.execution.failed':
      return envelope('session.idle', { sessionID });
    case 'session.retry.scheduled':
      return envelope('session.status', {
        sessionID,
        status: { type: 'retry', attempt: numberField(data.attempt), message: extractErrorMessage(data.error), next: numberField(data.at) },
      });
    case 'session.compaction.started':
    case 'session.compaction.ended':
    case 'session.compaction.failed':
      return envelope('session.compacted', { sessionID });
    case 'session.step.started':
    case 'session.step.streamed':
    case 'session.step.ended':
    case 'session.step.failed':
    case 'session.text.started':
    case 'session.text.delta':
    case 'session.text.ended':
    case 'session.reasoning.started':
    case 'session.reasoning.delta':
    case 'session.reasoning.ended':
    case 'session.tool.input.started':
    case 'session.tool.input.delta':
    case 'session.tool.input.ended':
    case 'session.tool.called':
    case 'session.tool.progress':
    case 'session.tool.success':
    case 'session.tool.failed':
    case 'session.message.content.updated':
    case 'session.synthetic':
    case 'session.skill.activated':
      return envelope('message.part.updated', { sessionID });
    case 'permission.asked':
      if (typeof data.id === 'string') ctx.permissionSession.set(data.id, stringField(sessionID));
      return envelope('permission.asked', {
        id: data.id,
        sessionID,
        permission: data.action,
        patterns: data.resources,
        metadata: data.metadata ?? {},
        always: data.save ?? [],
      });
    case 'permission.replied':
      return envelope('permission.replied', { sessionID, requestID: data.requestID, reply: data.reply });
    case 'form.created': {
      const form = data.form as V2Form | undefined;
      if (!form || typeof form.id !== 'string') return undefined;
      return envelope('question.asked', formToQuestion(form, ctx));
    }
    case 'form.replied': {
      const id = typeof data.id === 'string' ? data.id : '';
      return envelope('question.replied', { sessionID, requestID: id });
    }
    case 'form.cancelled': {
      const id = typeof data.id === 'string' ? data.id : '';
      return envelope('question.rejected', { sessionID, requestID: id });
    }
    case 'filesystem.changed':
      return envelope('file.edited', {});
    case 'vcs.branch.updated':
      return envelope('vcs.branch.updated', {});
    case 'pty.created':
    case 'pty.updated':
    case 'pty.exited':
    case 'pty.deleted':
      return envelope(event.type, {});
    case 'worktree.updated':
    case 'worktree.resolved':
      return envelope('worktree.ready', {});
    case 'mcp.status.changed':
    case 'mcp.resources.changed':
      return envelope('mcp.tools.changed', {});
    case 'config.updated':
    case 'provider.updated':
    case 'model.updated':
    case 'agent.updated':
    case 'skill.updated':
    case 'command.updated':
    case 'integration.updated':
    case 'credential.updated':
    case 'models-dev.refreshed':
    case 'reference.updated':
    case 'plugin.updated':
      return envelope('catalog.updated', {});
    case 'project.updated':
      return envelope('project.updated', {});
    default:
      return undefined;
  }
}

async function* subscribeV2(api: V2Api, signal?: AbortSignal, ctx?: AdapterContext): AsyncGenerator<V1Envelope> {
  const context = ctx as AdapterContext;
  const subscription = await api.event.subscribe(signal ? { signal } : undefined);
  for await (const raw of subscription) {
    const mapped = mapV2Event(raw as V2EventEnvelope, context);
    if (mapped) {
      yield mapped;
    }
  }
}

async function fetchAllMessages(api: V2Api, sessionID: string): Promise<V2Message[]> {
  const messages: V2Message[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const response = await api.message.list({ sessionID, limit: 200, ...(cursor ? { cursor } : {}) });
    const page = response.data ?? [];
    messages.push(...page);
    const next = response.cursor?.next ?? undefined;
    if (!next || next === cursor || page.length === 0) break;
    cursor = next;
  }
  return messages;
}

function buildV2Raw(settings: OpencodeConnectionSettings): { client: Record<string, unknown>; ctx: AdapterContext } {
  const { base, pathPrefix } = resolveV2Base(settings);
  const headers = getRequestHeaders(settings);
  const directory = settings.directory.trim() || undefined;
  const api = OpenCode.make({
    baseUrl: base.origin,
    headers,
    fetch: createPrefixFetch(base.origin, pathPrefix),
  });

  const ctx: AdapterContext = {
    api,
    directory,
    permissionSession: new Map(),
    formSession: new Map(),
  };

  let cachedProjectID: string | undefined;
  const getProjectID = async () => {
    if (!cachedProjectID) {
      const location = await api.location.get();
      cachedProjectID = location.project.id;
    }
    return cachedProjectID;
  };

  const ok = (data: unknown): RawResult => ({ data });

  const client: Record<string, unknown> = {
    __opencode: { directory },
    path: {
      get: async () => ok(await api.location.get()),
    },
    project: {
      list: async () => ok((await api.project.list()).map(projectToV1)),
      current: async () => {
        const location = await api.location.get();
        return ok({ id: location.project.id, worktree: location.project.directory, time: { created: 0, initialized: 0 } });
      },
    },
    session: {
      list: async () => {
        const response = await api.session.list(directory ? { directory } : {});
        return ok((response.data ?? []).map(sessionToV1));
      },
      status: async () => {
        const [active, list] = await Promise.all([
          api.session.active().catch(() => ({}) as Record<string, unknown>),
          api.session.list(directory ? { directory } : {}),
        ]);
        const statuses: Record<string, unknown> = {};
        (list.data ?? []).forEach((session) => {
          statuses[session.id] = { type: 'idle' };
        });
        Object.keys(active ?? {}).forEach((id) => {
          statuses[id] = { type: 'busy' };
        });
        return ok(statuses);
      },
      messages: async (parameters?: { before?: string }) => {
        // V2 uses opaque cursors; callers only need the full history.
        if (parameters?.before) return ok([]);
        const sessionID = stringField((parameters as Record<string, unknown> | undefined)?.sessionID);
        const messages = await fetchAllMessages(api, sessionID);
        return ok(messages.map((message) => messageToV1(message, sessionID)).filter(Boolean));
      },
      diff: async (parameters: { sessionID: string }) => {
        const diffs: V2Diff[] = await api.session.diff({ sessionID: parameters.sessionID });
        return ok(diffs);
      },
      todo: async () => ok([]),
      delete: async (parameters: { sessionID: string }) => {
        await api.session.remove({ sessionID: parameters.sessionID });
        return ok(undefined);
      },
      update: async (parameters: { sessionID: string; title?: string; permission?: unknown }) => {
        if (parameters.title !== undefined || parameters.permission !== undefined) {
          await api.session.update({
            sessionID: parameters.sessionID,
            ...(parameters.title !== undefined ? { title: parameters.title } : {}),
            ...(parameters.permission !== undefined ? { permissions: parameters.permission as never } : {}),
          });
        }
        const session = await api.session.get({ sessionID: parameters.sessionID });
        return ok(sessionToV1(session));
      },
      children: async (parameters: { sessionID: string }) => {
        const response = await api.session.list({ parentID: parameters.sessionID });
        return ok((response.data ?? []).map(sessionToV1));
      },
      fork: async (parameters: { sessionID: string; messageID?: string }) => {
        const session = await api.session.fork({ sessionID: parameters.sessionID, ...(parameters.messageID ? { before: parameters.messageID } : {}) });
        return ok(sessionToV1(session));
      },
      share: async () => {
        throw new Error('Sharing sessions is not supported by OpenCode 2 servers.');
      },
      unshare: async () => {
        throw new Error('Sharing sessions is not supported by OpenCode 2 servers.');
      },
      revert: async (parameters: { sessionID: string; messageID: string; partID?: string }) => {
        const revert = await api.session.revert.stage({ sessionID: parameters.sessionID, messageID: parameters.messageID, ...(parameters.partID ? { partID: parameters.partID } : {}) });
        return ok(revert);
      },
      unrevert: async (parameters: { sessionID: string }) => {
        await api.session.revert.clear({ sessionID: parameters.sessionID });
        return ok(undefined);
      },
      create: async (parameters?: { title?: string; directory?: string }) => {
        const target = parameters?.directory || directory;
        const session = await api.session.create({
          ...(parameters?.title ? { title: parameters.title } : {}),
          ...(target ? { location: { directory: target } } : {}),
        });
        return ok(sessionToV1(session));
      },
      summarize: async () => {
        throw new Error('Session title summarization is not supported by OpenCode 2 servers.');
      },
      promptAsync: async (parameters: Record<string, unknown>) => {
        const sessionID = stringField(parameters.sessionID);
        const agent = typeof parameters.agent === 'string' ? parameters.agent : undefined;
        const model = parameters.model as { providerID?: string; modelID?: string } | undefined;
        if (agent) await api.session.switchAgent({ sessionID, agent });
        if (model?.providerID && model.modelID) {
          await api.session.switchModel({ sessionID, model: { id: model.modelID, providerID: model.providerID } });
        }
        const parts = Array.isArray(parameters.parts) ? parameters.parts : [];
        const text = parts
          .filter((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text')
          .map((part) => stringField((part as Record<string, unknown>).text))
          .join('\n\n');
        const files = parts
          .filter((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'file')
          .map((part) => {
            const record = part as Record<string, unknown>;
            return { uri: stringField(record.url), name: stringField(record.filename, 'Attachment') };
          });
        await api.session.prompt({ sessionID, text, ...(files.length > 0 ? { files } : {}) });
        return ok(undefined);
      },
      abort: async (parameters: { sessionID: string }) => {
        await api.session.interrupt({ sessionID: parameters.sessionID });
        return ok(undefined);
      },
      command: async (parameters: { sessionID: string; command: string; arguments?: string; agent?: string; model?: string }) => {
        const sessionID = parameters.sessionID;
        if (parameters.agent) await api.session.switchAgent({ sessionID, agent: parameters.agent });
        if (parameters.model) {
          const [providerID, ...rest] = parameters.model.split('/');
          const modelID = rest.join('/');
          if (providerID && modelID) await api.session.switchModel({ sessionID, model: { id: modelID, providerID } });
        }
        await api.session.command({ sessionID, name: parameters.command, text: parameters.arguments ?? '' });
        return ok(undefined);
      },
    },
    command: {
      list: async () => {
        const response = await api.command.list();
        return ok((response.data ?? []).map((command) => ({ name: command.name, description: command.description, template: '' })));
      },
    },
    config: {
      get: async () => {
        const entries = await api.config.get();
        return ok(configToV1(entries));
      },
      // V2 only exposes shell updates; return the submitted config so callers keep working.
      update: async (parameters: { config?: unknown }) => ok(parameters?.config),
    },
    provider: {
      list: async () => ok(await providersToV1(api)),
      auth: async () => ok(await providerAuthToV1(api)),
      oauth: {
        authorize: async (parameters: { providerID: string; method: number; inputs?: Record<string, string> }) => {
          const integration = await findIntegration(api, parameters.providerID);
          const method = integration?.methods[parameters.method];
          if (!integration || !method || method.type !== 'oauth') {
            throw new Error('This provider does not offer OAuth on OpenCode 2.');
          }
          const attempt = await api.integration.oauth.connect({
            integrationID: integration.id,
            methodID: method.id,
            ...(parameters.inputs ? { answer: parameters.inputs } : {}),
          });
          oauthAttempts.set(parameters.providerID, { integrationID: integration.id, attemptID: attempt.data.attemptID });
          return ok({ url: attempt.data.url, instructions: attempt.data.instructions, method: attempt.data.mode });
        },
        callback: async (parameters: { providerID: string; code?: string }) => {
          const attempt = oauthAttempts.get(parameters.providerID);
          if (!attempt) {
            throw new Error('Start provider sign-in again to complete it.');
          }
          await api.integration.oauth.complete({ integrationID: attempt.integrationID, attemptID: attempt.attemptID, ...(parameters.code ? { code: parameters.code } : {}) });
          return ok(undefined);
        },
      },
    },
    app: {
      agents: async () => {
        const response = await api.agent.list();
        return ok((response.data ?? []).map(agentToV1));
      },
    },
    auth: {
      set: async (parameters: { providerID: string; auth?: { key?: string; token?: string } }) => {
        const integration = await findIntegration(api, parameters.providerID);
        if (!integration) throw new Error('This provider is not available on OpenCode 2.');
        const key = parameters.auth?.key || parameters.auth?.token || '';
        await api.integration.connect.key({ integrationID: integration.id, key });
        return ok(undefined);
      },
      remove: async (parameters: { providerID: string }) => {
        const integration = await findIntegration(api, parameters.providerID);
        const credential = integration?.connections.find((connection) => connection.type === 'credential');
        if (credential && credential.type === 'credential') {
          await api.credential.remove({ credentialID: credential.id });
        }
        return ok(undefined);
      },
    },
    experimental: {
      session: {
        list: async () => ok([]),
      },
    },
    lsp: {
      status: async () => {
        throw new Error('Language servers are not available on OpenCode 2 servers.');
      },
    },
    formatter: {
      status: async () => {
        throw new Error('Formatters are not available on OpenCode 2 servers.');
      },
    },
    find: {
      files: async (parameters: { query: string; dirs?: string }) => {
        const includeDirectories = parameters.dirs === 'true';
        const response = await api.file.find({ query: parameters.query, limit: 100, ...(includeDirectories ? {} : { type: 'file' }) });
        return ok((response.data ?? []).map((entry) => entry.path));
      },
      text: async () => ok([]),
      symbols: async () => ok([]),
    },
    file: {
      list: async (parameters: { path?: string }) => {
        const response = await api.file.list(parameters?.path ? { path: parameters.path } : {});
        return ok(response.data);
      },
      read: async (parameters: { path: string }) => ok(decodeFile(await api.file.read({ path: parameters.path }))),
      status: async () => ok([]),
    },
    vcs: {
      get: async () => {
        const response = await api.vcs.get();
        return ok({ branch: response.data?.branch?.current, default_branch: response.data?.branch?.default });
      },
      status: async () => {
        const response = await api.vcs.status();
        return ok(response.data);
      },
      diff: async (parameters: { mode?: string; context?: number }) => {
        const mode = parameters?.mode === 'branch' ? 'branch' : 'working';
        const response = await api.vcs.diff({ mode, ...(parameters?.context !== undefined ? { context: parameters.context } : {}) });
        return ok(response.data);
      },
      diff2: {
        raw: async () => {
          const response = await api.vcs.diff({ mode: 'working' });
          return ok((response.data ?? []).map((diff) => diff.patch).join('\n'));
        },
      },
      apply: async () => {
        throw new Error('Applying patches is not supported by OpenCode 2 servers.');
      },
    },
    worktree: {
      list: async () => {
        const projectID = await getProjectID();
        return ok(await api.worktree.list({ projectID }));
      },
      create: async (parameters: { worktreeCreateInput?: { name?: string } }) => {
        const projectID = await getProjectID();
        const input = parameters?.worktreeCreateInput ?? {};
        return ok(await api.worktree.create({ projectID, ...(input.name ? { name: input.name } : {}) }));
      },
      reset: async () => {
        const projectID = await getProjectID();
        await api.worktree.refresh({ projectID });
        return ok({});
      },
      remove: async (parameters: { worktreeRemoveInput?: { directory?: string } }) => {
        const projectID = await getProjectID();
        const target = parameters?.worktreeRemoveInput?.directory;
        if (!target) throw new Error('A worktree directory is required.');
        await api.worktree.remove({ projectID, directory: target, force: true });
        return ok({});
      },
    },
    mcp: {
      status: async () => {
        const response = await api.mcp.list();
        const statuses: Record<string, unknown> = {};
        (response.data ?? []).forEach((server) => {
          const raw = (server.status ?? {}) as Record<string, unknown>;
          const value = typeof raw.status === 'string' ? raw.status : typeof raw.type === 'string' ? raw.type : 'disabled';
          statuses[server.name] = { status: value };
        });
        return ok(statuses);
      },
      add: async (parameters: { name: string; config?: Record<string, unknown> }) => {
        await api.mcp.add({ server: parameters.name, config: mcpConfigToV2(parameters.config) });
        return ok(parameters.config);
      },
      connect: async (parameters: { name: string }) => {
        await api.mcp.connect({ server: parameters.name });
        return ok(undefined);
      },
      disconnect: async (parameters: { name: string }) => {
        await api.mcp.disconnect({ server: parameters.name });
        return ok(undefined);
      },
      auth: {
        start: async () => {
          throw new Error('MCP OAuth is not supported by OpenCode 2 servers.');
        },
        callback: async () => {
          throw new Error('MCP OAuth is not supported by OpenCode 2 servers.');
        },
        remove: async () => {
          throw new Error('MCP OAuth is not supported by OpenCode 2 servers.');
        },
      },
    },
    pty: {
      shells: async () => {
        const shells = await api.config.shells();
        return ok(shells.map(shellToV1));
      },
      list: async () => {
        const response = await api.pty.list();
        return ok(response.data);
      },
      create: async (parameters?: { command?: string; args?: string[]; cwd?: string; title?: string; env?: Record<string, string> }) => {
        const response = await api.pty.create({ ...parameters });
        return ok(response.data);
      },
      get: async (parameters: { ptyID: string }) => {
        const response = await api.pty.get({ ptyID: parameters.ptyID });
        return ok(response.data);
      },
      update: async (parameters: { ptyID: string; title?: string; size?: { rows: number; cols: number } }) => {
        const response = await api.pty.update({ ptyID: parameters.ptyID, ...(parameters.title !== undefined ? { title: parameters.title } : {}), ...(parameters.size ? { size: parameters.size } : {}) });
        return ok(response.data);
      },
      remove: async (parameters: { ptyID: string }) => {
        await api.pty.remove({ ptyID: parameters.ptyID });
        return ok(undefined);
      },
      connectToken: async (parameters: { ptyID: string }) => {
        const response = await api.pty.connect.token({ ptyID: parameters.ptyID });
        return ok({ ticket: response.data?.ticket });
      },
    },
    global: {
      health: async () => {
        const info = await api.server.info();
        return ok({ healthy: true, version: info.version });
      },
      event: async (parameters?: { signal?: AbortSignal }) => ({ stream: subscribeV2(api, parameters?.signal, ctx) }),
    },
    permission: {
      list: async () => {
        const response = await api.permission.request.list();
        return ok((response.data ?? []).map((permission) => mapPermission(permission, ctx)));
      },
      reply: async (parameters: { requestID: string; reply: 'once' | 'always' | 'reject' }) => {
        const sessionID = await resolvePermissionSession(api, ctx, parameters.requestID);
        await api.permission.reply({ sessionID, requestID: parameters.requestID, decision: parameters.reply });
        return ok(undefined);
      },
    },
    question: {
      list: async () => {
        const response = await api.form.list();
        return ok((response.data ?? []).map((form) => formToQuestion(form, ctx)));
      },
      reply: async (parameters: { requestID: string; answers?: unknown }) => {
        const form = await resolveForm(api, ctx, parameters.requestID);
        await api.session.form.reply({ sessionID: form.sessionID, formID: form.id, answer: toAnswer(form, parameters.answers) });
        return ok(undefined);
      },
      reject: async (parameters: { requestID: string }) => {
        const form = await resolveForm(api, ctx, parameters.requestID);
        await api.session.form.cancel({ sessionID: form.sessionID, formID: form.id });
        return ok(undefined);
      },
    },
  };

  return { client, ctx };
}

const oauthAttempts = new Map<string, { integrationID: string; attemptID: string }>();

function decodeFile(bytes: unknown): Record<string, unknown> {
  if (typeof bytes === 'string') {
    return { type: 'text', content: bytes };
  }
  try {
    const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes as Uint8Array);
    return { type: 'text', content };
  } catch {
    return { type: 'binary', content: '', encoding: 'base64' };
  }
}

function configToV1(entries: unknown): Record<string, unknown> {
  const list = Array.isArray(entries) ? (entries as Record<string, unknown>[]) : [];
  const document = list.find((entry) => entry.type === 'document' && entry.info);
  const info = (document?.info ?? {}) as Record<string, unknown>;
  const providers = (info.providers ?? {}) as Record<string, Record<string, unknown>>;
  const enabled: string[] = [];
  const disabled: string[] = [];
  const provider: Record<string, unknown> = {};
  Object.entries(providers).forEach(([id, value]) => {
    provider[id] = value ?? {};
    if (value && value.disabled === true) disabled.push(id);
    else enabled.push(id);
  });
  const rawModel = info.model;
  const model = typeof rawModel === 'string'
    ? rawModel
    : rawModel && typeof rawModel === 'object'
      ? `${stringField((rawModel as Record<string, unknown>).providerID)}/${stringField((rawModel as Record<string, unknown>).model)}`
      : undefined;

  return {
    ...info,
    provider,
    enabled_providers: enabled,
    disabled_providers: disabled,
    model,
    agent: info.agents,
    permission: info.permissions,
    mcp: (info.mcp as Record<string, unknown> | undefined)?.servers,
  };
}

async function providersToV1(api: V2Api) {
  const [providersResponse, modelsResponse, defaultResponse] = await Promise.all([
    api.provider.list(),
    api.model.list(),
    api.model.default().catch(() => ({ data: null })),
  ]);
  const providers: V2Provider[] = providersResponse.data ?? [];
  const models: V2Model[] = modelsResponse.data ?? [];
  const defaultRef = defaultResponse.data;

  const all = providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: Object.fromEntries(models.filter((model) => model.providerID === provider.id).map((model) => [model.modelID, modelToV1(model)])),
  }));

  const defaults: Record<string, string> = {};
  providers.forEach((provider) => {
    const first = models.find((model) => model.providerID === provider.id);
    if (first) defaults[provider.id] = first.modelID;
  });
  if (defaultRef) defaults[defaultRef.providerID] = defaultRef.modelID;

  const connected = providers.filter((provider) => provider.activation !== 'disabled').map((provider) => provider.id);
  return { all, default: defaults, connected };
}

async function providerAuthToV1(api: V2Api) {
  const [integrationsResponse, providersResponse] = await Promise.all([api.integration.list(), api.provider.list()]);
  const result: Record<string, unknown[]> = {};
  (providersResponse.data ?? []).forEach((provider) => {
    const integration = (integrationsResponse.data ?? []).find((item) => item.id === provider.integrationID);
    if (!integration) return;
    result[provider.id] = integration.methods.map((method) => ({
      type: method.type === 'oauth' ? 'oauth' : 'api',
      label: 'label' in method && method.label ? method.label : method.type,
    }));
  });
  return result;
}

async function findIntegration(api: V2Api, providerID: string): Promise<V2Integration | undefined> {
  const [integrations, providers] = await Promise.all([api.integration.list(), api.provider.list()]);
  const provider = (providers.data ?? []).find((item) => item.id === providerID);
  if (!provider) return undefined;
  return (integrations.data ?? []).find((item) => item.id === provider.integrationID);
}

function agentToV1(agent: V2Agent): Record<string, unknown> {
  return { name: agent.id, description: agent.description, mode: agent.mode, hidden: agent.hidden };
}

function shellToV1(shell: V2Shell): Record<string, unknown> {
  return { name: shell.name, path: shell.path, acceptable: shell.acceptable };
}

function mcpConfigToV2(config: Record<string, unknown> | undefined) {
  if (!config) return { type: 'local' as const, command: [] as string[] };
  const enabled = config.enabled !== false;
  if (config.type === 'remote') {
    return { type: 'remote' as const, url: stringField(config.url), disabled: !enabled };
  }
  const command = Array.isArray(config.command) ? config.command.map((item) => stringField(item)) : [];
  return { type: 'local' as const, command, disabled: !enabled };
}

async function resolvePermissionSession(api: V2Api, ctx: AdapterContext, requestID: string): Promise<string> {
  const known = ctx.permissionSession.get(requestID);
  if (known) return known;
  const response = await api.permission.request.list();
  (response.data ?? []).forEach((permission) => ctx.permissionSession.set(permission.id, permission.sessionID));
  const resolved = ctx.permissionSession.get(requestID);
  if (!resolved) throw new Error('This permission request is no longer available.');
  return resolved;
}

async function resolveForm(api: V2Api, ctx: AdapterContext, requestID: string): Promise<V2Form> {
  const known = ctx.formSession.get(requestID);
  if (known) return known;
  const response = await api.form.list();
  (response.data ?? []).forEach((form) => ctx.formSession.set(form.id, form));
  const resolved = ctx.formSession.get(requestID);
  if (!resolved) throw new Error('This question is no longer available.');
  return resolved;
}

function wrapErrors(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wrapErrors);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    Object.keys(source).forEach((key) => {
      const item = source[key];
      if (typeof item === 'function') {
        target[key] = (...args: unknown[]) => {
          try {
            const result = (item as (...inner: unknown[]) => unknown)(...args);
            if (result && typeof (result as Promise<unknown>).then === 'function') {
              return (result as Promise<unknown>).catch((error) => {
                throw toError(error);
              });
            }
            return result;
          } catch (error) {
            throw toError(error);
          }
        };
      } else {
        target[key] = wrapErrors(item);
      }
    });
    return target;
  }
  return value;
}

export function buildV2Client(settings: OpencodeConnectionSettings): ScopedOpencodeClient {
  const { client } = buildV2Raw(settings);
  return wrapErrors(client) as ScopedOpencodeClient;
}
