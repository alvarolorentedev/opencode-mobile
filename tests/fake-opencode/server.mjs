#!/usr/bin/env node

import http from 'node:http';
import { URL } from 'node:url';

import { listProvidersPayload, providerAuthPayload } from './fixtures.mjs';
import { createSessionHelpers } from './session-helpers.mjs';
import { createStateStore, getNow } from './state.mjs';

const port = Number.parseInt(process.env.FAKE_OPENCODE_PORT || '4096', 10);
const scenarioName = process.env.FAKE_OPENCODE_SCENARIO || 'happy-path';

const stateStore = createStateStore(scenarioName);
let state = stateStore.getState();

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
  return helpers.getSession(sessionId);
}

function getMessages(sessionId) {
  return helpers.getMessages(sessionId);
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

const helpers = createSessionHelpers({
  emitEvent,
  getNow,
  getState: () => state,
});
const {
  createSession,
  handlePromptSubmission,
  mergeConfigPatch,
  scheduleCompletion,
  summarizePrompt,
} = helpers;

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
      state = stateStore.resetState(nextScenario);
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
      sendJson(res, 200, listProvidersPayload(state));
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
        session.time.updated = getNow();
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
