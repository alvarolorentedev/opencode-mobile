#!/usr/bin/env node

import http from 'node:http';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';

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
const applicablePatch = 'diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-export const demo = "OpenCode 1.18.3";\n+export const demo = "OpenCode SDK 1.18.3";\n';
const editorPatch = '--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1,1 +1,1 @@\n-export const demo = "OpenCode 1.18.3";\n+export const demo = "OpenCode SDK 1.18.3";\n';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-opencode-directory, x-opencode-ticket',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function badRequest(res, error) {
  sendJson(res, 400, { error });
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
    payload: { id: `event-${state.nextEventId++}`, type: 'server.connected', properties: {} },
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-opencode-directory, x-opencode-ticket',
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
      const patch = await readJson(req);
      if (patch?.mcp) {
        for (const [name, config] of Object.entries(patch.mcp)) {
          if (config === null) {
            badRequest(res, 'MCP config entries cannot be null');
            return;
          } else {
            state.mcpRuntimeConfigs[name] = config;
            state.mcpStatuses[name] = { status: config.enabled === false ? 'disabled' : 'connected' };
          }
        }
      }
      mergeConfigPatch(patch);
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

    if (req.method === 'GET' && pathname === '/find') {
      const pattern = requestUrl.searchParams.get('pattern');
      if (!pattern) {
        badRequest(res, 'Find text requires pattern');
        return;
      }
      const matches = [];
      for (const [path, content] of Object.entries(state.files)) {
        let offset = 0;
        for (const [index, line] of content.split('\n').entries()) {
          const start = line.toLowerCase().indexOf(pattern.toLowerCase());
          if (start >= 0) {
            matches.push({
              path: { text: path },
              lines: { text: line },
              line_number: index + 1,
              absolute_offset: offset + start,
              submatches: [{ match: { text: line.slice(start, start + pattern.length) }, start, end: start + pattern.length }],
            });
          }
          offset += line.length + 1;
        }
      }
      sendJson(res, 200, matches);
      return;
    }

    if (req.method === 'GET' && pathname === '/find/symbol') {
      const query = requestUrl.searchParams.get('query');
      if (!query) {
        badRequest(res, 'Find symbols requires query');
        return;
      }
      const symbols = [{
        name: 'feature',
        kind: 12,
        location: {
          uri: `file://${state.project.worktree}/src/feature.ts`,
          range: { start: { line: 0, character: 16 }, end: { line: 0, character: 23 } },
        },
      }];
      sendJson(res, 200, symbols.filter((symbol) => symbol.name.toLowerCase().includes(query.toLowerCase())));
      return;
    }

    if (req.method === 'GET' && pathname === '/file') {
      const requestedPath = (requestUrl.searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');
      const prefix = requestedPath ? `${requestedPath}/` : '';
      const nodes = new Map();
      for (const path of Object.keys(state.files).sort()) {
        if (!path.startsWith(prefix)) continue;
        const remainder = path.slice(prefix.length);
        const name = remainder.split('/')[0];
        if (!name) continue;
        const nodePath = `${prefix}${name}`;
        nodes.set(nodePath, {
          name,
          path: nodePath,
          absolute: `${state.project.worktree}/${nodePath}`,
          type: remainder.includes('/') ? 'directory' : 'file',
          ignored: false,
        });
      }
      sendJson(res, 200, [...nodes.values()]);
      return;
    }

    if (req.method === 'GET' && pathname === '/file/content') {
      const requestedPath = requestUrl.searchParams.get('path') || '';
      if (!(requestedPath in state.files)) {
        notFound(res);
        return;
      }
      sendJson(res, 200, {
        type: 'text',
        content: state.files[requestedPath],
        diff: requestedPath === 'app/(tabs)/index.tsx' && state.workspaceTaskCompleted
          ? '@@ -1,1 +1,3 @@\n-export default function OldScreen() {}\n+export default function ChatLandingScreen() {\n+  return null;\n+}'
          : undefined,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/file/status') {
      sendJson(res, 200, fileStatusesPayload(state));
      return;
    }

    if (req.method === 'GET' && pathname === '/vcs') {
      sendJson(res, 200, vcsPayload());
      return;
    }

    if (req.method === 'GET' && pathname === '/vcs/status') {
      sendJson(res, 200, state.files['src/demo.ts'].includes('SDK')
        ? [{ file: 'src/demo.ts', additions: 1, deletions: 1, status: 'modified' }]
        : []);
      return;
    }

    if (req.method === 'GET' && pathname === '/vcs/diff') {
      const mode = requestUrl.searchParams.get('mode');
      if (!['git', 'branch'].includes(mode)) {
        badRequest(res, 'VCS diff requires mode');
        return;
      }
      sendJson(res, 200, state.files['src/demo.ts'].includes('SDK')
        ? [{ file: 'src/demo.ts', patch: applicablePatch, additions: 1, deletions: 1, status: 'modified' }]
        : []);
      return;
    }

    if (req.method === 'GET' && pathname === '/vcs/diff/raw') {
      sendJson(res, 200, state.files['src/demo.ts'].includes('SDK') ? applicablePatch : '');
      return;
    }

    if (req.method === 'POST' && pathname === '/vcs/apply') {
      const body = await readJson(req);
      const expected = 'export const demo = "OpenCode 1.18.3";\n';
      if (![applicablePatch, editorPatch].includes(body?.patch) || state.files['src/demo.ts'] !== expected) {
        badRequest(res, 'Patch is unsupported or no longer applies');
        return;
      }
      state.files['src/demo.ts'] = 'export const demo = "OpenCode SDK 1.18.3";\n';
      sendJson(res, 200, { applied: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/mcp') {
      sendJson(res, 200, state.mcpStatuses);
      return;
    }
    if (req.method === 'POST' && pathname === '/mcp') {
      const body = await readJson(req);
      if (!body?.name || !body?.config || state.mcpRuntimeConfigs[body.name]) {
        badRequest(res, 'MCP add requires a unique name and config');
        return;
      }
      state.mcpRuntimeConfigs[body.name] = body.config;
      state.mcpStatuses[body.name] = { status: body.config.enabled === false ? 'disabled' : 'connected' };
      sendJson(res, 200, state.mcpStatuses);
      return;
    }
    if (req.method === 'POST' && /^\/mcp\/[^/]+\/(connect|disconnect)$/.test(pathname)) {
      const [, , name, action] = pathname.split('/');
      if (!state.mcpRuntimeConfigs[name]) {
        notFound(res);
        return;
      }
      state.mcpStatuses[name] = { status: action === 'connect' ? 'connected' : 'disabled' };
      sendJson(res, 200, true);
      return;
    }
    if (/^\/mcp\/[^/]+\/auth$/.test(pathname)) {
      const name = pathname.split('/')[2];
      if (!state.mcpRuntimeConfigs[name]) {
        notFound(res);
        return;
      }
      if (req.method === 'POST') {
        const oauthState = `oauth-${name}`;
        state.mcpOauth[name] = { state: oauthState };
        sendJson(res, 200, { authorizationUrl: `https://example.test/mcp/${name}/authorize`, oauthState });
        return;
      }
      if (req.method === 'DELETE') {
        delete state.mcpOauth[name];
        sendJson(res, 200, { success: true });
        return;
      }
    }
    if (req.method === 'POST' && /^\/mcp\/[^/]+\/auth\/callback$/.test(pathname)) {
      const name = pathname.split('/')[2];
      const body = await readJson(req);
      if (!state.mcpRuntimeConfigs[name]) {
        notFound(res);
        return;
      }
      if (!state.mcpOauth[name] || !body?.code) {
        badRequest(res, 'MCP OAuth callback requires an active flow and code');
        return;
      }
      state.mcpOauth[name].code = body.code;
      state.mcpStatuses[name] = { status: 'connected' };
      sendJson(res, 200, state.mcpStatuses[name]);
      return;
    }
    const diagnostics = diagnosticsPayload();
    if (req.method === 'GET' && pathname === '/lsp') {
      sendJson(res, 200, diagnostics.lsp);
      return;
    }
    if (req.method === 'GET' && pathname === '/formatter') {
      sendJson(res, 200, diagnostics.formatter);
      return;
    }

    if (req.method === 'GET' && pathname === '/session') {
      sendJson(res, 200, state.sessions.filter((session) => !session.time.archived));
      return;
    }

    if (req.method === 'GET' && pathname === '/experimental/session') {
      const archived = requestUrl.searchParams.get('archived') === 'true';
      sendJson(res, 200, state.sessions
        .filter((session) => archived ? Boolean(session.time.archived) : !session.time.archived)
        .map((session) => ({ ...session, project: { id: state.project.id, worktree: state.project.worktree } })));
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
      delete state.sessionInitializations[sessionId];
      delete state.todosBySession[sessionId];
      delete state.sessionStatuses[sessionId];
      state.pendingPermissions = state.pendingPermissions.filter((entry) => entry.sessionID !== sessionId);
      state.pendingQuestions = state.pendingQuestions.filter((entry) => entry.sessionID !== sessionId);
      emitEvent({ type: 'session.deleted', properties: { sessionID: sessionId, info: deletedSession } });
      sendJson(res, 200, true);
      return;
    }

    if (req.method === 'GET' && /^\/session\/[^/]+\/message$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      sendJson(res, 200, getMessages(sessionId));
      return;
    }

    if (req.method === 'GET' && /^\/session\/[^/]+\/children$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      if (!getSession(sessionId)) {
        notFound(res);
        return;
      }
      sendJson(res, 200, state.sessions.filter((session) => session.parentID === sessionId));
      return;
    }

    if (req.method === 'POST' && /^\/session\/[^/]+\/init$/.test(pathname)) {
      const session = getSession(pathname.split('/')[2]);
      const body = await readJson(req);
      if (!session) {
        notFound(res);
        return;
      }
      if (!body?.modelID || !body?.providerID || !body?.messageID) {
        badRequest(res, 'Session init requires modelID, providerID, and messageID');
        return;
      }
      state.sessionInitializations[session.id] = {
        modelID: body.modelID,
        providerID: body.providerID,
        messageID: body.messageID,
      };
      sendJson(res, 200, true);
      return;
    }

    if (req.method === 'POST' && /^\/session\/[^/]+\/shell$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      const body = await readJson(req);
      if (!getSession(sessionId)) {
        notFound(res);
        return;
      }
      if (!body?.agent || !body?.command) {
        badRequest(res, 'Session shell requires agent and command');
        return;
      }
      sendJson(res, 200, handleCommand(sessionId, { command: 'shell', arguments: body.command }));
      return;
    }

    if (req.method === 'GET' && /^\/session\/[^/]+\/diff$/.test(pathname)) {
      const sessionId = pathname.split('/')[2];
      const messageId = requestUrl.searchParams.get('messageID');
      const message = getMessages(sessionId).find((record) => record.info.id === messageId && record.info.role === 'user');
      sendJson(res, 200, message?.info.summary?.diffs || []);
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
      emitEvent({ type: 'session.updated', properties: { sessionID: session.id, info: session } });
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
      emitEvent({ type: 'session.updated', properties: { sessionID: session.id, info: session } });
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
      emitEvent({ type: 'session.updated', properties: { sessionID: session.id, info: session } });
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
      emitEvent({ type: 'session.updated', properties: { sessionID: session.id, info: session } });
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

      if (body?.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) {
        badRequest(res, 'Session title must not be empty');
        return;
      }
      if (body?.title !== undefined) session.title = body.title.trim();
      if (body?.time?.archived !== undefined) session.time.archived = body.time.archived;
      if (body?.title === undefined && body?.time?.archived === undefined) {
        badRequest(res, 'Session update requires title or time.archived');
        return;
      }
      session.time.updated = getNow();
      emitEvent({ type: 'session.updated', properties: { sessionID: session.id, info: session } });
      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'GET' && pathname === '/pty/shells') {
      sendJson(res, 200, [
        { path: '/bin/bash', name: 'bash', acceptable: true },
        { path: '/bin/sh', name: 'sh', acceptable: true },
      ]);
      return;
    }

    if (req.method === 'GET' && pathname === '/pty') {
      sendJson(res, 200, state.ptys);
      return;
    }

    if (req.method === 'POST' && pathname === '/pty') {
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
      sendJson(res, 200, pty);
      return;
    }

    if (/^\/pty\/[^/]+$/.test(pathname)) {
      const ptyId = pathname.split('/')[2];
      const index = state.ptys.findIndex((pty) => pty.id === ptyId);
      if (index < 0) {
        notFound(res);
        return;
      }
      if (req.method === 'GET') {
        sendJson(res, 200, state.ptys[index]);
        return;
      }
      if (req.method === 'PUT') {
        const body = await readJson(req) || {};
        if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) {
          badRequest(res, 'PTY title must not be empty');
          return;
        }
        if (body.title !== undefined) state.ptys[index].title = body.title.trim();
        sendJson(res, 200, state.ptys[index]);
        return;
      }
      if (req.method === 'DELETE') {
        state.ptys.splice(index, 1);
        sendJson(res, 200, true);
        return;
      }
    }

    if (req.method === 'POST' && /^\/pty\/[^/]+\/connect-token$/.test(pathname)) {
      const ptyId = pathname.split('/')[2];
      if (req.headers['x-opencode-ticket'] !== '1') {
        sendJson(res, 403, { error: 'PTY ticket header required' });
        return;
      }
      if (!state.ptys.some((pty) => pty.id === ptyId)) {
        notFound(res);
        return;
      }
      sendJson(res, 200, { ticket: `ticket-${ptyId}`, expires_in: 60 });
      return;
    }

    if (pathname === '/experimental/worktree') {
      if (req.method === 'GET') {
        sendJson(res, 200, state.worktrees.map((worktree) => worktree.directory));
        return;
      }
      const body = await readJson(req) || {};
      if (req.method === 'POST') {
        const name = body.name?.trim() || `sandbox-${state.nextWorktreeId++}`;
        if (!/^[a-zA-Z0-9._-]+$/.test(name) || state.worktrees.some((worktree) => worktree.name === name)) {
          badRequest(res, 'Worktree name is invalid or already exists');
          return;
        }
        const worktree = { name, branch: `worktree/${name}`, directory: `${state.rootPath}/${name}` };
        state.worktrees.push(worktree);
        sendJson(res, 200, worktree);
        return;
      }
      if (req.method === 'DELETE') {
        const index = state.worktrees.findIndex((worktree) => worktree.directory === body.directory);
        if (index < 0) {
          badRequest(res, 'Unknown worktree directory');
          return;
        }
        state.worktrees.splice(index, 1);
        sendJson(res, 200, true);
        return;
      }
    }

    if (req.method === 'POST' && pathname === '/experimental/worktree/reset') {
      const body = await readJson(req) || {};
      if (!state.worktrees.some((worktree) => worktree.directory === body.directory)) {
        badRequest(res, 'Unknown worktree directory');
        return;
      }
      sendJson(res, 200, true);
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

const ptyWebSockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const pathname = basePath && requestUrl.pathname.startsWith(`${basePath}/`)
    ? requestUrl.pathname.slice(basePath.length)
    : requestUrl.pathname;
  const match = pathname.match(/^\/pty\/([^/]+)\/connect$/);
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
  console.log(`Fake OpenCode server listening on http://127.0.0.1:${port} (${state.scenario})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const socket of ptyWebSockets.clients) socket.terminate();
    ptyWebSockets.close();
    server.close(() => {
      process.exit(0);
    });
  });
}
