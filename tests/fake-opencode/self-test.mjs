#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { OpenCode } from '@opencode/client';

const port = 4196;
const prefix = '/api';
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['tests/fake-opencode/server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    FAKE_OPENCODE_BASE_PATH: prefix,
    FAKE_OPENCODE_PORT: String(port),
    FAKE_OPENCODE_SCENARIO: 'happy-path',
  },
  stdio: 'inherit',
});

const v2Port = 4197;
const v2Origin = `http://127.0.0.1:${v2Port}`;
let v2Server;

async function response(pathname, init) {
  return fetch(`${origin}${prefix}${pathname}`, init);
}

async function request(pathname, init) {
  const result = await response(pathname, init);
  if (!result.ok) throw new Error(`${pathname} failed with ${result.status}`);
  if (result.status === 204) return undefined;
  return result.json();
}

function json(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkPtySocket(ptyId, ticket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${prefix}/pty/${ptyId}/connect?ticket=${ticket}`);
    let output = '', submitted = false;
    const timeout = setTimeout(() => reject(new Error('PTY WebSocket timed out')), 2000);
    socket.on('message', (chunk) => {
      output += chunk.toString();
      if (!output.includes('$ ')) return;
      if (!output.includes('ran: echo sdk')) {
        if (!submitted) { submitted = true; socket.send('echo '); socket.send('sdk\r'); }
        return;
      }
      clearTimeout(timeout);
      socket.close();
      resolve();
    });
    socket.on('error', reject);
  });
}

async function assertStatus(pathname, status, init) {
  const result = await response(pathname, init);
  assert(result.status === status, `${pathname} returned ${result.status}, expected ${status}`);
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await response('/path')).ok) return;
    } catch {
      // Server startup is intentionally polled.
    }
    await sleep(100);
  }
  throw new Error('Fake server did not start');
}

async function waitForV2Ready() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await fetch(`${v2Origin}/api/info`)).ok) return;
    } catch {
      // Server startup is intentionally polled.
    }
    await sleep(100);
  }
  throw new Error('Fake V2 server did not start');
}

async function nextEvent(reader, predicate) {
  const decoder = new TextDecoder();
  let buffer = '';
  const expiresAt = Date.now() + 3_000;
  while (Date.now() < expiresAt) {
    const { done, value } = await Promise.race([
      reader.read(),
      sleep(3_000).then(() => ({ done: true, value: undefined })),
    ]);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
      if (line) {
        const event = JSON.parse(line.slice(6));
        if (predicate(event)) return event;
      }
    }
  }
  throw new Error('Timed out waiting for SSE event');
}

try {
  await waitUntilReady();

  const pathPayload = await request('/path');
  assert(pathPayload.directory === '/workspace', 'Missing fake path payload');
  assert((await request('/global/health')).version === '1.18.3', 'Unexpected health version');
  assert((await request('/project')).some((project) => project.id === 'project-secondary'), 'Missing secondary project fixture');
  assert(Object.keys(await request('/mcp')).length === 1, 'Expected MCP diagnostic');
  assert((await request('/lsp')).length === 1, 'Expected LSP diagnostic');
  assert((await request('/formatter')).length === 1, 'Expected formatter diagnostic');

  const auth = { type: 'api', key: 'sk-self-test' };
  await request('/auth/openrouter', json('PUT', auth));
  const authorization = await request('/provider/openai/oauth/authorize', json('POST', { method: 0 }));
  assert(authorization.method === 'code', 'OAuth authorize body was not handled');
  await request('/provider/openai/oauth/callback', json('POST', { method: 0, code: 'fake-code' }));

  assert((await request('/command')).some((command) => command.name === 'review'), 'Expected command fixture');
  await assertStatus('/file', 400);
  assert((await request('/find/file?query=demo&directory=/workspace/demo-project')).includes('src/demo.ts'), 'Expected file search result');
  assert((await request('/find?pattern=OpenCode')).some((match) => match.path.text === 'README.md'), 'Expected text search result');
  assert((await request('/find/symbol?query=feature'))[0].name === 'feature', 'Expected symbol search result');
  assert((await request('/file?path=src&directory=/workspace/demo-project')).some((node) => node.name === 'demo.ts' && node.type === 'file'), 'Expected file list result');
  await assertStatus('/find', 400);
  assert((await request('/file/content?path=src%2Fdemo.ts&directory=/workspace/demo-project')).content.includes('1.18.3'), 'Expected file content');
  assert((await request('/file/status')).length === 1, 'Expected initial file status');
  assert((await request('/vcs')).branch === 'main', 'Expected VCS info');
  assert((await request('/vcs/status')).length === 0, 'Expected clean VCS status');
  const patch = 'diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-export const demo = "OpenCode 1.18.3";\n+export const demo = "OpenCode SDK 1.18.3";\n';
  assert((await request('/vcs/apply', json('POST', { patch }))).applied, 'VCS apply failed');
  assert((await request('/vcs/diff?mode=git'))[0].file === 'src/demo.ts', 'Expected structured VCS diff');
  assert((await request('/vcs/diff?mode=branch'))[0].file === 'README.md', 'Expected branch-scoped VCS diff');
  await assertStatus('/vcs/diff', 400);
  assert((await request('/vcs/diff/raw')) === patch, 'Expected raw VCS diff');
  await assertStatus('/vcs/apply', 400, json('POST', { patch }));

  assert((await request('/pty/shells')).some((shell) => shell.name === 'bash'), 'Expected PTY shells');
  const pty = await request('/pty', json('POST', { command: '/bin/sh', args: ['-l'], title: 'Smoke terminal' }));
  assert((await request(`/pty/${pty.id}`)).command === '/bin/sh', 'PTY get failed');
  assert((await request(`/pty/${pty.id}`, json('PUT', { title: 'Renamed terminal', size: { rows: 30, cols: 100 } }))).title === 'Renamed terminal', 'PTY update failed');
  await assertStatus(`/pty/${pty.id}/connect-token`, 403, { method: 'POST' });
  const ptyTicket = (await request(`/pty/${pty.id}/connect-token`, { method: 'POST', headers: { 'x-opencode-ticket': '1' } })).ticket;
  assert(ptyTicket === `ticket-${pty.id}`, 'PTY token failed');
  await checkPtySocket(pty.id, ptyTicket);
  assert((await request('/pty')).length === 1, 'PTY list failed');
  await request(`/pty/${pty.id}`, { method: 'DELETE' });
  await assertStatus(`/pty/${pty.id}`, 404);

  const worktree = await request('/experimental/worktree', json('POST', { name: 'sdk-smoke' }));
  assert((await request('/experimental/worktree')).includes(worktree.directory), 'Worktree list failed');
  assert(await request('/experimental/worktree/reset', json('POST', { directory: worktree.directory })), 'Worktree reset failed');
  await assertStatus('/experimental/worktree', 400, json('POST', { name: 'sdk-smoke' }));
  assert(await request('/experimental/worktree', json('DELETE', { directory: worktree.directory })), 'Worktree remove failed');
  await assertStatus('/experimental/worktree/reset', 400, json('POST', { directory: worktree.directory }));

  const mcpConfig = { type: 'remote', url: 'https://mcp.example.test', enabled: true };
  assert((await request('/mcp', json('POST', { name: 'remote-tools', config: mcpConfig })))['remote-tools'].status === 'connected', 'MCP add failed');
  await request('/mcp/remote-tools/disconnect', { method: 'POST' });
  assert((await request('/mcp'))['remote-tools'].status === 'disabled', 'MCP disconnect failed');
  await request('/mcp/remote-tools/connect', { method: 'POST' });
  const mcpOauth = await request('/mcp/remote-tools/auth', { method: 'POST' });
  assert(mcpOauth.oauthState === 'oauth-remote-tools', 'MCP OAuth start failed');
  assert((await request('/mcp/remote-tools/auth/callback', json('POST', { code: 'mcp-code' }))).status === 'connected', 'MCP OAuth callback failed');
  assert((await request('/mcp/remote-tools/auth', { method: 'DELETE' })).success, 'MCP OAuth remove failed');
  await assertStatus('/mcp/missing/connect', 404, { method: 'POST' });
  await request('/config', json('PATCH', { mcp: { 'remote-tools': { ...mcpConfig, enabled: false } } }));
  assert((await request('/mcp'))['remote-tools'].status === 'disabled', 'Config-backed MCP disable failed');
  await assertStatus('/config', 400, json('PATCH', { mcp: { 'remote-tools': null } }));
  assert((await request('/config')).mcp['remote-tools'], 'Rejected MCP deletion changed config');

  const session = await request('/session', json('POST', { title: 'Smoke session' }));
  const sessionId = session.id;
  assert(sessionId, 'Session creation failed');
  const secondarySession = await request('/session?directory=%2Fworkspace%2Fsecondary-project', json('POST', { title: 'Secondary session' }));
  assert((await request('/session?directory=%2Fworkspace%2Fsecondary-project')).some((entry) => entry.id === secondarySession.id), 'Secondary session was not scoped to its project');
  assert(!(await request('/session?directory=%2Fworkspace%2Fdemo-project')).some((entry) => entry.id === secondarySession.id), 'Secondary session leaked into the default project');
  assert((await request('/session')).some((entry) => entry.id === secondarySession.id), 'Unscoped session list did not include the secondary project session');
  const scopedStatuses = await request('/session/status?directory=%2Fworkspace%2Fdemo-project');
  assert(!(secondarySession.id in scopedStatuses), 'Scoped status leaked another project session');
  const unscopedStatuses = await request('/session/status');
  assert(secondarySession.id in unscopedStatuses, 'Unscoped status missing another project session');
  const renamed = await request(`/session/${sessionId}`, json('PATCH', { title: 'Renamed smoke session' }));
  assert(renamed.title === 'Renamed smoke session', 'Session rename failed');

  await request(`/session/${sessionId}/prompt_async`, json('POST', {
    parts: [{ type: 'text', text: 'Validate fake server flow' }],
  }));
  await sleep(900);
  const messages = await request(`/session/${sessionId}/message`);
  const userMessage = messages.find((message) => message.info.role === 'user');
  assert(messages.length >= 2, 'Expected user and assistant messages');
  const newestPage = await response(`/session/${sessionId}/message?limit=1`);
  const newest = await newestPage.json();
  assert(newest[0].info.id === messages.at(-1).info.id, 'V1 must start with the newest page');
  const older = await request(`/session/${sessionId}/message?limit=1&before=${encodeURIComponent(newestPage.headers.get('x-next-cursor'))}`);
  assert(older[0].info.id === messages.at(-2).info.id, 'V1 cursor must retrieve the previous page');
  assert((await request(`/session/${sessionId}/diff`)).length === 0, 'Expected message-scoped diff contract');
  assert((await request(`/session/${sessionId}/diff?messageID=${userMessage.info.id}`)).length > 0, 'Expected user message diff payload');
  assert((await request('/file/status')).length === 2, 'Expected completed task file status');
  assert(await request(`/session/${sessionId}/init`, json('POST', { modelID: 'gpt-4.1-mini', providerID: 'openai', messageID: userMessage.info.id })), 'Session init failed');
  await assertStatus(`/session/${sessionId}/init`, 400, json('POST', {}));
  const shellMessage = await request(`/session/${sessionId}/shell`, json('POST', { agent: 'build', command: 'npm test' }));
  assert(shellMessage.parts[0].text.includes('/shell npm test'), 'Session shell failed');

  const commandMessage = await request(`/session/${sessionId}/command`, json('POST', { command: 'review', arguments: 'src' }));
  assert(commandMessage.parts[0].text.includes('/review src'), 'Command execution failed');
  const forked = await request(`/session/${sessionId}/fork`, json('POST', {}));
  assert(forked.parentID === sessionId, 'Session fork failed');
  assert((await request(`/session/${sessionId}/children`)).some((child) => child.id === forked.id), 'Session children failed');
  await assertStatus('/session/missing/children', 404);
  assert((await request(`/session/${sessionId}/share`, { method: 'POST' })).share.url, 'Session share failed');
  assert(!(await request(`/session/${sessionId}/share`, { method: 'DELETE' })).share, 'Session unshare failed');
  const messageId = (await request(`/session/${sessionId}/message`))[0].info.id;
  assert((await request(`/session/${sessionId}/revert`, json('POST', { messageID: messageId }))).revert.messageID === messageId, 'Session revert failed');
  assert(!(await request(`/session/${sessionId}/unrevert`, { method: 'POST' })).revert, 'Session unrevert failed');
  const archived = await request(`/session/${sessionId}`, json('PATCH', { time: { archived: 1234567890 } }));
  assert(archived.time.archived === 1234567890, 'Session archive failed');
  assert(!(await request('/session')).some((entry) => entry.id === sessionId), 'Archived session leaked into active list');
  assert((await request('/experimental/session?archived=true')).some((entry) => entry.id === sessionId && entry.project.id === 'project-demo'), 'Experimental archived list failed');
  assert((await request('/experimental/session?archived=true')).some((entry) => entry.id === forked.id && !entry.time.archived), 'archived=true must include active sessions');
  assert(!(await request('/experimental/session?archived=false')).some((entry) => entry.id === sessionId), 'archived=false must exclude archived sessions');
  await request('/__control/reset', json('POST', { scenario: 'permission' }));
  const permissionSession = await request('/session', json('POST', { title: 'Permission session' }));
  const abortController = new AbortController();
  const streamResponse = await response('/global/event', { signal: abortController.signal });
  assert(streamResponse.ok && streamResponse.body, 'Global event stream failed');
  const reader = streamResponse.body.getReader();
  await request(`/session/${permissionSession.id}/prompt_async`, json('POST', {
    parts: [{ type: 'text', text: 'Trigger permission' }],
  }));
  const envelope = await nextEvent(reader, (event) => event.payload?.type === 'permission.asked');
  assert(envelope.directory === '/workspace/demo-project', 'Global event directory missing');
  assert(envelope.payload.properties.id, 'Permission event did not include the full request');
  assert((await request('/permission')).length === 1, 'Pending permission list failed');
  await request(
    `/permission/${envelope.payload.properties.id}/reply`,
    json('POST', { reply: 'once' }),
  );
  abortController.abort();

  await request(`/session/${permissionSession.id}`, { method: 'DELETE' });
  assert(!(await response(`/session/${permissionSession.id}`)).ok, 'Session delete failed');
  await request('/__control/reset', json('POST', { scenario: 'question' }));
  const questionSession = await request('/session', json('POST', { title: 'Question session' }));
  await request(`/session/${questionSession.id}/prompt_async`, json('POST', {
    parts: [{ type: 'text', text: 'Trigger question' }],
  }));
  await sleep(800);
  assert((await request(`/session/${questionSession.id}/message`)).length === 1, 'Reset leaked a scheduled completion into the question scenario');
  assert((await request('/session/status'))[questionSession.id].type === 'busy', 'Reset completion changed the question session status');
  const questions = await request('/question');
  assert(questions.length === 1, 'Pending question list failed');
  await request(`/question/${questions[0].id}/reply`, json('POST', { answers: [['Minimal']] }));

  // --- OpenCode 2 contract -------------------------------------------------
  v2Server = spawn(process.execPath, ['tests/fake-opencode/server-v2.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_OPENCODE_PORT: String(v2Port),
      FAKE_OPENCODE_SCENARIO: 'happy-path',
    },
    stdio: 'inherit',
  });
  await waitForV2Ready();

  async function v2request(pathname, init) {
    const result = await fetch(`${v2Origin}${pathname}`, init);
    if (!result.ok) throw new Error(`${pathname} failed with ${result.status}`);
    if (result.status === 204) return undefined;
    return result.json();
  }

  const v2Info = await v2request('/api/info');
  assert(v2Info.version === '2.0.0-fake', 'V2 server info missing');
  const code = await v2request('/__control/pairing', json('POST', { password: 'local-password' }));
  assert((await fetch(`${v2Origin}/api/info`)).status === 401, 'Protected V2 info must require credentials');
  const token = await v2request(`/auth/connect/${code.code}`, { headers: { Accept: 'application/json' } });
  assert(typeof token.token === 'string', 'Local pairing must return a session token');
  assert((await fetch(`${v2Origin}/auth/connect/${code.code}`)).status === 401, 'Local pairing codes must work only once');
  assert((await v2request('/api/info', { headers: { Authorization: `Basic ${Buffer.from(`opencode:${token.token}`).toString('base64')}` } })).version === '2.0.0-fake', 'Pairing tokens must authenticate API requests');
  const expired = await v2request('/__control/pairing', json('POST', { expired: true }));
  assert((await fetch(`${v2Origin}/auth/connect/${expired.code}`)).status === 401, 'Expired local codes must fail');
  await v2request('/__control/reset', json('POST', { scenario: 'happy-path' }));
  const initialProviders = (await v2request('/api/provider')).data;
  assert(initialProviders.length === 1 && initialProviders[0].id === 'openai', 'V2 lists active providers, not its unconnected catalog');
  const integrations = (await v2request('/api/integration')).data;
  assert(integrations.some((item) => item.id === 'opencode-go' && item.connections.length === 0 && item.methods.some((method) => method.type === 'key')), 'V2 unconnected Go key integration missing');
  const keyPath = '/api/integration/opencode-go/connect/key?location[directory]=/workspace/demo-project';
  const emptyKey = await fetch(`${v2Origin}${keyPath}`, json('POST', { key: '' }));
  assert(emptyKey.status === 400, 'V2 key login must reject an empty key');
  const missingKeyLocation = await fetch(`${v2Origin}/api/integration/opencode-go/connect/key`, json('POST', { key: 'test-key' }));
  assert(missingKeyLocation.status === 400, 'V2 key login must include location');
  await v2request(keyPath, json('POST', { key: 'test-go-key' }));
  assert((await v2request('/api/provider')).data.some((item) => item.id === 'opencode-go'), 'V2 key login must activate Go');
  assert((await v2request('/api/model')).data.some((item) => item.providerID === 'opencode-go' && item.enabled), 'V2 key login must expose Go models');
  assert((await v2request('/api/integration')).data.find((item) => item.id === 'opencode-go').connections.some((connection) => connection.method === 'key'), 'V2 key login must retain the credential connection');
  const v2Directory = '/workspace/secondary-project';
  const v2Session = (await v2request('/api/session', json('POST', { title: 'V2 smoke session', location: { directory: v2Directory } }))).data;
  assert(v2Session.model?.id === 'openai/gpt-4.1-mini' && v2Session.model.providerID === 'openai', 'V2 session did not expose a model');
  assert(v2Session.tokens?.input === 0 && v2Session.cost === 0, 'V2 session did not expose usage fields');
  const missingPrompt = await fetch(`${v2Origin}/api/session/ses_missing/prompt`, json('POST', { text: 'Missing session' }));
  assert(missingPrompt.status === 404, 'V2 prompts must reject a missing session');

  const v2Api = OpenCode.make({ baseUrl: v2Origin });
  for (const directory of ['/workspace/demo-project', '/workspace/secondary-project']) {
    const listed = await v2Api.file.list({ location: { directory }, path: 'src' });
    assert(listed.data.some((entry) => entry.path === 'src/demo.ts'), 'V2 directory entries must be relative to the workspace');
    const found = await v2Api.file.find({ location: { directory }, query: 'demo' });
    assert(found.data.some((entry) => entry.path === 'src/demo.ts'), 'V2 scoped file search missing');
    const content = new TextDecoder().decode(await v2Api.file.read({ location: { directory }, path: 'src/demo.ts' }));
    assert(content.includes(directory.endsWith('secondary-project') ? directory : 'OpenCode 1.18.3'), 'V2 file reads must respect the directory');
  }
  assert((await fetch(`${v2Origin}/api/fs/list`)).status === 400, 'V2 file listing requires location');
  const createdWorktree = await v2Api.worktree.create({ projectID: 'project-demo', name: 'v2-smoke' });
  assert((await v2Api.worktree.list({ projectID: 'project-demo' })).some((entry) => entry.directory === createdWorktree.directory), 'V2 worktree inventory missing');
  assert((await v2Api.location.get({ location: { directory: createdWorktree.directory } })).project.id === 'project-demo', 'Worktrees retain their parent project');
  await v2Api.worktree.remove({ projectID: 'project-demo', directory: createdWorktree.directory, force: true });
  await v2request('/api/session', json('POST', { title: 'Other workspace session' }));
  const scopedSessions = await v2Api.session.list({ directory: v2Directory });
  assert(scopedSessions.data.length === 1 && scopedSessions.data[0].id === v2Session.id, 'V2 scoped lists must exclude other workspace sessions');
  assert((await v2Api.session.list()).data.length === 2, 'V2 unscoped lists must include all workspace sessions');
  const v2EventsController = new AbortController();
  const v2Reader = (await fetch(`${v2Origin}/api/event`, { signal: v2EventsController.signal })).body.getReader();
  const v2RunningEvent = nextEvent(v2Reader, (event) => event.type === 'session.status' && event.data.sessionID === v2Session.id);
  const admitted = await v2Api.session.prompt({ sessionID: v2Session.id, text: 'Validate V2 contract' });
  assert(admitted.type === 'user' && admitted.sessionID === v2Session.id && admitted.payload.text === 'Validate V2 contract', 'V2 prompt must return the admitted input through the SDK');
  assert((await v2RunningEvent).location.directory === v2Directory, 'V2 session events must use their session directory');
  v2EventsController.abort();
  await sleep(900);
  const v2Messages = (await v2request(`/api/session/${v2Session.id}/message`)).data;
  assert(v2Messages.some((message) => message.id === admitted.id && message.type === 'user'), 'V2 prompt admission must identify the stored user message');
  const v2Newest = await v2request(`/api/session/${v2Session.id}/message?limit=1&order=desc`);
  assert(v2Newest.data[0].id === v2Messages[0].id && v2Newest.cursor.next, 'V2 newest-first pagination failed');
  const v2Older = await v2request(`/api/session/${v2Session.id}/message?limit=1&cursor=${encodeURIComponent(v2Newest.cursor.next)}`);
  assert(v2Older.data[0].id === v2Messages[1].id, 'V2 cursor must preserve descending order');
  const invalidCursorOrder = await fetch(`${v2Origin}/api/session/${v2Session.id}/message?cursor=${encodeURIComponent(v2Newest.cursor.next)}&order=desc`);
  assert(invalidCursorOrder.status === 400, 'V2 rejects explicit order together with a cursor');
  const v2Assistant = v2Messages.find((message) => message.type === 'assistant');
  assert(v2Assistant.tokens.input === 1200 && v2Assistant.tokens.cache.read === 800 && v2Assistant.tokens.output === 240, 'V2 assistant usage missing');
  assert(v2Assistant.cost > 0, 'V2 assistant cost missing');
  const v2Listed = (await v2request('/api/session')).data.find((entry) => entry.id === v2Session.id);
  assert(v2Listed.tokens.input === 1200 && v2Listed.cost > 0, 'V2 session usage did not accumulate');
  assert(v2Listed.model?.id === 'openai/gpt-4.1-mini', 'V2 session list dropped the model');

  // Session instruction entries back the adapter's `system` prompt mapping.
  const instructionPath = `/api/experimental/session/${v2Session.id}/instructions/entries/opencode-mobile.chat-preferences`;
  await v2request(instructionPath, json('PUT', { value: 'prefer brief answers' }));
  const instructions = (await v2request(`/api/experimental/session/${v2Session.id}/instructions/entries`)).data;
  assert(instructions.some((entry) => entry.key === 'opencode-mobile.chat-preferences' && entry.value === 'prefer brief answers'), 'V2 instruction entry was not stored');
  await v2request(instructionPath, { method: 'DELETE' });
  assert((await v2request(`/api/experimental/session/${v2Session.id}/instructions/entries`)).data.length === 0, 'V2 instruction entry was not removed');
  const missingInstruction = await fetch(`${v2Origin}/api/experimental/session/ses_missing/instructions/entries/x`, json('PUT', { value: 'x' }));
  assert(missingInstruction.status === 404, `V2 instruction put for a missing session returned ${missingInstruction.status}`);

  await fetch(`${v2Origin}/__control/reset`, json('POST', { scenario: 'inbox' }));
  const inboxSession = await v2Api.session.create({ title: 'Inbox contract' });
  await v2Api.session.prompt({ sessionID: inboxSession.id, text: 'Initial response' });
  const steered = await v2Api.session.prompt({ sessionID: inboxSession.id, text: 'Steering hint', delivery: 'steer' });
  const queued = await v2Api.session.prompt({ sessionID: inboxSession.id, text: 'Later turn', delivery: 'queue', files: [{ uri: 'data:text/plain;base64,aGVsbG8=', name: 'notes.txt' }] });
  assert((await v2Api.session.inbox.list({ sessionID: inboxSession.id })).length === 2, 'Inbox must retain both delivery modes');
  assert(!(await v2Api.message.list({ sessionID: inboxSession.id })).data.some((item) => item.id === queued.id), 'Pending prompt must not enter the transcript before delivery');
  await fetch(`${v2Origin}/__control/inbox`, json('POST', { sessionID: inboxSession.id, action: 'step' }));
  assert((await v2Api.message.list({ sessionID: inboxSession.id })).data.some((item) => item.id === steered.id), 'Steer must enter at the next step');
  assert((await v2Api.session.inbox.list({ sessionID: inboxSession.id }))[0].id === queued.id, 'Append must wait for a later turn');
  await fetch(`${v2Origin}/__control/inbox`, json('POST', { sessionID: inboxSession.id, action: 'complete' }));
  const deliveredFile = (await v2Api.message.list({ sessionID: inboxSession.id })).data.find((item) => item.id === queued.id).files[0];
  assert(deliveredFile.data === 'aGVsbG8=' && deliveredFile.name === 'notes.txt', 'Inbox delivery must preserve attachment bytes');
  const cancelled = await v2Api.session.prompt({ sessionID: inboxSession.id, text: 'Cancel this', delivery: 'queue' });
  await v2Api.session.inbox.update({ sessionID: inboxSession.id, inboxID: cancelled.id, delivery: 'steer' });
  assert((await v2Api.session.inbox.list({ sessionID: inboxSession.id }))[0].delivery === 'steer', 'Inbox update must change delivery');
  await v2Api.session.inbox.cancel({ sessionID: inboxSession.id, inboxID: cancelled.id });
  assert((await v2Api.session.inbox.list({ sessionID: inboxSession.id })).length === 0, 'Cancellation must remove the pending item');

  console.log('Fake OpenCode 1.18.3 server self-test passed.');
  console.log('Fake OpenCode 2.0 server self-test passed.');
} finally {
  server.kill('SIGTERM');
  v2Server?.kill('SIGTERM');
}
