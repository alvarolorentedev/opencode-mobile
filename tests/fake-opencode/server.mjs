// Deterministic V2 fake server. See docs/engineering/validation/fake-server.md.
import { models, providersForScenario, modelCatalog } from './fixtures.mjs';
import { runProjectFileShell } from './project-files.mjs';
import { filesForDirectory, fileNodes, addWorktree } from './workspace.mjs';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocketServer } from 'ws';
import { createTerminalFixture } from './terminal.mjs';

import { createSessionHelpers } from './session-helpers.mjs';
import { createStateStore, getNow, resolveProject, resolveProjectDirectory } from './state.mjs';
import { configEntries, extensionCommands, extensionPlugins, extensionSkills, readExtensionFile, runFakeShell, shellInfo, writeExtensionFile } from './extensions.mjs';

const port = Number.parseInt(process.env.FAKE_OPENCODE_PORT || '4096', 10);
const scenarioName = process.env.FAKE_OPENCODE_SCENARIO || 'happy-path';

const stateStore = createStateStore(scenarioName);
let state = stateStore.getState();
const terminalFixture = createTerminalFixture((id) => { const pty = state.ptys.find((item) => item.id === id); if (pty) pty.status = 'exited'; });
let suppressEvents = false;
let stallEvents = false;
let v2Subscribes = 0;
// Deterministic network fault injection for resilience tests. Values apply to
// data-plane requests only; the /__control surface stays responsive.
const DEFAULT_NETWORK = { latencyMs: 0, jitterMs: 0, failRate: 0, status: 0, hang: false, sseKeepaliveMs: 0 };
let networkProfile = { ...DEFAULT_NETWORK };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyNetworkProfile(req, res, pathname) {
  if (pathname.startsWith('/__control/')) return false;
  const jitter = networkProfile.jitterMs > 0 ? Math.floor(Math.random() * networkProfile.jitterMs) : 0;
  if (networkProfile.latencyMs > 0 || jitter > 0) await sleep(networkProfile.latencyMs + jitter);
  if (networkProfile.failRate > 0 && Math.random() < networkProfile.failRate) {
    if (networkProfile.status > 0) sendJson(res, networkProfile.status, { error: 'Injected network failure' });
    else req.socket.destroy();
    return true;
  }
  if (networkProfile.hang) {
    await new Promise((resolve) => req.on('close', resolve));
    return true;
  }
  return false;
}

// Gateway-auth contract: tests can require custom request headers (Cloudflare
// Access service tokens and similar proxies). Records only the configured
// header names so assertions never depend on unrelated request metadata.
let requiredHeaders = {};
let receivedHeaders = {};
const headerPaths = new Set();
// The real V2 session list is cursor-paged. Keep a realistic default so the
// app must follow the cursor, and let a test shrink it without seeding dozens
// of chats.
const DEFAULT_SESSION_PAGE_LIMIT = 50;
let sessionPageLimit = DEFAULT_SESSION_PAGE_LIMIT;
const v2Clients = new Set();
// VCS diff fixtures. `working` mirrors uncommitted changes; `branch` is a
// distinct committed fixture so the diff-scope surface is deterministic.
const workingPatch = 'diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-export const demo = "OpenCode 1.18.3";\n+export const demo = "OpenCode SDK 1.18.3";\n';
const branchPatch = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,4 @@\n # Demo project\n \n Deterministic fake OpenCode workspace.\n+Committed on this branch.\n';

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': accessAllowHeaders(),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function accessAllowHeaders() {
  return ['Content-Type', 'Authorization', 'x-opencode-ticket', ...Object.keys(requiredHeaders)].join(', ');
}

// Returns false when a required gateway header is missing or wrong. Required
// headers are empty by default, so ordinary fixtures are unaffected.
function accessHeadersPresent(req, pathname) {
  if (!Object.keys(requiredHeaders).length) return true;
  const received = {};
  for (const [name, expected] of Object.entries(requiredHeaders)) {
    const actual = req.headers[name.toLowerCase()];
    if (actual !== expected) return false;
    received[name] = actual;
  }
  Object.assign(receivedHeaders, received);
  if (pathname) headerPaths.add(pathname);
  return true;
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function location() {
  return { directory: state.project.canonical };
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
    location: { directory: session?.location.directory || state.project.canonical },
    data,
  };
}

function emitV2Event(mapped) {
  if (suppressEvents || stallEvents) return;
  const payload = `data: ${JSON.stringify(mapped)}\n\n`;
  for (const client of v2Clients) {
    client.write(payload);
  }
}

function emitEvent(message) { emitV2Event(event(message.type, message.data)); }

const helpers = createSessionHelpers({ emitEvent, getNow, getState: () => state });


