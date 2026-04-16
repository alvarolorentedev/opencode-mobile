#!/usr/bin/env node

import http from 'node:http';
import { URL } from 'node:url';

const port = Number.parseInt(process.env.FAKE_OPENCODE_PORT || '4096', 10);
const scenarioName = process.env.FAKE_OPENCODE_SCENARIO || 'happy-path';

const now = () => Date.now();

let state = createState(scenarioName);

function createState(scenario) {
  const rootPath = '/workspace';
  const projectPath = '/workspace/demo-project';
  const project = {
    id: 'project-demo',
    worktree: projectPath,
    time: {
      created: now() - 60_000,
      initialized: now() - 30_000,
    },
  };

  return {
    scenario,
    rootPath,
    project,
    nextSessionId: 1,
    nextMessageId: 1,
    nextPendingId: 1,
    sseClients: new Set(),
    sessions: [],
    messagesBySession: {},
    sessionStatuses: {},
    diffsBySession: {},
    todosBySession: {},
    pendingPermissions: [],
    pendingQuestions: [],
    configuredProviderIds: new Set(['openai']),
    config: {
      model: 'openai/gpt-4.1-mini',
      enabled_providers: ['openai'],
      permission: {
        edit: 'ask',
        bash: 'ask',
        webfetch: 'ask',
        doom_loop: 'ask',
        external_directory: 'ask',
      },
      provider: {},
      agent: {
        build: {},
        general: {},
      },
    },
    authByProvider: {},
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-opencode-directory',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getSession(sessionId) {
  return state.sessions.find((session) => session.id === sessionId);
}

function getMessages(sessionId) {
  return state.messagesBySession[sessionId] || [];
}

function emitEvent(event) {
  if (state.sseClients.size === 0) {
    return;
  }

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of state.sseClients) {
    client.write(payload);
  }
}

function syncSessionSummary(sessionId, summary) {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  session.summary = summary;
  session.time.updated = now();
}

function createSession(title = '') {
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
      created: now(),
      updated: now(),
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
  const record = {
    info: {
      id: `message-${state.nextMessageId++}`,
      role,
      sessionID: sessionId,
      time: {
        created: now(),
      },
      ...extra,
    },
    parts,
  };

  state.messagesBySession[sessionId] = [...getMessages(sessionId), record];
  const session = getSession(sessionId);
  if (session) {
    session.time.updated = now();
  }
  emitEvent({
    type: 'message.updated',
    properties: {
      info: record.info,
    },
  });
  return record;
}

function completePrompt(sessionId, promptText) {
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

function summarizePrompt(promptText) {
  const words = (promptText || 'Untitled chat').trim().split(/\s+/).slice(0, 4);
  return words.join(' ');
}

function scheduleCompletion(sessionId, promptText) {
  setTimeout(() => {
    completePrompt(sessionId, promptText);
  }, 700);
}

function createPermissionRequest(sessionId) {
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

function listProvidersPayload() {
  return {
    all: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'gpt-4.1-mini': { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', reasoning: true },
        },
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        models: {
          'openrouter/auto': { id: 'openrouter/auto', name: 'Auto', reasoning: false },
        },
      },
    ],
    connected: [...state.configuredProviderIds].sort(),
  };
}

function providerAuthPayload() {
  return {
    openai: [
      {
        type: 'oauth',
        label: 'Sign in',
        prompts: [],
      },
    ],
    openrouter: [],
  };
}

