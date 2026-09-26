import http from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocketServer } from 'ws';

import { createSessionHelpers } from './session-helpers.mjs';
import { createStateStore, getNow } from './state.mjs';

const port = Number.parseInt(process.env.FAKE_OPENCODE_PORT || '4096', 10);
const scenarioName = process.env.FAKE_OPENCODE_SCENARIO || 'happy-path';

const stateStore = createStateStore(scenarioName);
let state = stateStore.getState();
const v2Clients = new Set();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-opencode-ticket',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function location() {
  return { directory: state.project.worktree };
}

// The V2 adapter must scope form/permission lists to the active project
// directory. Reject unscoped list calls so the client-side scoping is covered.
function requireLocation(requestUrl, res) {
  const directory = requestUrl.searchParams.get('location[directory]');
  if (!directory) {
    sendJson(res, 400, { error: 'location[directory] is required' });
    return undefined;
  }
  return directory;
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

function event(type, data) {
  return {
    id: `event-${state.nextEventId++}`,
    created: Date.now(),
    type,
    location: { directory: state.project.worktree },
    data,
  };
}

function translate(eventMessage) {
  const properties = eventMessage?.properties || {};
  switch (eventMessage?.type) {
    case 'session.created':
      return event('session.created', { sessionID: properties.sessionID });
    case 'session.updated':
      return event('session.renamed', { sessionID: properties.sessionID, title: properties.info?.title });
    case 'session.status':
      return event('session.status', { sessionID: properties.sessionID, status: properties.status });
    case 'session.idle':
      return event('session.idle', { sessionID: properties.sessionID });
    case 'message.updated':
      return event('session.text.ended', { sessionID: properties.sessionID });
    case 'session.diff':
      return event('session.step.ended', { sessionID: properties.sessionID, files: properties.diff });
    case 'permission.asked':
      return event('permission.asked', {
        id: properties.id,
        sessionID: properties.sessionID,
        action: properties.permission,
        resources: properties.patterns,
        save: properties.always,
        metadata: properties.metadata,
      });
    case 'question.asked':
      return event('form.created', { form: questionToForm(properties) });
    case 'question.replied':
      return event('form.replied', { id: properties.requestID, sessionID: properties.sessionID });
    case 'question.rejected':
      return event('form.cancelled', { id: properties.requestID, sessionID: properties.sessionID });
    default:
      return undefined;
  }
}

function emitEvent(eventMessage) {
  const mapped = translate(eventMessage);
  if (!mapped) return;
  const payload = `data: ${JSON.stringify(mapped)}\n\n`;
  for (const client of v2Clients) {
    client.write(payload);
  }
}

const helpers = createSessionHelpers({ emitEvent, getNow, getState: () => state });

function sessionToV2(session) {
  return {
    id: session.id,
    projectID: session.projectID || state.project.id,
    title: session.title || '',
    time: { created: session.time.created, updated: session.time.updated },
    location: { directory: session.directory || state.project.worktree },
  };
}

function messageToV2(record) {
  const parts = record.parts || [];
  const text = parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  if (record.info.role === 'user') {
    return {
      id: record.info.id,
      type: 'user',
      sessionID: record.info.sessionID,
      time: { created: record.info.time.created },
      text,
    };
  }
  const content = [];
  for (const part of parts) {
    if (part.type === 'text') content.push({ type: 'text', text: part.text });
    else if (part.type === 'reasoning') content.push({ type: 'reasoning', text: part.text });
  }
  // V2 has no server-owned todo endpoint. Surface the plan through a
  // `todowrite` tool part so the adapter can derive it from the transcript.
  const todos = state.todosBySession[record.info.sessionID] || [];
  if (todos.length > 0) {
    content.push({
      type: 'tool',
      id: `todowrite-${record.info.id}`,
      name: 'todowrite',
      state: { status: 'completed', input: { todos }, content: [], metadata: {}, time: { start: 0, end: 0 } },
      time: { created: record.info.time.created, completed: record.info.time.created },
    });
  }
  return {
    id: record.info.id,
    type: 'assistant',
    sessionID: record.info.sessionID,
    time: { created: record.info.time.created },
    model: { id: 'gpt-4.1-mini', providerID: 'openai' },
    content,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: 'stop',
  };
}

function questionToForm(question) {
  const first = question.questions?.[0];
  return {
    id: question.id,
    sessionID: question.sessionID,
    title: first?.header || 'Question',
    fields: (question.questions || []).map((item, index) => ({
      key: `q${index}`,
      type: item.multiple ? 'multiselect' : 'string',
      title: item.header,
      description: item.question,
      options: (item.options || []).map((option) => ({ value: option.label.toLowerCase(), label: option.label, description: option.description })),
      custom: item.custom,
    })),
  };
}

function configToV2() {
  const providers = {};
  for (const id of state.configuredProviderIds) {
    providers[id] = {};
  }
  for (const [id, value] of Object.entries(state.config.provider || {})) {
    providers[id] = value;
  }
  return {
    type: 'document',
    info: {
      model: state.config.model,
      providers,
      permissions: state.config.permission,
      mcp: { servers: state.config.mcp },
      agents: state.config.agent,
    },
  };
}

const models = [{
  id: 'openai/gpt-4.1-mini',
  modelID: 'gpt-4.1-mini',
  providerID: 'openai',
  name: 'GPT-4.1 mini',
  capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
  variants: [],
  time: { released: 0 },
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  status: 'active',
  enabled: true,
  limit: { context: 128000, output: 4096 },
}];

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const pathname = requestUrl.pathname;

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-opencode-ticket',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      });
      res.end();
      return;
    }

    if (req.method === 'POST' && pathname === '/__control/reset') {
      const body = await readJson(req);
      for (const client of v2Clients) client.end();
      v2Clients.clear();
      state = stateStore.resetState(body?.scenario || scenarioName);
      sendJson(res, 200, { data: { scenario: state.scenario } });
      return;
    }

    if (pathname === '/api/event') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      v2Clients.add(res);
      res.write(`data: ${JSON.stringify(event('server.connected', {}))}\n\n`);
      req.on('close', () => v2Clients.delete(res));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/info') {
      sendJson(res, 200, { version: '2.0.0-fake', pid: 1, urls: [`http://127.0.0.1:${port}`], paths: { tmp: '/tmp' } });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/location') {
      sendJson(res, 200, { directory: state.project.worktree, project: { id: state.project.id, directory: state.project.worktree, canonical: state.project.worktree } });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/project') {
      sendJson(res, 200, state.projects.map((project) => ({
        id: project.id,
        canonical: project.worktree,
        time: { created: project.time.created, updated: project.time.initialized || project.time.created },
        sandboxes: [],
      })));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/config') {
      sendJson(res, 200, [{ type: 'directory', path: state.rootPath }, configToV2()]);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/provider') {
      sendJson(res, 200, {
        location: location(),
        data: [
          { id: 'openai', name: 'OpenAI', activation: 'enabled', integrationID: 'openai', package: 'aisdk:@ai-sdk/openai' },
          { id: 'openrouter', name: 'OpenRouter', activation: 'disabled', integrationID: 'openrouter', package: 'aisdk:@openrouter/ai-sdk-provider' },
        ],
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/model') {
      sendJson(res, 200, { location: location(), data: models });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/model/default') {
      sendJson(res, 200, { location: location(), data: models[0] });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/agent') {
      sendJson(res, 200, {
        location: location(),
        data: [
          { id: 'build', name: 'build', mode: 'primary', hidden: false, permissions: [] },
          { id: 'general', name: 'general', mode: 'all', hidden: false, permissions: [] },
        ],
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/integration') {
      sendJson(res, 200, {
        location: location(),
        data: [
          { id: 'openai', name: 'OpenAI', methods: [{ type: 'key', label: 'API key' }], connections: [] },
          { id: 'openrouter', name: 'OpenRouter', methods: [{ type: 'key', label: 'API key' }], connections: [] },
        ],
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/session/active') {
      const active = {};
      for (const [sessionID, status] of Object.entries(state.sessionStatuses)) {
        if (status?.type !== 'idle' && status?.type !== undefined) active[sessionID] = { type: 'running' };
      }
      sendJson(res, 200, { data: active });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/session') {
      sendJson(res, 200, { data: state.sessions.map(sessionToV2), cursor: { next: null, previous: null } });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/session') {
      const body = await readJson(req);
      const directory = body?.location?.directory;
      const session = helpers.createSession(body?.title || '', directory);
      sendJson(res, 200, { data: sessionToV2(session) });
      return;
    }

    if (req.method === 'GET' && /^\/api\/session\/[^/]+$/.test(pathname)) {
      const session = helpers.getSession(pathname.split('/')[3]);
      if (!session) return notFound(res);
      sendJson(res, 200, { data: sessionToV2(session) });
      return;
    }

    if (req.method === 'DELETE' && /^\/api\/session\/[^/]+$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      state.sessions = state.sessions.filter((session) => session.id !== sessionID);
      delete state.messagesBySession[sessionID];
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'PATCH' && /^\/api\/session\/[^/]+$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      const body = await readJson(req);
      const session = helpers.getSession(sessionID);
      if (!session) return notFound(res);
      if (typeof body?.title === 'string') session.title = body.title;
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'GET' && /^\/api\/session\/[^/]+\/message$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      sendJson(res, 200, { data: (state.messagesBySession[sessionID] || []).map(messageToV2), cursor: { next: null, previous: null } });
      return;
    }

    if (req.method === 'GET' && /^\/api\/session\/[^/]+\/diff$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      const userMessages = (state.messagesBySession[sessionID] || []).filter((record) => record.info.role === 'user');
      const latest = userMessages[userMessages.length - 1];
      sendJson(res, 200, { data: latest?.info?.summary?.diffs || [] });
      return;
    }

    if (req.method === 'POST' && /^\/api\/session\/[^/]+\/prompt$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      const body = await readJson(req);
      helpers.handlePromptSubmission(sessionID, { parts: body?.text ? [{ type: 'text', text: body.text }] : [] });
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'POST' && /^\/api\/session\/[^/]+\/interrupt$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      state.sessionStatuses[sessionID] = { type: 'idle' };
      sendJson(res, 200, { interrupted: true });
      return;
    }

    if (req.method === 'POST' && /^\/api\/session\/[^/]+\/command$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      const body = await readJson(req);
      helpers.handleCommand(sessionID, { command: body?.name, arguments: body?.text });
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'POST' && /^\/api\/session\/[^/]+\/(agent|model)$/.test(pathname)) {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'POST' && /^\/api\/session\/[^/]+\/permission\/[^/]+\/reply$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      const requestID = pathname.split('/')[5];
      const body = await readJson(req);
      const request = state.pendingPermissions.find((item) => item.id === requestID);
      if (!request || !['once', 'always', 'reject'].includes(body?.decision)) {
        sendJson(res, 400, { error: 'Invalid permission response' });
        return;
      }
      state.pendingPermissions = state.pendingPermissions.filter((item) => item !== request);
      emitEvent({ type: 'permission.replied', properties: { sessionID: sessionID || request.sessionID, requestID, reply: body.decision } });
      if (body.decision !== 'reject') helpers.scheduleCompletion(sessionID || request.sessionID, 'permission resolved');
      else state.sessionStatuses[sessionID || request.sessionID] = { type: 'idle' };
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'POST' && /^\/api\/session\/[^/]+\/form\/[^/]+\/(reply|cancel)$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      const formID = pathname.split('/')[5];
      const action = pathname.split('/')[6];
      const body = action === 'reply' ? await readJson(req) : undefined;
      const request = state.pendingQuestions.find((item) => item.id === formID);
      if (!request) {
        sendJson(res, 400, { error: 'Invalid question response' });
        return;
      }
      state.pendingQuestions = state.pendingQuestions.filter((item) => item !== request);
      emitEvent({
        type: action === 'reply' ? 'question.replied' : 'question.rejected',
        properties: { sessionID: sessionID || request.sessionID, requestID: formID, ...(body || {}) },
      });
      if (action === 'reply') helpers.scheduleCompletion(sessionID || request.sessionID, `question resolved ${JSON.stringify(body?.answer ?? {})}`);
      else state.sessionStatuses[sessionID || request.sessionID] = { type: 'idle' };
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/api/config/shell') {
      sendJson(res, 200, [{ path: '/bin/bash', name: 'bash', acceptable: true }]);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/command') {
      sendJson(res, 200, { location: location(), data: [{ name: 'review', description: 'Review code' }] });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/mcp') {
      sendJson(res, 200, {
        location: location(),
        data: Object.entries(state.mcpStatuses).map(([name, status]) => ({ name, status: { type: status.status } })),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/vcs') {
      sendJson(res, 200, { location: location(), data: { provider: 'git', branch: { current: 'main', default: 'main' } } });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/vcs/status') {
      sendJson(res, 200, { location: location(), data: [] });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/fs/find') {
      const query = (requestUrl.searchParams.get('query') || '').toLowerCase();
      sendJson(res, 200, {
        location: location(),
        data: Object.keys(state.files).filter((path) => path.toLowerCase().includes(query)).sort().map((path) => ({ path, type: 'file' })),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/fs/list') {
      sendJson(res, 200, { location: location(), data: [] });
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/fs/read/')) {
      const requestedPath = decodeURIComponent(pathname.slice('/api/fs/read/'.length));
      if (!(requestedPath in state.files)) return notFound(res);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(state.files[requestedPath]);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/pty') {
      sendJson(res, 200, { location: location(), data: state.ptys });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/pty') {
      const body = await readJson(req) || {};
      const pty = {
        id: `pty-${state.nextPtyId++}`,
        title: body.title || body.command || 'Terminal',
        command: body.command || '/bin/bash',
        args: Array.isArray(body.args) ? body.args : [],
        cwd: body.cwd || state.project.worktree,
        status: 'running',
        pid: 4000 + state.nextPtyId,
      };
      state.ptys.push(pty);
      sendJson(res, 200, { location: location(), data: pty });
      return;
    }

    if (/^\/api\/pty\/[^/]+$/.test(pathname)) {
      const ptyId = pathname.split('/')[3];
      const index = state.ptys.findIndex((pty) => pty.id === ptyId);
      if (index < 0) return notFound(res);
      if (req.method === 'GET') {
        sendJson(res, 200, { location: location(), data: state.ptys[index] });
        return;
      }
      if (req.method === 'PUT') {
        const body = await readJson(req) || {};
        if (body.title !== undefined) state.ptys[index].title = body.title;
        sendJson(res, 200, { location: location(), data: state.ptys[index] });
        return;
      }
      if (req.method === 'DELETE') {
        state.ptys.splice(index, 1);
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }
    }

    if (req.method === 'POST' && /^\/api\/pty\/[^/]+\/connect-token$/.test(pathname)) {
      const ptyId = pathname.split('/')[3];
      if (req.headers['x-opencode-ticket'] !== '1') {
        sendJson(res, 403, { error: 'PTY ticket header required' });
        return;
      }
      if (!state.ptys.some((pty) => pty.id === ptyId)) return notFound(res);
      sendJson(res, 200, { location: location(), data: { ticket: `ticket-${ptyId}`, expires_in: 60 } });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/worktree') {
      sendJson(res, 200, state.worktrees.map((worktree) => ({ directory: worktree.directory || worktree })));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/permission/request') {
      if (!requireLocation(requestUrl, res)) return;
      sendJson(res, 200, {
        location: location(),
        data: state.pendingPermissions.map((request) => ({
          id: request.id,
          sessionID: request.sessionID,
          action: request.permission,
          resources: request.patterns,
          save: request.always,
          metadata: request.metadata,
        })),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/form') {
      if (!requireLocation(requestUrl, res)) return;
      sendJson(res, 200, { location: location(), data: state.pendingQuestions.map(questionToForm) });
      return;
    }

    notFound(res);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Fake V2 server error' });
  }
});

const ptyWebSockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const match = requestUrl.pathname.match(/^\/api\/pty\/([^/]+)\/connect$/);
  const ptyId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  if (!ptyId || requestUrl.searchParams.get('ticket') !== `ticket-${ptyId}` || !state.ptys.some((pty) => pty.id === ptyId)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  ptyWebSockets.handleUpgrade(req, socket, head, (webSocket) => {
    ptyWebSockets.emit('connection', webSocket, req);
  });
});

ptyWebSockets.on('connection', (socket) => {
  setTimeout(() => {
    if (socket.readyState !== 1) return;
    socket.send(Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({ cursor: 1 }))]));
    socket.send('$ ');
  }, 25);
  socket.on('message', (value) => {
    const command = value.toString().trim();
    socket.send(command ? `ran: ${command}\n$ ` : '$ ');
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Fake OpenCode V2 server listening on http://127.0.0.1:${port} (${scenarioName})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const socket of ptyWebSockets.clients) socket.terminate();
    ptyWebSockets.close();
    server.close(() => process.exit(0));
  });
}