function deliverInboxItem(item) {
  state.inboxBySession[item.sessionID] = (state.inboxBySession[item.sessionID] || []).filter((entry) => entry.id !== item.id);
  state.activePromptBySession[item.sessionID] = item.payload.text;
  helpers.handlePromptSubmission(item.sessionID, {
    messageID: item.id,
    text: item.payload.text,
    files: item.payload.files,
    agents: item.payload.agents,
    skills: item.payload.skills,
  });
  emitV2Event(event('session.inbox.delivered', { sessionID: item.sessionID, inboxID: item.id }));
}

let connectionPassword = process.env.FAKE_OPENCODE_PASSWORD || '';
let pairingCode;
let pairingToken;
let pairingSequence = 0;
// Device-authenticated connector management surface. `deviceCredentials` mirrors
// the connector's paired-device Basic credentials; `managedServices` is the
// exposed-service list the `/_cloudlink/services` API reads and mutates.
// `connectorApi` mirrors the management API revision: `2` serves dedicated
// service ports and root services, `1` is the legacy path-only surface.
const deviceCredentials = new Map();
let managedServices = [];
let connectorApi = 2;
const CONNECTOR_VERSION = '0.1.14';
const SERVICE_PORTS = [8443, 2053, 2083, 2087, 2096];
const MANAGEMENT_PREFIX = '/_cloudlink';

function connectorHeaders() {
  return { 'x-cloudlink-connector-version': CONNECTOR_VERSION };
}

function storedServicePort(service) {
  return service.port ?? SERVICE_PORTS[0];
}