function handleSse(req, res) {
  if (state.scenario === 'stream-disconnect') {
    res.writeHead(503, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
    });
    res.end('SSE disabled for this scenario');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(': connected\n\n');
  state.sseClients.add(res);
  req.on('close', () => {
    state.sseClients.delete(res);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const pathname = requestUrl.pathname;

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-opencode-directory',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      });
      res.end();
      return;
    }

    if (req.method === 'POST' && pathname === '/__control/reset') {
      const body = await readJson(req);
      const nextScenario = body?.scenario || scenarioName;
      for (const client of state.sseClients) {
        client.end();
      }
      state = createState(nextScenario);
      sendJson(res, 200, { data: { scenario: state.scenario } });
      return;
    }

    if (req.method === 'GET' && pathname === '/path') {
      sendJson(res, 200, { directory: state.rootPath });
      return;
    }

    if (req.method === 'GET' && pathname === '/project') {
      sendJson(res, 200, [state.project]);
      return;
    }

    if (req.method === 'GET' && pathname === '/project/current') {
      sendJson(res, 200, state.project);
      return;
    }

    if (req.method === 'GET' && pathname === '/config') {
      sendJson(res, 200, state.config);
      return;
    }

    if (req.method === 'PATCH' && pathname === '/config') {
      mergeConfigPatch(await readJson(req));
      sendJson(res, 200, state.config);
      return;
    }

    if (req.method === 'GET' && pathname === '/provider') {
      sendJson(res, 200, listProvidersPayload());
      return;
    }

    if (req.method === 'GET' && pathname === '/provider/auth') {
      sendJson(res, 200, providerAuthPayload());
      return;
    }

    if (req.method === 'POST' && /^\/provider\/[^/]+\/oauth\/authorize$/.test(pathname)) {
      sendJson(res, 200, {
        url: 'https://example.test/oauth/complete',
        instructions: 'Fake OAuth completed in CI.',
      });
      return;
    }

    if (req.method === 'PUT' && /^\/auth\/[^/]+$/.test(pathname)) {
      const providerId = pathname.split('/')[2];
      const body = await readJson(req);
      state.authByProvider[providerId] = body?.auth;
      state.configuredProviderIds.add(providerId);
      mergeConfigPatch({
        enabled_providers: [...state.configuredProviderIds],
        provider: {
          [providerId]: body?.auth || { type: 'api' },
        },
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/agent') {
      sendJson(res, 200, [
        { name: 'build', description: 'Default build agent' },
        { name: 'general', description: 'General-purpose agent' },
      ]);
      return;
    }

    if (req.method === 'GET' && pathname === '/session') {
      sendJson(res, 200, state.sessions);
      return;
    }

    if (req.method === 'POST' && pathname === '/session') {
      const body = await readJson(req);
      const session = createSession(body?.title || '');
      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'GET' && pathname === '/session/status') {
      sendJson(res, 200, state.sessionStatuses);
      return;
    }

    if (req.method === 'GET' && /^\/session\/[^/]+\/message$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      sendJson(res, 200, getMessages(sessionId));
      return;
    }

    if (req.method === 'GET' && /^\/session\/[^/]+\/diff$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      sendJson(res, 200, state.diffsBySession[sessionId] || []);
      return;
    }

    if (req.method === 'GET' && /^\/session\/[^/]+\/todo$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      sendJson(res, 200, state.todosBySession[sessionId] || []);
      return;
    }

    if (req.method === 'POST' && (/^\/session\/[^/]+\/prompt_async$/.test(pathname) || /^\/session\/[^/]+\/message$/.test(pathname))) {
      const sessionId = pathname.split('/')[2];
      const body = await readJson(req);
      handlePromptSubmission(sessionId, body);
      sendJson(res, 200, { accepted: true });
      return;
    }

    if (req.method === 'POST' && /^\/session\/[^/]+\/abort$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      state.sessionStatuses[sessionId] = { type: 'idle' };
      emitEvent({ type: 'session.idle', properties: { sessionID: sessionId } });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && /^\/session\/[^/]+\/summarize$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      const session = getSession(sessionId);
      const lastUserMessage = [...getMessages(sessionId)].reverse().find((record) => record.info.role === 'user');
      if (session) {
        const promptText = lastUserMessage?.parts?.find((part) => part.type === 'text')?.text || 'Untitled chat';
        session.title = summarizePrompt(promptText);
      }
      sendJson(res, 200, session || null);
      return;
    }

    if (req.method === 'PATCH' && /^\/session\/[^/]+$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      const session = getSession(sessionId);
      const body = await readJson(req);
      if (!session) {
        notFound(res);
        return;
      }

      session.time.archived = body?.time?.archived ?? null;
      session.time.updated = now();
      emitEvent({ type: 'session.updated', properties: { sessionID: sessionId } });
      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'GET' && pathname === '/permission') {
      sendJson(res, 200, state.pendingPermissions);
      return;
    }

    if (req.method === 'GET' && pathname === '/question') {
      sendJson(res, 200, state.pendingQuestions);
      return;
    }

    if (req.method === 'POST' && /^\/permission\/[^/]+\/reply$/.test(pathname)) {
      const requestId = pathname.split('/')[2];
      const request = state.pendingPermissions.find((entry) => entry.id === requestId);
      state.pendingPermissions = state.pendingPermissions.filter((entry) => entry.id !== requestId);
      emitEvent({ type: 'permission.replied', properties: { requestID: requestId } });
      if (request?.sessionID) {
        scheduleCompletion(request.sessionID, 'permission resolved');
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && /^\/question\/[^/]+\/reply$/.test(pathname)) {
      const requestId = pathname.split('/')[2];
      const request = state.pendingQuestions.find((entry) => entry.id === requestId);
      state.pendingQuestions = state.pendingQuestions.filter((entry) => entry.id !== requestId);
      if (request?.sessionID) {
        scheduleCompletion(request.sessionID, 'question resolved');
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && /^\/question\/[^/]+\/reject$/.test(pathname)) {
      const requestId = pathname.split('/')[2];
      state.pendingQuestions = state.pendingQuestions.filter((entry) => entry.id !== requestId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/event') {
      handleSse(req, res);
      return;
    }

    notFound(res);
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unknown fake server error',
      scenario: state.scenario,
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Fake OpenCode server listening on http://127.0.0.1:${port} (${state.scenario})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
