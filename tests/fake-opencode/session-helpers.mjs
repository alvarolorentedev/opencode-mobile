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
      title,
      summary: {
        files: 0,
        additions: 0,
        deletions: 0,
      },
      time: {
        created: getNow(),
        updated: getNow(),
        archived: null,
      },
    };

    state.sessions.unshift(session);
    state.messagesBySession[sessionId] = [];
    state.diffsBySession[sessionId] = [];
    state.todosBySession[sessionId] = [];
    state.sessionStatuses[sessionId] = { type: 'idle' };
    emitEvent({ type: 'session.created', properties: { sessionID: sessionId } });
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
      emitEvent({ type: 'session.updated', properties: { sessionID: sessionId } });
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
      permission: 'edit_file',
      patterns: ['app/(tabs)/index.tsx'],
      always: [],
      tool: { messageID: 'tool-message-1', callID: 'tool-call-1' },
    };
    state.pendingPermissions = [request];
    emitEvent({ type: 'permission.updated', properties: { sessionID: sessionId } });
  }

  function createQuestionRequest(sessionId) {
    const state = getState();
    const request = {
      id: `question-${state.nextPendingId++}`,
      sessionID: sessionId,
      questions: [
        {
          question: 'Which area should OpenCode stabilize first?',
          header: 'Focus area',
          options: [
            { label: 'Chat flow', description: 'Keep the prompt-response flow healthy.' },
            { label: 'Settings', description: 'Validate provider configuration first.' },
          ],
          multiple: false,
          custom: true,
        },
      ],
      tool: { messageID: 'tool-message-2', callID: 'tool-call-2' },
    };
    state.pendingQuestions = [request];
  }

  function handlePromptSubmission(sessionId, body) {
    const state = getState();
    const promptText = body?.parts?.find((part) => part?.type === 'text')?.text?.trim() || '';

    createMessage(sessionId, 'user', [{ type: 'text', text: promptText || 'Triggered from CI flow test.' }]);
    state.sessionStatuses[sessionId] = { type: 'running' };
    emitEvent({
      type: 'session.status',
      properties: {
        sessionID: sessionId,
        status: { type: 'running' },
      },
    });

    if (state.scenario === 'permission') {
      createPermissionRequest(sessionId);
      return;
    }

    if (state.scenario === 'question') {
      createQuestionRequest(sessionId);
      return;
    }

    scheduleCompletion(sessionId, promptText);
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
    createQuestionRequest,
    createSession,
    getMessages,
    getSession,
    handlePromptSubmission,
    mergeConfigPatch,
    scheduleCompletion,
    summarizePrompt,
  };
}
