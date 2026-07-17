export function createSessionHelpers({ getNow, getState, emitEvent }) {
  function getSession(sessionId) {
    return getState().sessions.find((session) => session.id === sessionId);
  }

  function getMessages(sessionId) {
    return getState().messagesBySession[sessionId] || [];
  }

  function syncSessionSummary(sessionId, summary) {
    const session = getSession(sessionId);
    if (!session) {
      return;
    }

    session.summary = summary;
    session.time.updated = getNow();
  }

  function createSession(title = '') {
    const state = getState();
    const sessionId = `session-${state.nextSessionId++}`;
    const session = {
      id: sessionId,
      slug: sessionId,
      projectID: state.project.id,
      directory: state.project.worktree,
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
    state.diffsBySession[sessionId] = [];
    state.todosBySession[sessionId] = [];
    state.sessionStatuses[sessionId] = { type: 'idle' };
    emitEvent({ type: 'session.created', properties: { info: session } });
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
    const diff = [
      {
        file: 'app/(tabs)/index.tsx',
        additions: 6,
        deletions: 1,
        before: 'export default function OldScreen() {}\n',
        after: 'export default function ChatLandingScreen() {\n  return null;\n}\n',
      },
    ];
    const todos = [
      { id: 'todo-1', content: 'Validate session transcript', status: 'completed', priority: 'high' },
      { id: 'todo-2', content: 'Confirm fake server integration', status: 'completed', priority: 'medium' },
    ];
    const assistantText = `Finished: ${promptText || 'task complete'}. Flow stayed stable against the fake OpenCode server.`;

    state.diffsBySession[sessionId] = diff;
    state.todosBySession[sessionId] = todos;
    syncSessionSummary(sessionId, { files: 1, additions: 6, deletions: 1 });
    createMessage(sessionId, 'assistant', [
      { type: 'text', text: assistantText },
      { type: 'patch', files: diff.map((entry) => entry.file) },
    ]);
    state.sessionStatuses[sessionId] = { type: 'idle' };
    emitEvent({ type: 'session.diff', properties: { sessionID: sessionId, diff } });
    emitEvent({ type: 'todo.updated', properties: { sessionID: sessionId, todos } });
    emitEvent({ type: 'session.idle', properties: { sessionID: sessionId } });

    const session = getSession(sessionId);
    if (session && !session.title.trim()) {
      session.title = summarizePrompt(promptText);
      emitEvent({ type: 'session.updated', properties: { info: session } });
    }
  }

  function scheduleCompletion(sessionId, promptText) {
    setTimeout(() => {
      completePrompt(sessionId, promptText);
    }, 700);
  }

  function createPermissionRequest(sessionId) {
    const state = getState();
    const request = {
      id: `permission-${state.nextPendingId++}`,
      sessionID: sessionId,
      type: 'edit_file',
      title: 'Edit file',
      pattern: ['app/(tabs)/index.tsx'],
      metadata: { source: 'fake-opencode' },
      messageID: 'tool-message-1',
      callID: 'tool-call-1',
      time: { created: getNow() },
    };
    state.pendingPermissions = [request];
    emitEvent({ type: 'permission.updated', properties: request });
  }

  function handlePromptSubmission(sessionId, body) {
    const state = getState();
    const promptText = body?.parts?.find((part) => part?.type === 'text')?.text?.trim() || '';

    createMessage(sessionId, 'user', [{ type: 'text', text: promptText || 'Triggered from CI flow test.' }]);
    state.sessionStatuses[sessionId] = { type: 'busy' };
    emitEvent({
      type: 'session.status',
      properties: {
        sessionID: sessionId,
        status: { type: 'busy' },
      },
    });

    if (state.scenario === 'permission') {
      createPermissionRequest(sessionId);
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
    const forked = createSession(`${source.title || 'Untitled chat'} (fork)`);
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
    };

    const enabledProviders = Array.isArray(state.config.enabled_providers) ? state.config.enabled_providers : [];
    state.config.enabled_providers = [...new Set(enabledProviders)].sort();
    state.config.enabled_providers.forEach((providerId) => state.configuredProviderIds.add(providerId));
  }

  return {
    createMessage,
    createPermissionRequest,
    createSession,
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
