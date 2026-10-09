import { filesForDirectory, fileNodes, addWorktree } from './workspace.mjs';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocketServer } from 'ws';
import { createTerminalFixture } from './terminal.mjs';

import { createSessionHelpers } from './session-helpers.mjs';
import { createStateStore, getNow, resolveProject } from './state.mjs';

const port = Number.parseInt(process.env.FAKE_OPENCODE_PORT || '4096', 10);
const scenarioName = process.env.FAKE_OPENCODE_SCENARIO || 'happy-path';

const stateStore = createStateStore(scenarioName);
let state = stateStore.getState();
const terminalFixture = createTerminalFixture((id) => { const pty = state.ptys.find((item) => item.id === id); if (pty) pty.status = 'exited'; });
let suppressEvents = false;
const v2Clients = new Set();
// VCS diff fixtures. `working` mirrors uncommitted changes; `branch` is a
// distinct committed fixture so the diff-scope surface is deterministic.
const workingPatch = 'diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-export const demo = "OpenCode 1.18.3";\n+export const demo = "OpenCode SDK 1.18.3";\n';
const branchPatch = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,4 @@\n # Demo project\n \n Deterministic fake OpenCode workspace.\n+Committed on this branch.\n';

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

// Optional HTTP Basic auth for public/shared deployments. Disabled unless
// FAKE_OPENCODE_BASIC_AUTH is set (format "user:password"; a value without a
// colon treats the whole value as the password for the default "opencode"
// user), so the test suites and local E2E runs stay unauthenticated.
const basicAuthCredential = (process.env.FAKE_OPENCODE_BASIC_AUTH || '').trim();
const basicAuthHeader = (() => {
  if (!basicAuthCredential) return undefined;
  const separator = basicAuthCredential.indexOf(':');
  const username = separator === -1 ? 'opencode' : basicAuthCredential.slice(0, separator);
  const password = separator === -1 ? basicAuthCredential : basicAuthCredential.slice(separator + 1);
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
})();

function isAuthorized(req) {
  return basicAuthHeader === undefined || req.headers.authorization === basicAuthHeader;
}

function unauthorized(res) {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Basic realm="fake-opencode"',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-opencode-ticket',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}

// Connection setup probes health/info before any credentials exist. Real
// OpenCode servers answer these without auth; mirror that so the client can
// resolve the contract and reach the credentials step. Every other route stays
// behind FAKE_OPENCODE_BASIC_AUTH when it is set.
const publicProbePaths = new Set(['/api/info', '/api/health', '/global/health']);

function location() {
  return { directory: state.project.worktree };
}

