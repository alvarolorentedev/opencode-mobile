#!/usr/bin/env node

import http from 'node:http';
import { URL } from 'node:url';

import {
  commandsPayload,
  diagnosticsPayload,
  fileStatusesPayload,
  listProvidersPayload,
  providerAuthPayload,
  vcsPayload,
} from './fixtures.mjs';
import { createSessionHelpers } from './session-helpers.mjs';
import { createStateStore, getNow } from './state.mjs';

const port = Number.parseInt(process.env.FAKE_OPENCODE_PORT || '4096', 10);
const scenarioName = process.env.FAKE_OPENCODE_SCENARIO || 'happy-path';
const supportedScenarios = new Set(['happy-path', 'permission', 'question', 'stream-disconnect']);
const configuredBasePath = (process.env.FAKE_OPENCODE_BASE_PATH || '').trim();
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+/, '').replace(/\/+$/, '')}`
  : '';

if (!supportedScenarios.has(scenarioName)) {
  throw new Error(`Unsupported fake OpenCode scenario: ${scenarioName}`);
}

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

  const payload = `data: ${JSON.stringify({
    directory: state.project.worktree,
    payload: { id: `event-${state.nextEventId++}`, ...event },
  })}\n\n`;
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
  forkSession,
  handleCommand,
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
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({
    directory: state.project.worktree,
    payload: { type: 'server.connected', properties: {} },
  })}\n\n`);
  state.sseClients.add(res);
  req.on('close', () => {
    state.sseClients.delete(res);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const incomingPathname = requestUrl.pathname;
  const pathname = basePath && incomingPathname.startsWith(`${basePath}/`)
    ? incomingPathname.slice(basePath.length)
    : incomingPathname === basePath
      ? '/'
      : incomingPathname;

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

    if (basePath && !incomingPathname.startsWith(`${basePath}/`) && incomingPathname !== basePath) {
      if (req.method === 'GET' && incomingPathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body><h1>Fake OpenCode UI</h1></body></html>');
        return;
      }

      notFound(res);
      return;
    }

    if (req.method === 'POST' && pathname === '/__control/reset') {
      const body = await readJson(req);
      const nextScenario = body?.scenario || scenarioName;
      if (!supportedScenarios.has(nextScenario)) {
        sendJson(res, 400, { error: `Unsupported scenario: ${nextScenario}` });
        return;
      }
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
      const body = await readJson(req);
      if (!Number.isInteger(body?.method)) {
        sendJson(res, 400, { error: 'OAuth authorize requires method' });
        return;
      }
      sendJson(res, 200, {
        url: 'https://example.test/oauth/complete',
        instructions: 'Fake OAuth completed in CI.',
        method: body?.method === 0 ? 'code' : 'auto',
      });
      return;
    }

    if (req.method === 'POST' && /^\/provider\/[^/]+\/oauth\/callback$/.test(pathname)) {
      const providerId = pathname.split('/')[2];
      const body = await readJson(req);
      if (!Number.isInteger(body?.method)) {
        sendJson(res, 400, { error: 'OAuth callback requires method' });
        return;
      }
      state.configuredProviderIds.add(providerId);
      sendJson(res, 200, { ok: true, code: body?.code });
      return;
    }

    if (req.method === 'PUT' && /^\/auth\/[^/]+$/.test(pathname)) {
      const providerId = pathname.split('/')[2];
      const body = await readJson(req);
      if (!body?.type || body?.auth) {
        sendJson(res, 400, { error: 'Auth body must be a raw Auth value' });
        return;
      }
      state.authByProvider[providerId] = body;
      state.configuredProviderIds.add(providerId);
      mergeConfigPatch({
        enabled_providers: [...state.configuredProviderIds],
        provider: {
          [providerId]: body || { type: 'api' },
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

    if (req.method === 'GET' && pathname === '/global/health') {
      sendJson(res, 200, { healthy: true, version: '1.18.3' });
      return;
    }

    if (req.method === 'GET' && pathname === '/command') {
      sendJson(res, 200, commandsPayload());
      return;
    }

    if (req.method === 'GET' && pathname === '/find/file') {
      const query = (requestUrl.searchParams.get('query') || '').toLowerCase();
      sendJson(res, 200, Object.keys(state.files).filter((path) => path.toLowerCase().includes(query)).sort());
      return;
    }

    if (req.method === 'GET' && pathname === '/file/content') {
      const requestedPath = requestUrl.searchParams.get('path') || '';
      if (!(requestedPath in state.files)) {
        notFound(res);
        return;
      }
      sendJson(res, 200, { type: 'text', content: state.files[requestedPath] });
      return;
    }

    if (req.method === 'GET' && pathname === '/file/status') {
      sendJson(res, 200, fileStatusesPayload());
      return;
    }

    if (req.method === 'GET' && pathname === '/vcs') {
      sendJson(res, 200, vcsPayload());
      return;
    }

    const diagnostics = diagnosticsPayload();
    if (req.method === 'GET' && pathname === '/mcp') {
      sendJson(res, 200, diagnostics.mcp);
      return;
    }
    if (req.method === 'GET' && pathname === '/lsp') {
      sendJson(res, 200, diagnostics.lsp);
      return;
    }
    if (req.method === 'GET' && pathname === '/formatter') {
      sendJson(res, 200, diagnostics.formatter);
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

    if (req.method === 'GET' && /^\/session\/[^/]+$/.test(pathname)) {
      const session = getSession(pathname.split('/')[2]);
      if (!session) {
        notFound(res);
        return;
      }
      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'DELETE' && /^\/session\/[^/]+$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      const sessionIndex = state.sessions.findIndex((entry) => entry.id === sessionId);
      if (sessionIndex < 0) {
        notFound(res);
        return;
      }
      const deletedSession = state.sessions[sessionIndex];
      state.sessions.splice(sessionIndex, 1);
      delete state.messagesBySession[sessionId];
      delete state.diffsBySession[sessionId];
      delete state.todosBySession[sessionId];
      delete state.sessionStatuses[sessionId];
      state.pendingPermissions = state.pendingPermissions.filter((entry) => entry.sessionID !== sessionId);
      state.pendingQuestions = state.pendingQuestions.filter((entry) => entry.sessionID !== sessionId);
      emitEvent({ type: 'session.deleted', properties: { info: deletedSession } });
      sendJson(res, 200, true);
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
      if (pathname.endsWith('/prompt_async')) {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        res.end();
      } else {
        sendJson(res, 200, { accepted: true });
      }
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

    if (req.method === 'POST' && /^\/session\/[^/]+\/command$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      if (!getSession(sessionId)) {
        notFound(res);
        return;
      }
      sendJson(res, 200, handleCommand(sessionId, await readJson(req)));
      return;
    }

    if (req.method === 'POST' && /^\/session\/[^/]+\/fork$/.test(pathname)) {
      const sourceId = pathname.split('/')[2];
      const body = await readJson(req);
      const forked = forkSession(sourceId, body?.messageID);
      if (!forked) {
        notFound(res);
        return;
      }
      sendJson(res, 200, forked);
      return;
    }

    if (req.method === 'POST' && /^\/session\/[^/]+\/share$/.test(pathname)) {
      const session = getSession(pathname.split('/')[2]);
      if (!session) {
        notFound(res);
        return;
      }
      session.share = { url: `https://share.example.test/${session.id}` };
      session.time.updated = getNow();
      emitEvent({ type: 'session.updated', properties: { info: session } });
      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'DELETE' && /^\/session\/[^/]+\/share$/.test(pathname)) {
      const session = getSession(pathname.split('/')[2]);
      if (!session) {
        notFound(res);
        return;
      }
      delete session.share;
      session.time.updated = getNow();
      emitEvent({ type: 'session.updated', properties: { info: session } });
      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'POST' && /^\/session\/[^/]+\/revert$/.test(pathname)) {
      const session = getSession(pathname.split('/')[2]);
      const body = await readJson(req);
      if (!session || !body?.messageID) {
        sendJson(res, 400, { error: 'Revert requires a session and messageID' });
        return;
      }
      session.revert = { messageID: body.messageID, ...(body.partID ? { partID: body.partID } : {}) };
      session.time.updated = getNow();
      emitEvent({ type: 'session.updated', properties: { info: session } });
      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'POST' && /^\/session\/[^/]+\/unrevert$/.test(pathname)) {
      const session = getSession(pathname.split('/')[2]);
      if (!session) {
        notFound(res);
        return;
      }
      delete session.revert;
      session.time.updated = getNow();
      emitEvent({ type: 'session.updated', properties: { info: session } });
      sendJson(res, 200, session);
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

      if (typeof body?.title !== 'string' || !body.title.trim()) {
        sendJson(res, 400, { error: 'Session update requires title' });
        return;
      }
      session.title = body.title.trim();
      session.time.updated = getNow();
      emitEvent({ type: 'session.updated', properties: { info: session } });
      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'GET' && pathname === '/permission') {
      sendJson(res, 200, state.pendingPermissions);
      return;
    }

    if (req.method === 'POST' && /^\/permission\/[^/]+\/reply$/.test(pathname)) {
      const permissionId = pathname.split('/')[2];
      const body = await readJson(req);
      const request = state.pendingPermissions.find((entry) => entry.id === permissionId);
      if (!request || !['once', 'always', 'reject'].includes(body?.reply)) {
        sendJson(res, 400, { error: 'Invalid permission response' });
        return;
      }
      state.pendingPermissions = state.pendingPermissions.filter((entry) => entry !== request);
      emitEvent({
        type: 'permission.replied',
        properties: { sessionID: request.sessionID, requestID: permissionId, reply: body.reply },
      });
      if (body.reply !== 'reject') scheduleCompletion(request.sessionID, 'permission resolved');
      else state.sessionStatuses[request.sessionID] = { type: 'idle' };
      sendJson(res, 200, true);
      return;
    }

    if (req.method === 'GET' && pathname === '/question') {
      sendJson(res, 200, state.pendingQuestions);
      return;
    }

    if (req.method === 'POST' && /^\/question\/[^/]+\/(reply|reject)$/.test(pathname)) {
      const [, , questionId, action] = pathname.split('/');
      const request = state.pendingQuestions.find((entry) => entry.id === questionId);
      const body = action === 'reply' ? await readJson(req) : undefined;
      if (!request || (action === 'reply' && !Array.isArray(body?.answers))) {
        sendJson(res, 400, { error: 'Invalid question response' });
        return;
      }
      state.pendingQuestions = state.pendingQuestions.filter((entry) => entry !== request);
      emitEvent({
        type: action === 'reply' ? 'question.replied' : 'question.rejected',
        properties: { sessionID: request.sessionID, requestID: questionId, ...(body || {}) },
      });
      if (action === 'reply') scheduleCompletion(request.sessionID, `selected ${body.answers.flat().join(', ')}`);
      else state.sessionStatuses[request.sessionID] = { type: 'idle' };
      sendJson(res, 200, true);
      return;
    }

    if (req.method === 'GET' && pathname === '/global/event') {
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
