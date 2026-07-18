import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

async function resetScenario(request, scenario) {
  const response = await request.post('http://127.0.0.1:44096/__control/reset', {
    data: { scenario },
  });

  expect(response.ok()).toBeTruthy();
}

async function openReadyChat(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  if (await page.getByText('Choose a workspace').isVisible().catch(() => false)) {
    await page.getByRole('tab', { name: 'Workspace' }).click();
    await expect(page.getByText('Projects', { exact: true })).toBeVisible();
    await page.getByText('demo-project', { exact: true }).click();
    await page.getByRole('tab', { name: 'Chat' }).click();
  }
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
}

async function sendPrompt(page, prompt) {
  await page.getByPlaceholder('Ask anything...').fill(prompt);
  await page.getByTestId('chat-primary-button').click();
}

async function waitForServer(request, url, timeoutMs = 10_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await request.get(url);
      if (response.ok()) {
        return;
      }
    } catch {
      // Keep polling until the timeout expires.
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for fake server at ${url}`);
}

test('happy path keeps the main chat flow stable', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Stabilize the chat flow against the fake server');

  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Flow stayed stable against the fake OpenCode server/).first()).toBeVisible();
  await page.getByText(/Files Changed/).click();
  await page.getByText('app/(tabs)/index.tsx', { exact: true }).click();
  await expect(page.getByText(/export default function ChatLandingScreen/)).toBeVisible();
  await page.getByRole('tab', { name: 'Workspace' }).click();
  await expect(page.getByText('Chats', { exact: true })).toBeVisible();
  await expect(page.getByText('Stabilize the chat flow', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('idle', { exact: true }).first()).toBeVisible();
});

test('permission requests unblock the agent flow', async ({ page, request }) => {
  await resetScenario(request, 'permission');
  await openReadyChat(page);

  await sendPrompt(page, 'Trigger a permission request');

  await expect(page.getByText('Permission request', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText('Allow once').click();
  await expect(page.getByText(/permission resolved/).first()).toBeVisible({ timeout: 20_000 });
});

test('assistant questions unblock the agent flow', async ({ page, request }) => {
  await resetScenario(request, 'question');
  await openReadyChat(page);

  await sendPrompt(page, 'Ask an implementation question');

  await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText('Minimal', { exact: true }).click();
  await page.getByText('Submit answer', { exact: true }).click();
  await expect(page.getByText(/selected Minimal/).first()).toBeVisible({ timeout: 20_000 });
});

test('sessions can be renamed and require confirmation before deletion', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Create a session to rename');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: 'Workspace' }).click();
  await page.getByText('Rename', { exact: true }).click();
  await page.getByTestId('workspace-session-title-input').fill('Renamed from Playwright');
  await page.getByText('Save', { exact: true }).click();
  await expect(page.getByText('Renamed from Playwright', { exact: true }).first()).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByText('Delete', { exact: true }).click();
  await expect(page.getByText('Renamed from Playwright', { exact: true }).nth(1)).not.toBeVisible();
});

test('commands execute through the primary chat action', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, '/review src');
  await expect(page.getByText('Command /review src completed.', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

test('workspace file search opens deterministic file content', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await page.getByRole('tab', { name: 'Workspace' }).click();
  await page.getByTestId('workspace-file-search').fill('demo');
  await page.getByText('Search', { exact: true }).click();
  await expect(page.getByText('src/demo.ts', { exact: true })).toBeVisible();
  await page.getByText('src/demo.ts', { exact: true }).click();
  await expect(page.getByText(/OpenCode 1\.18\.3/)).toBeVisible();
});

test('settings can configure an additional provider against the fake server', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('AI defaults')).toBeVisible();
  await page.getByTestId('settings-add-provider-button').click();
  await expect(page.getByRole('button', { name: 'OpenRouter', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'OpenRouter', exact: true }).click();
  await expect(page.getByText('Configure OpenRouter')).toBeVisible();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-openrouter');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'OpenRouter', exact: true })).toBeVisible();
});

test('polling fallback still finishes the flow when SSE is unavailable', async ({ page, request }) => {
  await resetScenario(request, 'stream-disconnect');
  await openReadyChat(page);

  await sendPrompt(page, 'Finish through polling fallback');

  await page.getByRole('tab', { name: 'Workspace' }).click();
  await expect(page.getByText('Finish through polling fallback', { exact: true }).last()).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText('idle', { exact: true })).toBeVisible({ timeout: 40_000 });
});

test('settings explain root-vs-api mismatches and reconnect through a prefixed API base URL', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = 44196;
  const server = spawn(process.execPath, ['tests/fake-opencode/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_OPENCODE_PORT: String(port),
      FAKE_OPENCODE_SCENARIO: 'happy-path',
      FAKE_OPENCODE_BASE_PATH: '/api',
    },
    stdio: 'inherit',
  });

  try {
    await waitForServer(request, `http://127.0.0.1:${port}/api/path`);
    await openReadyChat(page);

    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByText('Connection')).toBeVisible();

    await page.getByTestId('settings-server-url-input').fill(`http://127.0.0.1:${port}`);
    await page.getByTestId('settings-reconnect-button').click();
    await expect(page.getByText(new RegExp(`OpenCode endpoint not found at http://127.0.0.1:${port}`)).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(`http://127.0.0.1:${port}/api`)).first()).toBeVisible();

    await page.getByTestId('settings-server-url-input').fill(`http://127.0.0.1:${port}/api`);
    await page.getByTestId('settings-reconnect-button').click();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(`Connected to http://127.0.0.1:${port}/api`))).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});