// The V2 adapter must scope form/permission lists and every VCS read to the
// active project directory. The real server answers unscoped calls with its own
// location's state (usually an empty diff), so reject them here and make the
// client-side scoping observable instead of silently wrong.
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
  const session = state.sessions.find((entry) => entry.id === (data.sessionID || data.form?.sessionID));
  return {
    id: `event-${state.nextEventId++}`,
    created: Date.now(),
    type,
    location: { directory: session?.directory || state.project.worktree },
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
    case 'session.retry.scheduled':
      return event('session.retry.scheduled', {
        sessionID: properties.sessionID,
        assistantMessageID: properties.assistantMessageID,
        attempt: properties.attempt,
        at: properties.at,
        error: properties.error,
      });
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

function emitV2Event(mapped) {
  if (suppressEvents) return;
  const payload = `data: ${JSON.stringify(mapped)}\n\n`;
  for (const client of v2Clients) {
    client.write(payload);
  }
}

function emitEvent(eventMessage) {
  const mapped = translate(eventMessage);
  if (mapped) emitV2Event(mapped);
}

const helpers = createSessionHelpers({ emitEvent, getNow, getState: () => state });


function deliverInboxItem(item) {
  state.inboxBySession[item.sessionID] = (state.inboxBySession[item.sessionID] || []).filter((entry) => entry.id !== item.id);
  state.activePromptBySession[item.sessionID] = item.payload.text;
  helpers.handlePromptSubmission(item.sessionID, {
    messageID: item.id,
    parts: [
      ...(item.payload.text ? [{ type: 'text', text: item.payload.text }] : []),
      ...(item.payload.files || []).map((file) => ({ type: 'file', url: `data:${file.mime};base64,${file.data}`, mime: file.mime, filename: file.name })),
    ],
  });
  emitV2Event(event('session.inbox.delivered', { sessionID: item.sessionID, inboxID: item.id }));
}

const FAKE_MODEL = { id: 'gpt-4.1-mini', providerID: 'openai' };
// Deterministic per-assistant-call usage so V2 e2e can assert context
// utilization. Non-zero values prove the adapter carries model/tokens/cost;
// session totals accumulate them the way the real server does.
const ASSISTANT_USAGE = { input: 1200, output: 240, reasoning: 0, cache: { read: 800, write: 100 } };
const ASSISTANT_COST = 0.0021;

function sessionUsage(sessionID) {
  const usage = { input: 0, output: 0, reasoning: 0, cost: 0, cache: { read: 0, write: 0 } };
  for (const record of state.messagesBySession[sessionID] || []) {
    if (record.info.role !== 'assistant') continue;
    usage.input += ASSISTANT_USAGE.input;
    usage.output += ASSISTANT_USAGE.output;
    usage.reasoning += ASSISTANT_USAGE.reasoning;
    usage.cache.read += ASSISTANT_USAGE.cache.read;
    usage.cache.write += ASSISTANT_USAGE.cache.write;
    usage.cost += ASSISTANT_COST;
  }
  return usage;
}

function sessionToV2(session) {
  const usage = sessionUsage(session.id);
  return {
    id: session.id,
    projectID: session.projectID || state.project.id,
    title: session.title || '',
    time: { created: session.time.created, updated: session.time.updated },
    location: { directory: session.directory || state.project.worktree },
    model: session.model || FAKE_MODEL,
    ...(session.agent ? { agent: session.agent } : {}),
    cost: usage.cost,
    tokens: { input: usage.input, output: usage.output, reasoning: usage.reasoning, cache: usage.cache },
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
      files: parts.filter((part) => part.type === 'file').map((part) => {
        const match = part.url?.match(/^data:([^;,]+);base64,([\s\S]*)$/);
        return { name: part.filename, mime: part.mime, data: match?.[2] || '', source: { type: 'inline' } };
      }),
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
    model: state.sessions.find((session) => session.id === record.info.sessionID)?.model || FAKE_MODEL,
    content,
    cost: ASSISTANT_COST,
    tokens: { input: ASSISTANT_USAGE.input, output: ASSISTANT_USAGE.output, reasoning: ASSISTANT_USAGE.reasoning, cache: { ...ASSISTANT_USAGE.cache } },
    finish: 'stop',
    ...(record.info.error ? { error: record.info.error } : {}),
    ...(record.info.retry ? { retry: record.info.retry } : {}),
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

const providerCatalog = [
  { id: 'openai', name: 'OpenAI', activation: 'auto', integrationID: 'openai', package: 'aisdk:@ai-sdk/openai' },
  { id: 'openrouter', name: 'OpenRouter', activation: 'auto', integrationID: 'openrouter', package: 'aisdk:@openrouter/ai-sdk-provider' },
  { id: 'opencode-go', name: 'OpenCode Go', activation: 'auto', integrationID: 'opencode-go', package: 'aisdk:@ai-sdk/openai-compatible' },
];

function modelCatalog() {
  return [models[0], ...providerCatalog.slice(1).map((provider) => ({
    ...models[0], id: `${provider.id}/coding-model`, modelID: 'coding-model',
    providerID: provider.id, name: `${provider.name} coding model`,
    enabled: state.configuredProviderIds.has(provider.id),
  }))];
}

let connectionPassword = process.env.FAKE_OPENCODE_PASSWORD || '';
let pairingCode;
let pairingToken;
let pairingSequence = 0;

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

    if (!publicProbePaths.has(pathname) && !isAuthorized(req)) {
      unauthorized(res);
      return;
    }

    // Keep the transport connected while dropping domain events, or close it
    // without resetting server state to reproduce missed-event recovery.
    if (req.method === 'POST' && pathname === '/__control/event-stream') {
      const body = await readJson(req);
      suppressEvents = Boolean(body?.suppress);
      if (body?.disconnect) {
        for (const client of v2Clients) client.end();
        v2Clients.clear();
      }
      sendJson(res, 200, { data: { suppressEvents, clients: v2Clients.size } });
      return;
    }

    if (pathname === '/__control/terminal') {
      if (req.method === 'POST') terminalFixture.control(await readJson(req));
      sendJson(res, 200, { data: terminalFixture.snapshot() });
      return;
    }

    if (req.method === 'POST' && pathname === '/__control/reset') {
      terminalFixture.reset();
      const body = await readJson(req);
      for (const client of v2Clients) client.end();
      v2Clients.clear();
      suppressEvents = false;
      state = stateStore.resetState(body?.scenario || scenarioName);
      connectionPassword = body?.password ?? process.env.FAKE_OPENCODE_PASSWORD ?? '';
      pairingCode = undefined;
      pairingToken = undefined;
      sendJson(res, 200, { data: { scenario: state.scenario } });
      return;
    }

    if (req.method === 'GET' && pathname === '/__control/instructions') {
      sendJson(res, 200, { data: state.instructionsBySession });
      return;
    }

    if (req.method === 'POST' && pathname === '/__control/pairing') {
      const body = await readJson(req);
      if (body?.password !== undefined) connectionPassword = body.password;
      pairingCode = { value: `local-code-${++pairingSequence}`, expiresAt: body?.expired ? 0 : Date.now() + 300_000 };
      sendJson(res, 200, { code: pairingCode.value, expires_in: 300 });
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/auth/connect/')) {
      if (!pairingCode || pairingCode.expiresAt <= Date.now() || pathname !== `/auth/connect/${pairingCode.value}`) {
        sendJson(res, 401, { _tag: 'UnauthorizedError', message: 'Pairing link expired or already used' });
        return;
      }
      pairingCode = undefined;
      pairingToken = `local-session-${pairingSequence}`;
      sendJson(res, 200, { token: pairingToken });
      return;
    }
    if (connectionPassword) {
      const valid = [connectionPassword, pairingToken].filter(Boolean).some((secret) => req.headers.authorization === `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}`);
      if (!valid) { sendJson(res, 401, { _tag: 'UnauthorizedError', message: 'Authentication required' }); return; }
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

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { healthy: true, version: '2.0.0-fake' });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/location') {
      const project = resolveProject(state, requestUrl.searchParams.get('location[directory]'));
      if (!project) { sendJson(res, 400, { error: 'Directory is outside the server workspace.' }); return; }
      sendJson(res, 200, { directory: requestUrl.searchParams.get('location[directory]') || project.worktree, project: { id: project.id, directory: project.worktree, canonical: project.worktree } });
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
        data: providerCatalog.filter((provider) => state.configuredProviderIds.has(provider.id)),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/model') {
      sendJson(res, 200, { location: location(), data: modelCatalog().filter((model) => model.enabled) });
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
        data: providerCatalog.map((provider) => ({
          id: provider.integrationID, name: provider.name,
          methods: [{ type: 'env', names: ['PROVIDER_API_KEY'] }, { type: 'key', label: 'API key' }],
          connections: state.credentials
            .filter((credential) => credential.integrationID === provider.integrationID)
            .map((credential) => ({ type: 'credential', id: credential.id, label: credential.label, method: 'key' })),
        })),
      });
      return;
    }

    const keyConnect = pathname.match(/^\/api\/integration\/([^/]+)\/connect\/key$/);
    if (req.method === 'POST' && keyConnect) {
      if (!requireLocation(requestUrl, res)) return;
      const integrationID = decodeURIComponent(keyConnect[1]);
      const provider = providerCatalog.find((item) => item.integrationID === integrationID);
      const body = await readJson(req);
      if (!provider || !body?.key?.trim()) {
        sendJson(res, 400, { error: 'A known integration and API key are required' });
        return;
      }
      state.configuredProviderIds.add(provider.id);
      state.authByProvider[provider.id] = { type: 'api', key: body.key };
      const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : 'API key';
      const existing = state.credentials.find((credential) => credential.integrationID === integrationID && credential.label === label);
      state.credentials.forEach((credential) => { if (credential.integrationID === integrationID) credential.active = false; });
      if (existing) {
        existing.active = true;
        existing.value = { type: 'key', key: body.key };
      } else {
        state.credentials.push({ id: `credential-${integrationID}-${state.credentials.length + 1}`, integrationID, label, active: true, value: { type: 'key', key: body.key } });
      }
      sendJson(res, 204);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/credential') {
      sendJson(res, 200, { data: state.credentials });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/credential') {
      const body = await readJson(req);
      if (!body?.integrationID || !body?.value) {
        sendJson(res, 400, { error: 'integrationID and value are required' });
        return;
      }
      const activate = body.activate === true || (body.activate !== false && !state.credentials.some((credential) => credential.integrationID === body.integrationID && credential.active));
      if (activate) state.credentials.forEach((credential) => { if (credential.integrationID === body.integrationID) credential.active = false; });
      const credential = { id: body.id || `credential-${body.integrationID}-${state.credentials.length + 1}`, integrationID: body.integrationID, label: body.label || 'API key', active: activate, value: body.value };
      state.credentials.push(credential);
      sendJson(res, 200, { data: credential });
      return;
    }

    const activateMatch = pathname.match(/^\/api\/credential\/([^/]+)\/activate$/);
    if (req.method === 'POST' && activateMatch) {
      const credentialID = decodeURIComponent(activateMatch[1]);
      const target = state.credentials.find((credential) => credential.id === credentialID);
      if (target) {
        state.credentials.forEach((credential) => {
          if (credential.integrationID === target.integrationID) credential.active = credential.id === credentialID;
        });
      }
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    const credentialMatch = pathname.match(/^\/api\/credential\/([^/]+)$/);
    if (req.method === 'PATCH' && credentialMatch) {
      const body = await readJson(req);
      const target = state.credentials.find((credential) => credential.id === decodeURIComponent(credentialMatch[1]));
      if (target && typeof body?.label === 'string') target.label = body.label;
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'DELETE' && credentialMatch) {
      const credentialID = decodeURIComponent(credentialMatch[1]);
      state.credentials = state.credentials.filter((credential) => credential.id !== credentialID);
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/api/session/active') {
      const active = {};
      for (const [sessionID, status] of Object.entries(state.sessionStatuses)) {
        // The running set excludes retries, matching the real server. The app
        // must preserve the event-derived retry across this list refresh.
        if (status?.type === 'busy') active[sessionID] = { type: 'running' };
      }
      sendJson(res, 200, { data: active });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/session') {
      const directory = requestUrl.searchParams.get('directory');
      const sessions = directory ? state.sessions.filter((session) => session.directory === directory) : state.sessions;
      sendJson(res, 200, { data: sessions.map(sessionToV2), cursor: { next: null, previous: null } });
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
      const cursor = requestUrl.searchParams.get('cursor');
      if (cursor && requestUrl.searchParams.has('order')) return sendJson(res, 400, { error: 'cursor and order cannot be combined' });
      const position = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : { offset: 0, order: requestUrl.searchParams.get('order') || 'desc' };
      const limit = Number(requestUrl.searchParams.get('limit') || 200);
      const messages = (state.messagesBySession[sessionID] || []).map(messageToV2);
      if (position.order === 'desc') messages.reverse();
      const data = messages.slice(position.offset, position.offset + limit);
      const next = position.offset + limit < messages.length ? Buffer.from(JSON.stringify({ ...position, offset: position.offset + limit })).toString('base64url') : null;
      sendJson(res, 200, { data, cursor: { next, previous: null } });
      return;
    }

    if (req.method === 'GET' && /^\/api\/session\/[^/]+\/diff$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      const messageID = requestUrl.searchParams.get('messageID');
      const userMessages = (state.messagesBySession[sessionID] || []).filter((record) => record.info.role === 'user');
      const target = messageID
        ? userMessages.find((record) => record.info.id === messageID)
        : userMessages[userMessages.length - 1];
      sendJson(res, 200, { data: target?.info?.summary?.diffs || [] });
      return;
    }

    if (req.method === 'GET' && /^\/api\/session\/[^/]+\/inbox$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      if (!helpers.getSession(sessionID)) return notFound(res);
      sendJson(res, 200, { data: state.inboxBySession[sessionID] || [] });
      return;
    }

    const inboxItemPath = pathname.match(/^\/api\/session\/([^/]+)\/inbox\/([^/]+)$/);
    if (inboxItemPath && (req.method === 'DELETE' || req.method === 'PATCH')) {
      const [, sessionID, inboxID] = inboxItemPath;
      const item = (state.inboxBySession[sessionID] || []).find((entry) => entry.id === inboxID);
      if (!item) return notFound(res);
      if (req.method === 'DELETE') {
        state.inboxBySession[sessionID] = state.inboxBySession[sessionID].filter((entry) => entry.id !== inboxID);
        emitV2Event(event('session.inbox.cancelled', { sessionID, inboxID }));
      } else {
        const body = await readJson(req);
        if (!['steer', 'queue'].includes(body?.delivery)) return sendJson(res, 400, { error: 'Invalid delivery' });
        item.delivery = body.delivery;
        emitV2Event(event('session.inbox.delivery.changed', { sessionID, inboxID, delivery: item.delivery }));
      }
      sendJson(res, 204);
      return;
    }

    if (req.method === 'POST' && pathname === '/__control/inbox') {
      const body = await readJson(req);
      const sessionID = body.sessionID;
      if (!helpers.getSession(sessionID)) return notFound(res);
      if (body.action === 'complete') helpers.completePrompt(sessionID, state.activePromptBySession[sessionID]);
      const pending = state.inboxBySession[sessionID] || [];
      const item = pending.find((entry) => body.action === 'complete' || entry.delivery === 'steer');
      if (item) deliverInboxItem(item);
      sendJson(res, 200, { data: state.inboxBySession[sessionID] || [] });
      return;
    }

    if (req.method === 'POST' && /^\/api\/session\/[^/]+\/prompt$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      if (!helpers.getSession(sessionID)) return notFound(res);
      const body = await readJson(req);
      const files = (body?.files || []).map((file) => {
        const match = file.uri?.match(/^data:([^;,]+);base64,([\s\S]*)$/);
        return { name: file.name, mime: match?.[1] || 'application/octet-stream', data: match?.[2] || '', source: { type: 'inline' } };
      });
      const item = {
        id: `message-${state.nextMessageId++}`, sessionID, type: 'user',
        payload: { text: body?.text || '', files }, delivery: body?.delivery || 'steer', time: { created: getNow() },
      };
      state.inboxBySession[sessionID] = [...(state.inboxBySession[sessionID] || []), item];
      emitV2Event(event('session.inbox.enqueued', { sessionID, inboxID: item.id, item: { type: 'user', payload: item.payload, delivery: item.delivery } }));
      if (state.scenario !== 'inbox' || state.sessionStatuses[sessionID]?.type === 'idle') deliverInboxItem(item);
      sendJson(res, 200, { data: item });
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
      const sessionID = pathname.split('/')[3];
      const body = await readJson(req);
      const session = helpers.getSession(sessionID);
      if (session) {
        if (pathname.endsWith('/model') && body?.model) session.model = body.model;
        if (pathname.endsWith('/agent') && body?.agent) session.agent = body.agent;
      }
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }

    // Session-scoped instruction entries are the V2 replacement for the V1
    // prompt `system` field. The adapter writes chat preferences here.
    if (pathname.startsWith('/api/experimental/session/') && pathname.includes('/instructions/entries')) {
      const match = pathname.match(/^\/api\/experimental\/session\/([^/]+)\/instructions\/entries(?:\/([^/]+))?$/);
      if (!match) return notFound(res);
      const sessionID = match[1];
      const key = match[2] ? decodeURIComponent(match[2]) : undefined;
      if (!helpers.getSession(sessionID)) return notFound(res);
      const entries = state.instructionsBySession[sessionID] || (state.instructionsBySession[sessionID] = {});
      if (req.method === 'GET' && !key) {
        sendJson(res, 200, { data: Object.entries(entries).map(([entryKey, value]) => ({ key: entryKey, value })) });
        return;
      }
      if (req.method === 'PUT' && key) {
        const body = await readJson(req);
        entries[key] = body?.value;
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }
      if (req.method === 'DELETE' && key) {
        delete entries[key];
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }
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
      if (!requireLocation(requestUrl, res)) return;
      sendJson(res, 200, { location: location(), data: { provider: 'git', branch: { current: 'main', default: 'main' } } });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/vcs/status') {
      if (!requireLocation(requestUrl, res)) return;
      sendJson(res, 200, { location: location(), data: [] });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/vcs/diff') {
      if (!requireLocation(requestUrl, res)) return;
      const mode = requestUrl.searchParams.get('mode');
      if (!['working', 'branch', 'committed'].includes(mode)) {
        sendJson(res, 400, { error: 'VCS diff requires mode' });
        return;
      }
      if (mode === 'branch') {
        sendJson(res, 200, { location: location(), data: [{ file: 'README.md', patch: branchPatch, additions: 1, deletions: 0, status: 'modified' }] });
        return;
      }
      sendJson(res, 200, {
        location: location(),
        data: state.files['src/demo.ts'].includes('SDK')
          ? [{ file: 'src/demo.ts', patch: workingPatch, additions: 1, deletions: 1, status: 'modified' }]
          : [],
      });
      return;
    }

    if (req.method === 'GET' && ['/api/fs/find', '/api/fs/list'].includes(pathname)) {
      const directory = requireLocation(requestUrl, res);
      if (!directory) return;
      const files = filesForDirectory(state, directory);
      if (!files) { sendJson(res, 400, { error: 'Unknown workspace' }); return; }
      const query = (requestUrl.searchParams.get('query') || '').toLowerCase();
      const entries = pathname === '/api/fs/find'
        ? Object.keys(files).filter((path) => path.toLowerCase().includes(query)).sort().map((path) => ({ path, type: 'file' }))
        : fileNodes(files, directory, requestUrl.searchParams.get('path') || '').map(({ path, type }) => ({ path, type }));
      sendJson(res, 200, { location: { directory }, data: entries });
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/fs/read/')) {
      const directory = requireLocation(requestUrl, res);
      if (!directory) return;
      const files = filesForDirectory(state, directory);
      if (!files) { sendJson(res, 400, { error: 'Unknown workspace' }); return; }
      const requestedPath = decodeURIComponent(pathname.slice('/api/fs/read/'.length));
      if (!(requestedPath in files)) return notFound(res);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(files[requestedPath]);
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
        if (body.size) terminalFixture.get(ptyId).size = body.size;
        if (body.title !== undefined) state.ptys[index].title = body.title;
        sendJson(res, 200, { location: location(), data: state.ptys[index] });
        return;
      }
      if (req.method === 'DELETE') {
        if (terminalFixture.get(ptyId).failTerminate) { terminalFixture.get(ptyId).failTerminate = false; sendJson(res, 500, { error: 'Termination failed' }); return; }
        terminalFixture.remove(ptyId);
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

    if (pathname === '/api/worktree') {
      const body = req.method === 'GET' ? {} : await readJson(req);
      const projectID = requestUrl.searchParams.get('projectID') || body?.projectID;
      if (!state.projects.some((entry) => entry.id === projectID)) { sendJson(res, 400, { error: 'A projectID is required' }); return; }
      if (req.method === 'GET') {
        sendJson(res, 200, state.worktrees.filter((entry) => entry.projectID === projectID).map(({ directory }) => ({ directory })));
      } else if (req.method === 'POST') {
        try { const entry = addWorktree(state, projectID, body.name); sendJson(res, 200, { directory: entry.directory }); }
        catch (error) { sendJson(res, 400, { error: error.message }); }
      } else if (req.method === 'DELETE') {
        const index = state.worktrees.findIndex((entry) => entry.directory === body.directory && entry.projectID === projectID);
        if (index < 0) { notFound(res); return; }
        state.worktrees.splice(index, 1);
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); res.end();
      } else notFound(res);
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
  if (!isAuthorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="fake-opencode"\r\n\r\n');
    socket.destroy();
    return;
  }
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

ptyWebSockets.on('connection', (socket, request) => terminalFixture.connect(socket, request));

server.listen(port, '127.0.0.1', () => {
  console.log(`Fake OpenCode V2 server listening on http://127.0.0.1:${port} (${scenarioName})${basicAuthHeader ? ' [basic auth]' : ''}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const socket of ptyWebSockets.clients) socket.terminate();
    ptyWebSockets.close();
    server.close(() => process.exit(0));
  });
}
