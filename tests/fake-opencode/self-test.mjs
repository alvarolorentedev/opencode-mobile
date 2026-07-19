#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

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
    let output = '';
    const timeout = setTimeout(() => reject(new Error('PTY WebSocket timed out')), 2000);
    socket.on('message', (chunk) => {
      output += chunk.toString();
      if (!output.includes('$ ')) return;
      if (!output.includes('ran: echo sdk')) {
        socket.send('echo sdk\n');
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
  assert(Object.keys(await request('/mcp')).length === 1, 'Expected MCP diagnostic');
  assert((await request('/lsp')).length === 1, 'Expected LSP diagnostic');
  assert((await request('/formatter')).length === 1, 'Expected formatter diagnostic');

  const auth = { type: 'api', key: 'sk-self-test' };
  await request('/auth/openrouter', json('PUT', auth));
  const authorization = await request('/provider/openai/oauth/authorize', json('POST', { method: 0 }));
  assert(authorization.method === 'code', 'OAuth authorize body was not handled');
  await request('/provider/openai/oauth/callback', json('POST', { method: 0, code: 'fake-code' }));

  assert((await request('/command')).some((command) => command.name === 'review'), 'Expected command fixture');
  assert((await request('/find/file?query=demo')).includes('src/demo.ts'), 'Expected file search result');
  assert((await request('/find?pattern=OpenCode')).some((match) => match.path.text === 'README.md'), 'Expected text search result');
  assert((await request('/find/symbol?query=feature'))[0].name === 'feature', 'Expected symbol search result');
  assert((await request('/file?path=src')).some((node) => node.name === 'demo.ts' && node.type === 'file'), 'Expected file list result');
  await assertStatus('/find', 400);
  assert((await request('/file/content?path=src%2Fdemo.ts')).content.includes('1.18.3'), 'Expected file content');
  assert((await request('/file/status')).length === 1, 'Expected initial file status');
  assert((await request('/vcs')).branch === 'main', 'Expected VCS info');
  assert((await request('/vcs/status')).length === 0, 'Expected clean VCS status');
  const patch = 'diff --git a/src/demo.ts b/src/demo.ts\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-export const demo = "OpenCode 1.18.3";\n+export const demo = "OpenCode SDK 1.18.3";\n';
  assert((await request('/vcs/apply', json('POST', { patch }))).applied, 'VCS apply failed');
  assert((await request('/vcs/diff?mode=git'))[0].file === 'src/demo.ts', 'Expected structured VCS diff');
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
  const renamed = await request(`/session/${sessionId}`, json('PATCH', { title: 'Renamed smoke session' }));
  assert(renamed.title === 'Renamed smoke session', 'Session rename failed');

  await request(`/session/${sessionId}/prompt_async`, json('POST', {
    parts: [{ type: 'text', text: 'Validate fake server flow' }],
  }));
  await sleep(900);
  const messages = await request(`/session/${sessionId}/message`);
  const userMessage = messages.find((message) => message.info.role === 'user');
  assert(messages.length >= 2, 'Expected user and assistant messages');
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

  console.log('Fake OpenCode 1.18.3 server self-test passed.');
} finally {
  server.kill('SIGTERM');
}
