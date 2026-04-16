#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const port = 4196;
const server = spawn(process.execPath, ['tests/fake-opencode/server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    FAKE_OPENCODE_PORT: String(port),
    FAKE_OPENCODE_SCENARIO: 'happy-path',
  },
  stdio: 'inherit',
});

async function request(pathname, init) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}`);
  }

  return response.json();
}

try {
  await sleep(500);

  const pathPayload = await request('/path');
  if (!pathPayload?.directory) {
    throw new Error('Missing fake path payload');
  }

  const sessionPayload = await request('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Smoke session' }),
  });
  const sessionId = sessionPayload?.id;
  if (!sessionId) {
    throw new Error('Session creation failed');
  }

  await request(`/session/${sessionId}/prompt_async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parts: [{ type: 'text', text: 'Validate fake server flow' }],
    }),
  });

  await sleep(900);

  const messagesPayload = await request(`/session/${sessionId}/message`);
  const messages = messagesPayload || [];
  if (messages.length < 2) {
    throw new Error('Expected user and assistant messages');
  }

  const diffPayload = await request(`/session/${sessionId}/diff`);
  if ((diffPayload || []).length === 0) {
    throw new Error('Expected diff payload');
  }

  console.log('Fake OpenCode server self-test passed.');
} finally {
  server.kill('SIGTERM');
}