function sendText(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...extraHeaders });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const pathname = requestUrl.pathname;

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': accessAllowHeaders(),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      });
      res.end();
      return;
    }

    // Everything except the test-control surface is behind the optional
    // gateway-header gate, mirroring an Access-protected origin.
    if (!pathname.startsWith('/__control/') && !accessHeadersPresent(req, pathname)) {
      sendJson(res, 401, { error: 'Access denied' });
      return;
    }

    if (pathname === '/__control/network') {
      if (req.method === 'POST') {
        const body = await readJson(req) || {};
        networkProfile = {
          latencyMs: Number.isFinite(body.latencyMs) ? Math.max(0, body.latencyMs) : 0,
          jitterMs: Number.isFinite(body.jitterMs) ? Math.max(0, body.jitterMs) : 0,
          failRate: Number.isFinite(body.failRate) ? Math.min(1, Math.max(0, body.failRate)) : 0,
          status: Number.isInteger(body.status) ? body.status : 0,
          hang: Boolean(body.hang),
          sseKeepaliveMs: Number.isFinite(body.sseKeepaliveMs) ? Math.max(0, body.sseKeepaliveMs) : 0,
        };
      }
      sendJson(res, 200, { data: networkProfile });
      return;
    }

    if (await applyNetworkProfile(req, res, pathname)) return;

    // Keep the transport connected while dropping domain events, or close it
    // without resetting server state to reproduce missed-event recovery.
    if (req.method === 'POST' && pathname === '/__control/event-stream') {
      const body = await readJson(req);
      suppressEvents = Boolean(body?.suppress);
      if (typeof body?.stall === 'boolean') {
        stallEvents = body.stall;
        // Releasing a stall re-announces the stream so held clients reconcile.
        if (!stallEvents) for (const client of v2Clients) client.write(`data: ${JSON.stringify(event('server.connected', {}))}\n\n`);
      }
      if (body?.disconnect) {
        for (const client of v2Clients) client.end();
        v2Clients.clear();
      }
      sendJson(res, 200, { data: { suppressEvents, stallEvents, clients: v2Clients.size, subscribes: v2Subscribes } });
      return;
    }

    if (pathname === '/__control/terminal') {
      if (req.method === 'POST') terminalFixture.control(await readJson(req));
      sendJson(res, 200, { data: terminalFixture.snapshot() });
      return;
    }

    // Require (and record) gateway headers for every non-control request. POST
    // replaces the required set; GET reports the current contract and evidence.
    if (pathname === '/__control/headers') {
      if (req.method === 'POST') {
        const body = await readJson(req);
        requiredHeaders = {};
        receivedHeaders = {};
        headerPaths.clear();
        for (const [name, value] of Object.entries(body?.required ?? {})) {
          if (typeof value === 'string' && name.trim()) requiredHeaders[name.trim()] = value;
        }
      }
      sendJson(res, 200, { data: { required: requiredHeaders, received: receivedHeaders, paths: [...headerPaths] } });
      return;
    }

    // Shrink the session-list page so a test can prove the app follows cursors.
    if (pathname === '/__control/session-page') {
      if (req.method === 'POST') {
        const body = await readJson(req);
        sessionPageLimit = Number.isInteger(body?.size) && body.size > 0 ? body.size : DEFAULT_SESSION_PAGE_LIMIT;
      }
      sendJson(res, 200, { data: { size: sessionPageLimit } });
      return;
    }

    if (req.method === 'GET' && pathname === '/__control/state') {
      sendJson(res, 200, { scenario: state.scenario, sessions: state.sessions, messagesBySession: state.messagesBySession, sessionStatuses: state.sessionStatuses, pendingPermissions: state.pendingPermissions, pendingQuestions: state.pendingQuestions, configuredProviderIds: [...state.configuredProviderIds], authByProvider: state.authByProvider, worktrees: state.worktrees, mcpStatuses: state.mcpStatuses, files: state.files, questionAnswers: state.lastQuestionAnswer, classifierCalls: state.classifierCalls || 0, network: networkProfile, headers: { required: requiredHeaders, received: receivedHeaders, paths: [...headerPaths] } }); return;
    }
    if (req.method === 'GET' && pathname === '/__control/oauth-complete') {
      const attempt = state.integrationAttempts[requestUrl.searchParams.get('attemptID')];
      if (!attempt) return notFound(res);
      attempt.status = 'complete';
      if (attempt.integrationID.startsWith('mcp-')) state.mcpStatuses[attempt.integrationID.slice(4)] = { status: 'connected' };
      sendJson(res, 200, { status: 'complete' }); return;
    }
    if (req.method === 'POST' && pathname === '/__control/reset') {
      terminalFixture.reset();
      const body = await readJson(req);
      for (const client of v2Clients) client.end();
      v2Clients.clear();
      suppressEvents = false;
      stallEvents = false;
      v2Subscribes = 0;
      networkProfile = { ...DEFAULT_NETWORK };
      sessionPageLimit = DEFAULT_SESSION_PAGE_LIMIT;
      requiredHeaders = {};
      receivedHeaders = {};
      headerPaths.clear();
      state = stateStore.resetState(body?.scenario || scenarioName);
      connectionPassword = body?.password ?? process.env.FAKE_OPENCODE_PASSWORD ?? '';
      pairingCode = undefined;
      pairingToken = undefined;
      deviceCredentials.clear();
      managedServices = [];
      connectorApi = 2;
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
    if (req.method === 'POST' && pathname === '/__control/device') {
      const body = await readJson(req);
      if (body?.device_id) deviceCredentials.set(body.device_id, body.device_secret ?? '');
      sendJson(res, 200, { data: { devices: [...deviceCredentials.keys()] } });
      return;
    }
    if (req.method === 'POST' && pathname === '/__control/connector-api') {
      const body = await readJson(req);
      connectorApi = Number.isInteger(body?.api) ? body.api : 2;
      sendJson(res, 200, { data: { api: connectorApi } });
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
    // Device-authenticated connector management. Served on the OpenCode origin
    // (never a service port) and reachable only with a paired device credential,
    // so it is handled before the OpenCode password gate. Every authenticated
    // reply carries the connector version header, and `api` 2 enforces dedicated
    // service ports with the connector's root/path sharing rules.
    if (pathname === '/_cloudlink' || pathname.startsWith('/_cloudlink/')) {
      const rawAuth = req.headers.authorization || '';
      const basic = rawAuth.startsWith('Basic ') ? Buffer.from(rawAuth.slice(6), 'base64').toString('utf8') : '';
      const separator = basic.indexOf(':');
      const user = separator >= 0 ? basic.slice(0, separator) : '';
      const secret = separator >= 0 ? basic.slice(separator + 1) : '';
      const deviceOk = Boolean(user) && deviceCredentials.get(user) === secret;
      const operatorOk = Boolean(connectionPassword) && basic === `opencode:${connectionPassword}`;
      if (!deviceOk && !operatorOk) return sendText(res, 401, 'device credential required');
      const headers = connectorHeaders();
      if (req.method === 'GET' && pathname === '/_cloudlink/version') {
        return sendJson(res, 200, connectorApi >= 2
          ? { version: CONNECTOR_VERSION, api: connectorApi, service_ports: SERVICE_PORTS }
          : { version: CONNECTOR_VERSION, api: connectorApi }, headers);
      }
      if (pathname === '/_cloudlink/services' || pathname.startsWith('/_cloudlink/services/')) {
        const id = pathname === '/_cloudlink/services' ? undefined : decodeURIComponent(pathname.slice('/_cloudlink/services/'.length));
        if (req.method === 'GET' && id === undefined) return sendJson(res, 200, { services: managedServices }, headers);
        if (req.method === 'PUT' && id) {
          const body = await readJson(req) || {};
          const wantsPort = connectorApi >= 2;
          let servicePort = SERVICE_PORTS[0];
          if (wantsPort) {
            if (!Number.isInteger(body.port)) return sendText(res, 400, 'invalid service: missing field `port`', headers);
            if (!SERVICE_PORTS.includes(body.port)) return sendText(res, 400, `invalid service: service port must be one of ${SERVICE_PORTS.join(', ')}`, headers);
            servicePort = body.port;
          }
          let canonicalPath = null;
          if (typeof body.path === 'string' && body.path.trim() !== '') {
            canonicalPath = body.path.replace(/\/+$/, '');
            const segments = canonicalPath.split('/').slice(1);
            if (!canonicalPath.startsWith('/') || canonicalPath.includes('%') || canonicalPath.includes('?') || canonicalPath.includes('#')) {
              return sendText(res, 400, 'invalid service: path must be an absolute path', headers);
            }
            if (segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._~-]+$/.test(segment))) {
              return sendText(res, 400, 'invalid service: path contains unsupported characters', headers);
            }
            if (canonicalPath === MANAGEMENT_PREFIX || canonicalPath.startsWith(`${MANAGEMENT_PREFIX}/`)) {
              return sendText(res, 400, 'invalid service: path is reserved for connector management', headers);
            }
          } else if (body.path !== undefined && body.path !== null) {
            return sendText(res, 400, 'invalid service: path must be a string or null', headers);
          } else if (!wantsPort) {
            return sendText(res, 400, 'invalid service: path must be an absolute path', headers);
          }
          const target = typeof body.target === 'string' ? body.target : '';
          if (!/^(?:127\.0\.0\.1|\[::1\]):(\d+)$/.test(target)) return sendText(res, 400, 'invalid service: target must be loopback', headers);
          const targetPort = Number(target.slice(target.lastIndexOf(':') + 1));
          if (targetPort < 1024 || targetPort > 65_535) return sendText(res, 400, 'invalid service: target port must be 1024-65535', headers);
          if (SERVICE_PORTS.includes(targetPort)) return sendText(res, 400, 'invalid service: target cannot use a service port', headers);
          const created = !managedServices.some((service) => service.id === id);
          if (created && managedServices.length >= 16) return sendText(res, 400, 'invalid service: at most 16 services are allowed', headers);
          const others = managedServices.filter((service) => service.id !== id);
          if (canonicalPath === null) {
            if (others.some((service) => storedServicePort(service) === servicePort)) return sendText(res, 400, `invalid service: port ${servicePort} is already used by another service`, headers);
          } else {
            if (others.some((service) => storedServicePort(service) === servicePort && service.path === null)) {
              return sendText(res, 400, 'invalid service: a service port cannot serve both a root service and path services', headers);
            }
            if (others.some((service) => storedServicePort(service) === servicePort && service.path === canonicalPath)) {
              return sendText(res, 400, `invalid service: duplicate service path on port ${servicePort}`, headers);
            }
          }
          const service = {
            id,
            name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : id,
            ...(wantsPort ? { port: servicePort } : {}),
            path: canonicalPath,
            target,
            enabled: body.enabled === true,
            access: body.access === 'public' ? 'public' : 'private',
            strip_prefix: body.strip_prefix !== false,
          };
          managedServices = managedServices.filter((entry) => entry.id !== id).concat(service);
          return sendJson(res, created ? 201 : 200, { service }, headers);
        }
        if (req.method === 'DELETE' && id) {
          if (!managedServices.some((service) => service.id === id)) return sendText(res, 404, 'unknown service', headers);
          managedServices = managedServices.filter((service) => service.id !== id);
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', ...headers });
          res.end();
          return;
        }
      }
      if (req.method === 'GET') return sendText(res, 404, 'not found', headers);
      return sendText(res, 405, 'method not allowed', headers);
    }

    if (connectionPassword) {
      const valid = [connectionPassword, pairingToken].filter(Boolean).some((secret) => req.headers.authorization === `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}`);
      if (!valid) { sendJson(res, 401, { _tag: 'UnauthorizedError', message: 'Authentication required' }); return; }
    }

    if (pathname === '/api/event') {
      if (state.scenario === 'stream-disconnect') return sendJson(res, 503, { error: 'SSE unavailable' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      v2Clients.add(res);
      v2Subscribes += 1;
      if (!stallEvents) res.write(`data: ${JSON.stringify(event('server.connected', {}))}\n\n`);
      const keepalive = networkProfile.sseKeepaliveMs > 0
        ? setInterval(() => { if (!stallEvents) res.write(': keepalive\n\n'); }, networkProfile.sseKeepaliveMs)
        : undefined;
      req.on('close', () => {
        if (keepalive) clearInterval(keepalive);
        v2Clients.delete(res);
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/info') {
      sendJson(res, 200, { version: '2.0.0-fake', pid: 1, urls: [`http://127.0.0.1:${port}`], paths: { tmp: '/tmp' } });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/location') {
      const requested = requestUrl.searchParams.get('location[directory]');
      const project = resolveProject(state, requested);
      if (!project) { sendJson(res, 400, { error: 'Directory is outside the server workspace.' }); return; }
      sendJson(res, 200, { directory: requested || project.canonical, project: { id: project.id, directory: resolveProjectDirectory(state, requested) || project.canonical, canonical: project.canonical } });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/project') {
      sendJson(res, 200, state.projects.map((project) => ({
        id: project.id,
        canonical: project.canonical,
        time: { created: project.time.created, updated: project.time.initialized || project.time.created },
        sandboxes: [],
      })));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/config') {
      sendJson(res, 200, configEntries(state, requestUrl.searchParams.get('location[directory]') || state.project.canonical));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/provider') {
      sendJson(res, 200, {
        location: location(),
        data: providersForScenario(state).filter((provider) => state.configuredProviderIds.has(provider.id)),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/model') {
      sendJson(res, 200, { location: location(), data: modelCatalog(state).filter((model) => model.enabled) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/experimental/generate') {
      const body = await readJson(req);
      const message = body?.prompt?.match(/"""\n([\s\S]*?)\n"""/)?.[1] || body?.prompt || '';
      const text = /refactor|architecture|migrate|complex/i.test(message)
        ? 'complex'
        : /simple|hello|hi\b|2 \+ 2/i.test(message)
          ? 'simple'
          : 'standard';
      state.classifierCalls = (state.classifierCalls || 0) + 1;
      sendJson(res, 200, { data: { text } });
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
          { id: 'general', name: 'general', mode: 'all', hidden: false, permissions: [], description: 'Delegate a focused task.' },
          { id: 'explore', name: 'explore', mode: 'subagent', hidden: false, permissions: [], description: 'Search the codebase.' },
        ],
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/skill') {
      const directory = requestUrl.searchParams.get('location[directory]') || state.project.canonical;
      sendJson(res, 200, { location: location(), data: extensionSkills(state, directory) });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/reference') {
      sendJson(res, 200, {
        location: location(),
        data: [
          { name: 'docs', path: 'README.md', description: 'Project documentation', hidden: false, source: { type: 'local', path: 'README.md' } },
        ],
      });
      return;
    }

    const mcpMutation = pathname.match(/^\/api\/experimental\/mcp\/([^/]+)(?:\/(connect|disconnect))?$/);
    if (mcpMutation) {
      if (!requireLocation(requestUrl, res)) return;
      const name = decodeURIComponent(mcpMutation[1]);
      if (req.method === 'PUT') {
        const body = await readJson(req); state.mcpRuntimeConfigs[name] = body.config;
        state.mcpStatuses[name] = body.config.disabled ? { status: 'disabled' } : body.config.type === 'remote' && body.config.oauth !== false ? { status: 'needs_auth', error: 'Authentication required' } : { status: 'connected' };
      } else if (req.method === 'DELETE') { delete state.mcpRuntimeConfigs[name]; delete state.mcpStatuses[name]; }
      else if (req.method === 'POST' && state.mcpRuntimeConfigs[name]) state.mcpStatuses[name] = { status: mcpMutation[2] === 'disconnect' ? 'disabled' : 'connected' };
      else return notFound(res);
      emitV2Event(event('mcp.status.changed', { server: name })); sendJson(res, 204); return;
    }
    const integrationEntry = pathname.match(/^\/api\/integration\/([^/]+)$/);
    if (req.method === 'GET' && integrationEntry) {
      const id = decodeURIComponent(integrationEntry[1]);
      const native = providersForScenario(state).find((provider) => provider.integrationID === id);
      const mcpName = id.startsWith('mcp-') ? id.slice(4) : undefined;
      if (!native && !state.mcpRuntimeConfigs[mcpName]) return notFound(res);
      sendJson(res, 200, { location: location(), data: { id, name: native?.name || mcpName, methods: mcpName ? [{ type: 'oauth', id: 'login', label: 'Sign in' }] : [{ type: 'key', label: 'API key' }], connections: [], ...(mcpName ? { metadata: { source: 'mcp' } } : {}) } }); return;
    }
    const oauthPath = pathname.match(/^\/api\/integration\/([^/]+)\/connect\/oauth(?:\/([^/]+)(?:\/(complete))?)?$/);
    if (oauthPath) {
      if (!requireLocation(requestUrl, res)) return;
      const integrationID = decodeURIComponent(oauthPath[1]);
      if (req.method === 'POST' && !oauthPath[2]) {
        const body = await readJson(req); if (body.methodID !== 'login') return sendJson(res, 400, { error: 'Unknown login method' });
        const id = `attempt-${Object.keys(state.integrationAttempts).length + 1}`;
        state.integrationAttempts[id] = { integrationID, status: 'pending' };
        sendJson(res, 200, { location: location(), data: { attemptID: id, mode: integrationID.includes('code') ? 'code' : 'auto', url: `http://127.0.0.1:${port}/__control/oauth-complete?attemptID=${id}`, instructions: 'Finish sign-in in the browser.', time: { created: getNow(), expires: getNow() + 300000 } } }); return;
      }
      const attempt = state.integrationAttempts[oauthPath[2]];
      if (!attempt || attempt.integrationID !== integrationID) return notFound(res);
      if (req.method === 'DELETE') { delete state.integrationAttempts[oauthPath[2]]; sendJson(res, 204); return; }
      if (req.method === 'POST' && oauthPath[3]) { const body = await readJson(req); if (!body.code?.trim()) return sendJson(res, 400, { error: 'Enter a code' }); attempt.status = 'complete'; state.mcpStatuses[integrationID.slice(4)] = { status: 'connected' }; sendJson(res, 204); return; }
      if (req.method === 'GET') { sendJson(res, 200, { location: location(), data: { status: attempt.status } }); return; }
      return notFound(res);
    }
    if (req.method === 'GET' && pathname === '/api/integration') {
      sendJson(res, 200, {
        location: location(),
        data: providersForScenario(state).map((provider) => ({
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
      const provider = providersForScenario(state).find((item) => item.integrationID === integrationID);
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
      const all = directory ? state.sessions.filter((session) => session.location.directory === directory) : state.sessions;
      // Cursor pages, like the real server: a first page alone must never be
      // mistaken for the complete list.
      const cursor = requestUrl.searchParams.get('cursor');
      const offset = cursor ? Number(JSON.parse(Buffer.from(cursor, 'base64url').toString()).offset) : 0;
      const limit = Number(requestUrl.searchParams.get('limit')) || sessionPageLimit;
      const end = offset + limit;
      const next = end < all.length ? Buffer.from(JSON.stringify({ offset: end })).toString('base64url') : null;
      sendJson(res, 200, { data: all.slice(offset, end), cursor: { next, previous: null } });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/session') {
      const body = await readJson(req);
      const directory = body?.location?.directory;
      const session = helpers.createSession(body?.title || '', directory);
      sendJson(res, 200, { data: session });
      return;
    }

    const forkPath = pathname.match(/^\/api\/session\/([^/]+)\/fork$/);
    if (req.method === 'POST' && forkPath) {
      const source = helpers.getSession(forkPath[1]); if (!source) return notFound(res);
      const body = await readJson(req);
      const fork = helpers.createSession(`${source.title || 'Untitled chat'} (fork)`, source.location.directory);
      fork.parentID = source.id; fork.model = source.model; fork.agent = source.agent;
      const messages = helpers.getMessages(source.id);
      const end = body?.before ? messages.findIndex((item) => item.id === body.before) : -1;
      state.messagesBySession[fork.id] = structuredClone(end >= 0 ? messages.slice(0, end) : messages);
      emitV2Event(event('session.forked', { sessionID: fork.id }));
      sendJson(res, 200, { data: fork }); return;
    }
    const revertPath = pathname.match(/^\/api\/session\/([^/]+)\/revert(?:\/(stage))?$/);
    if (revertPath) {
      const session = helpers.getSession(revertPath[1]); if (!session) return notFound(res);
      if (req.method === 'POST' && revertPath[2]) {
        const body = await readJson(req);
        // The real server refuses to stage a revert while the agent loop is
        // active; clients must interrupt and wait for idle first.
        if (state.sessionStatuses[session.id] && state.sessionStatuses[session.id].type !== 'idle') {
          sendJson(res, 409, { _tag: 'SessionBusyError', sessionID: session.id, message: `Session is busy: ${session.id}` });
          return;
        }
        if (!helpers.getMessages(session.id).some((item) => item.id === body.messageID)) return notFound(res);
        session.revert = { messageID: body.messageID };
        emitV2Event(event('session.revert.staged', { sessionID: session.id, revert: session.revert }));
        sendJson(res, 200, { data: session.revert }); return;
      }
      if (req.method === 'DELETE') {
        delete session.revert; emitV2Event(event('session.revert.cleared', { sessionID: session.id }));
        sendJson(res, 204); return;
      }
      return notFound(res);
    }

    if (req.method === 'GET' && /^\/api\/session\/[^/]+$/.test(pathname)) {
      const session = helpers.getSession(pathname.split('/')[3]);
      if (!session) return notFound(res);
      sendJson(res, 200, { data: session });
      return;
    }

    if (req.method === 'DELETE' && /^\/api\/session\/[^/]+$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      state.sessions = state.sessions.filter((session) => session.id !== sessionID);
      delete state.messagesBySession[sessionID];
      emitV2Event(event('session.deleted', { sessionID }));
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
      const messages = [...(state.messagesBySession[sessionID] || [])];
      if (position.order === 'desc') messages.reverse();
      const data = messages.slice(position.offset, position.offset + limit);
      const next = position.offset + limit < messages.length ? Buffer.from(JSON.stringify({ ...position, offset: position.offset + limit })).toString('base64url') : null;
      sendJson(res, 200, { data, cursor: { next, previous: null } });
      return;
    }

    if (req.method === 'GET' && /^\/api\/session\/[^/]+\/diff$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      const messageID = requestUrl.searchParams.get('from');
      const userMessages = (state.messagesBySession[sessionID] || []).filter((record) => record.type === 'user');
      const target = messageID
        ? userMessages.find((record) => record.id === messageID)
        : userMessages[userMessages.length - 1];
      sendJson(res, 200, { data: state.diffsByTurn[sessionID]?.[target?.id] || [] });
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
        return {
          name: file.name,
          mime: match?.[1] || 'application/octet-stream',
          data: match?.[2] || '',
          source: { type: 'inline' },
          ...(file.mention ? { mention: file.mention } : {}),
        };
      });
      const item = {
        id: `message-${state.nextMessageId++}`, sessionID, type: 'user',
        payload: {
          text: body?.text || '',
          files,
          ...(body?.agents?.length ? { agents: body.agents } : {}),
          ...(body?.skills?.length ? { skills: body.skills } : {}),
        },
        delivery: body?.delivery || 'steer', time: { created: getNow() },
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

    if (req.method === 'POST' && /^\/api\/experimental\/session\/[^/]+\/wait$/.test(pathname)) {
      const sessionID = pathname.split('/')[4];
      if (!helpers.getSession(sessionID)) return notFound(res);
      const waitingStartedAt = Date.now();
      const settle = () => {
        const status = state.sessionStatuses[sessionID];
        if (!status || status.type === 'idle' || Date.now() - waitingStartedAt > 10_000) {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }
        setTimeout(settle, 25);
      };
      settle();
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

    if (req.method === 'POST' && /^\/api\/session\/[^/]+\/shell$/.test(pathname)) {
      const sessionID = pathname.split('/')[3];
      if (!helpers.getSession(sessionID)) return notFound(res);
      const body = await readJson(req);
      if (!body?.command) return sendJson(res, 400, { error: 'Session shell requires a command' });
      helpers.handleShell(sessionID, body.command);
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
      emitEvent({ type: 'permission.replied', data: { sessionID: sessionID || request.sessionID, requestID, reply: body.decision } });
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
      if (action === 'reply' && state.scenario === 'question-failure' && !state.questionReplyFailed) { state.questionReplyFailed = true; sendJson(res, 503, { error: 'Question submission failed. Try again.' }); return; }
      state.pendingQuestions = state.pendingQuestions.filter((item) => item !== request);
      emitEvent({
        type: action === 'reply' ? 'form.replied' : 'form.cancelled',
        data: { sessionID: sessionID || request.sessionID, id: formID, ...(body || {}) },
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
      const directory = requestUrl.searchParams.get('location[directory]') || state.project.canonical;
      sendJson(res, 200, { location: location(), data: extensionCommands(state, directory) });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/plugin') {
      const directory = requestUrl.searchParams.get('location[directory]') || state.project.canonical;
      sendJson(res, 200, { location: location(), data: extensionPlugins(state, directory) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/shell') {
      const directory = requireLocation(requestUrl, res);
      if (!directory) return;
      const body = await readJson(req);
      if (!body?.command) return sendJson(res, 400, { error: 'Shell command is required' });
      const fileResult = runProjectFileShell(state, body.command);
      const result = fileResult || runFakeShell(state, body.cwd || directory, body.command);
      const info = shellInfo(state, body.cwd || directory, body.command, result);
      state.shells = state.shells || new Map();
      state.shells.set(info.id, info);
      if (fileResult?.output === 'ok' || /^(mv|rm|cp) /.test(body.command)) {
        emitV2Event(event('filesystem.changed', { path: body.command }));
        emitV2Event(event('config.updated', {}));
        emitV2Event(event('skill.updated', {}));
        emitV2Event(event('command.updated', {}));
        emitV2Event(event('plugin.updated', {}));
      }
      sendJson(res, 200, { location: location(), data: info });
      return;
    }

    const shellMatch = pathname.match(/^\/api\/shell\/([^/]+)(\/output)?$/);
    if (shellMatch) {
      const directory = requireLocation(requestUrl, res);
      if (!directory) return;
      const info = state.shells?.get(shellMatch[1]);
      if (!info) return notFound(res);
      if (req.method === 'GET' && !shellMatch[2]) return sendJson(res, 200, { location: location(), data: info });
      if (req.method === 'GET' && shellMatch[2]) {
        return sendJson(res, 200, { location: location(), data: { output: info.output || '', cursor: (info.output || '').length, size: (info.output || '').length, truncated: false } });
      }
      if (req.method === 'DELETE') {
        state.shells.delete(shellMatch[1]);
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }
      return notFound(res);
    }

    if (req.method === 'GET' && pathname === '/api/mcp') {
      sendJson(res, 200, {
        location: location(),
        data: Object.entries(state.mcpStatuses).map(([name, status]) => ({ name, status, ...(state.mcpRuntimeConfigs[name]?.type === 'remote' && state.mcpRuntimeConfigs[name].oauth !== false ? { integrationID: `mcp-${name}` } : {}) })),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/vcs') {
      if (!requireLocation(requestUrl, res)) return;
      sendJson(res, 200, { location: location(), data: { provider: 'git', branch: { current: 'main', default: 'main' } } });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/vcs/status') {
      const directory = requireLocation(requestUrl, res);
      if (!directory) return;
      sendJson(res, 200, { location: location(), data: [...Object.values(state.fileOperationStatuses?.[directory] || {}), ...(state.workspaceTaskCompleted ? [{ file: 'src/demo.ts', additions: 1, deletions: 1, status: 'modified' }, { file: 'app/(tabs)/index.tsx', additions: 6, deletions: 1, status: 'modified' }] : [])] });
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
        : fileNodes(files, directory, requestUrl.searchParams.get('path') || '', state.emptyDirectories?.[directory]).map(({ path, type }) => ({ path, type }));
      sendJson(res, 200, { location: { directory }, data: entries });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/experimental/fs/write') {
      const directory = requireLocation(requestUrl, res); if (!directory) return;
      const path = requestUrl.searchParams.get('path'); const files = filesForDirectory(state, directory);
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const content = Buffer.concat(chunks).toString('utf8');
      if (!path || path.split('/').includes('..')) return sendJson(res, 400, { error: 'Invalid file path' });
      if (path.startsWith('/')) {
        writeExtensionFile(state, path, content);
      } else {
        if (!files) return sendJson(res, 400, { error: 'Invalid file path' });
        files[path] = content;
      }
      state.workspaceTaskCompleted = true;
      emitV2Event(event('filesystem.changed', { path }));
      emitV2Event(event('config.updated', {}));
      sendJson(res, 200, { location: { directory }, data: { path } }); return;
    }
    if (req.method === 'GET' && pathname.startsWith('/api/fs/read/')) {
      const directory = requireLocation(requestUrl, res);
      if (!directory) return;
      const requestedPath = decodeURIComponent(pathname.slice('/api/fs/read/'.length));
      if (requestedPath.startsWith('/')) {
        const content = readExtensionFile(state, requestedPath);
        if (content === undefined) return notFound(res);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(content);
        return;
      }
      const files = filesForDirectory(state, directory);
      if (!files) { sendJson(res, 400, { error: 'Unknown workspace' }); return; }
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
        cwd: body.cwd || state.project.canonical,
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
        data: state.pendingPermissions,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/form') {
      if (!requireLocation(requestUrl, res)) return;
      sendJson(res, 200, { location: location(), data: state.pendingQuestions });
      return;
    }

    notFound(res);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Fake V2 server error' });
  }
});

// Playwright's APIRequestContext pools keep-alive sockets per test. Node
// closes idle connections after 5s by default, so a long UI step followed by a
// control request could reuse a socket while it was being closed and surface as
// an intermittent "socket hang up". Keep test connections alive longer than a
// single flow; the test runner terminates the process at the end.
server.keepAliveTimeout = 130_000;
server.headersTimeout = 135_000;

const ptyWebSockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  if (!accessHeadersPresent(req, requestUrl.pathname)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
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
  console.log(`Fake OpenCode V2 server listening on http://127.0.0.1:${port} (${scenarioName})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const socket of ptyWebSockets.clients) socket.terminate();
    ptyWebSockets.close();
    server.close(() => process.exit(0));
  });
}
