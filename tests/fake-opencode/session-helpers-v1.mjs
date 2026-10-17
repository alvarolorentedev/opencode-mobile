import { completedTask, permissionRequest, questionForm, toLegacyFileDiffs } from './fixtures.mjs';
import { resolveProject } from './state-v1.mjs';

export function createSessionHelpers({ getNow, getState, emitEvent }) {
  function getSession(sessionId) {
    return getState().sessions.find((session) => session.id === sessionId);
  }

  function getMessages(sessionId) {
    return getState().messagesBySession[sessionId] || [];
  }

  function createSession(title = '', directory) {
    const state = getState();
    const project = resolveProject(state, directory) || state.project;
    const sessionId = `session-${state.nextSessionId++}`;
    const session = {
      id: sessionId,
      slug: sessionId,
      projectID: project.id,
      directory: directory || project.worktree,
      title,
      version: '1.18.3',
      summary: {
        files: 0,
        additions: 0,
        deletions: 0,
      },
      time: {
        created: getNow(),
        updated: getNow(),
      },
    };

    state.sessions.unshift(session);
    state.messagesBySession[sessionId] = [];
    state.todosBySession[sessionId] = [];
    state.sessionStatuses[sessionId] = { type: 'idle' };
    emitEvent({ type: 'session.created', properties: { sessionID: sessionId, info: session } });
    return session;
  }

  function createMessage(sessionId, role, parts, extra = {}) {
    const state = getState();
    const record = {
      info: {
        id: `message-${state.nextMessageId++}`,
        role,
        sessionID: sessionId,
        time: {
          created: getNow(),
        },
        ...extra,
      },
      parts,
    };

    state.messagesBySession[sessionId] = [...getMessages(sessionId), record];
    const session = getSession(sessionId);
    if (session) {
      session.time.updated = getNow();
    }
    emitEvent({
      type: 'message.updated',
      properties: {
        sessionID: sessionId,
        info: record.info,
      },
    });
    return record;
  }

  function summarizePrompt(promptText) {
    const words = (promptText || 'Untitled chat').trim().split(/\s+/).slice(0, 4);
    return words.join(' ');
  }

  function completePrompt(sessionId, promptText) {
    const state = getState();
    const userMessages = getMessages(sessionId).filter((message) => message.info.role === 'user');
    const latestUserMessage = userMessages.at(-1);
    const previousDiffs = userMessages.filter((message) => message.info.summary?.diffs).length;
    const { source, todos, text: assistantText } = completedTask(previousDiffs, promptText);
    const diff = toLegacyFileDiffs([source]);

    if (latestUserMessage) {
      latestUserMessage.info.summary = { diffs: diff };
    }
    state.todosBySession[sessionId] = todos;
    state.workspaceTaskCompleted = true;
    createMessage(sessionId, 'assistant', [
      { type: 'text', text: assistantText },
      { type: 'patch', files: diff.map((entry) => entry.file) },
    ], { parentID: latestUserMessage?.info.id });
    state.sessionStatuses[sessionId] = { type: 'idle' };
    emitEvent({
      type: 'session.diff',
      properties: { sessionID: sessionId, diff },
    });
    emitEvent({ type: 'todo.updated', properties: { sessionID: sessionId, todos } });
    emitEvent({ type: 'session.idle', properties: { sessionID: sessionId } });

    const session = getSession(sessionId);
    if (session && !session.title.trim()) {
      session.title = summarizePrompt(promptText);
      emitEvent({ type: 'session.updated', properties: { sessionID: sessionId, info: session } });
    }
  }

  function scheduleCompletion(sessionId, promptText) {
    const state = getState();
    const timer = setTimeout(() => {
      state.completionTimers.delete(timer);
      completePrompt(sessionId, promptText);
    }, 700);
    state.completionTimers.add(timer);
  }

  // Provider error + automatic retry. The retry status is emitted as an event
  // (V2 keeps it on the assistant message and excludes it from the running set),
  // then the recovered output is written to state with no SSE event, so only the
  // busy safety poll can surface it. This mirrors the Android freeze report.
  function scheduleRetry(sessionId, promptText) {
    const state = getState();
    const assistantId = `message-${state.nextMessageId++}`;
    const retryError = { type: 'SessionError', message: 'The provider response ended unexpectedly.' };
    const assistant = {
      info: {
        id: assistantId,
        role: 'assistant',
        sessionID: sessionId,
        time: { created: getNow() },
        error: retryError,
        retry: { attempt: 2, at: getNow() + 5_000, error: retryError },
      },
      parts: [],
    };
    state.messagesBySession[sessionId] = [...getMessages(sessionId), assistant];

    const failTimer = setTimeout(() => {
      state.completionTimers.delete(failTimer);
      state.sessionStatuses[sessionId] = { type: 'idle' };
      emitEvent({ type: 'session.idle', properties: { sessionID: sessionId } });
      state.sessionStatuses[sessionId] = { type: 'retry' };
      emitEvent({
        type: 'session.retry.scheduled',
        properties: { sessionID: sessionId, assistantMessageID: assistantId, attempt: 2, at: getNow() + 5_000, error: retryError },
      });
      emitEvent({ type: 'message.updated', properties: { sessionID: sessionId, info: assistant.info } });
    }, 300);
    state.completionTimers.add(failTimer);

    const recoverTimer = setTimeout(() => {
      state.completionTimers.delete(recoverTimer);
      assistant.parts.push({ type: 'text', text: `Recovered: ${promptText || 'task complete'} after the provider retry.` });
      assistant.info.error = undefined;
      assistant.info.retry = undefined;
      state.sessionStatuses[sessionId] = { type: 'idle' };
      const session = getSession(sessionId);
      if (session) session.time.updated = getNow();
    }, 7_000);
    state.completionTimers.add(recoverTimer);
  }

  function createPermissionRequest(sessionId) {
    const state = getState();
    const native = permissionRequest(`permission-${state.nextPendingId++}`, sessionId);
    const request = {
      id: native.id, sessionID: native.sessionID, permission: native.action,
      patterns: native.resources, always: native.save, metadata: native.metadata,
      tool: { messageID: 'tool-message-1', callID: 'tool-call-1' },
    };
    state.pendingPermissions = [request];
    emitEvent({ type: 'permission.asked', properties: request });
  }

  function createQuestionRequest(sessionId) {
    const state = getState();
    const native = questionForm(`question-${state.nextPendingId++}`, sessionId, state.scenario === 'question-multi');
    const request = {
      id: native.id, sessionID: native.sessionID,
      questions: native.fields.map((field) => ({
        header: field.title, key: field.key, question: field.description,
        ...(field.type !== 'string' || !field.options ? { type: field.type } : {}),
        options: (field.options || []).map(({ value, ...option }) => field.type === 'multiselect' ? { ...option, value } : option),
        multiple: field.type === 'multiselect', custom: field.custom ?? true, required: field.required,
        when: field.when?.map((condition) => ({ ...condition, value: native.fields.find((entry) => entry.key === condition.key)?.options?.find((option) => option.value === condition.value)?.label ?? condition.value })),
      })),
    };
    state.pendingQuestions = [request];
    emitEvent({ type: 'question.asked', properties: request });
  }

  function handlePromptSubmission(sessionId, body) {
    const state = getState();
    const promptText = body?.parts?.find((part) => part?.type === 'text')?.text?.trim() || '';

    const files = (body?.parts || []).filter((part) => part.type === 'file');
    createMessage(sessionId, 'user', [
      ...(promptText || !files.length ? [{ type: 'text', text: promptText || 'Triggered from CI flow test.' }] : []),
      ...files,
    ], body?.messageID ? { id: body.messageID } : {});
    state.sessionStatuses[sessionId] = { type: 'busy' };
    emitEvent({
      type: 'session.status',
      properties: {
        sessionID: sessionId,
        status: { type: 'busy' },
      },
    });

    if (state.scenario === 'inbox') {
      createMessage(sessionId, 'assistant', [{ type: 'text', text: `Working on: ${promptText}` }]);
      return;
    }

    if (state.scenario === 'permission') {
      createPermissionRequest(sessionId);
      return;
    }

    if (state.scenario === 'question' || state.scenario === 'question-multi' || state.scenario === 'question-failure') {
      createQuestionRequest(sessionId);
      return;
    }

    if (state.scenario === 'retry') {
      scheduleRetry(sessionId, promptText);
      return;
    }

    scheduleCompletion(sessionId, promptText);
  }

  function handleCommand(sessionId, body) {
    const command = body?.command || 'unknown';
    const args = body?.arguments?.trim();
    const text = `Command /${command}${args ? ` ${args}` : ''} completed.`;
    createMessage(sessionId, 'user', [{ type: 'text', text: `/${command}${args ? ` ${args}` : ''}` }]);
    createMessage(sessionId, 'assistant', [{ type: 'text', text }]);
    getState().sessionStatuses[sessionId] = { type: 'idle' };
    emitEvent({ type: 'session.idle', properties: { sessionID: sessionId } });
    return getMessages(sessionId).at(-1);
  }

  function forkSession(sessionId, messageId) {
    const source = getSession(sessionId);
    if (!source) return undefined;
    const forked = createSession(`${source.title || 'Untitled chat'} (fork)`, source.directory);
    forked.parentID = sessionId;
    const sourceMessages = getMessages(sessionId);
    const stopIndex = messageId ? sourceMessages.findIndex((entry) => entry.info.id === messageId) : -1;
    getState().messagesBySession[forked.id] = structuredClone(stopIndex >= 0 ? sourceMessages.slice(0, stopIndex + 1) : sourceMessages)
      .map((record) => ({ ...record, info: { ...record.info, sessionID: forked.id } }));
    return forked;
  }

  function mergeConfigPatch(patch) {
    const state = getState();
    state.config = {
      ...state.config,
      ...patch,
      permission: {
        ...state.config.permission,
        ...(patch?.permission || {}),
      },
      provider: {
        ...state.config.provider,
        ...(patch?.provider || {}),
      },
      mcp: {
        ...state.config.mcp,
        ...(patch?.mcp || {}),
      },
    };

    const enabledProviders = Array.isArray(state.config.enabled_providers) ? state.config.enabled_providers : [];
    state.config.enabled_providers = [...new Set(enabledProviders)].sort();
    state.config.enabled_providers.forEach((providerId) => state.configuredProviderIds.add(providerId));
  }

  return {
    createSession,
    completePrompt,
    forkSession,
    getMessages,
    getSession,
    handlePromptSubmission,
    handleCommand,
    mergeConfigPatch,
    scheduleCompletion,
    summarizePrompt,
  };
}
