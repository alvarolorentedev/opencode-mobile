import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

import { expect, test } from './helpers/fixtures.mjs';

import { backendOrigin, connectToServer, ensureAiSection, ensureConnectionSection, fakeV1Origin, getFreePort, goToTab, openReadyChat, reconnectActiveConnection, resetScenario, seedOnboarding, sendPrompt, setActiveServerUrl, waitForServer } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

test('settings can configure an additional provider against the fake server @smoke', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Settings');
  await ensureAiSection(page);
  await expect(page.getByText('Configured providers')).toBeVisible();
  await page.getByTestId('settings-add-provider-button').click();
  await expect(page.getByRole('radio', { name: 'OpenRouter', exact: true }).or(page.getByRole('button', { name: 'OpenRouter', exact: true }))).toBeVisible();
  await page.getByRole('radio', { name: 'OpenRouter', exact: true }).or(page.getByRole('button', { name: 'OpenRouter', exact: true })).click();
  await expect(page.getByText('Configure OpenRouter')).toBeVisible();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-openrouter');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('radio', { name: 'OpenRouter', exact: true }).or(page.getByRole('button', { name: 'OpenRouter', exact: true }))).toBeVisible();
});

test('V1 providers retain API-key login alongside OAuth metadata', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await page.route('**/provider/auth?**', (route) => route.fulfill({ json: {
    openrouter: [{ type: 'oauth', label: 'Sign in with account' }],
  } }));
  await openReadyChat(page);
  await goToTab(page, 'Settings');
  await ensureAiSection(page);
  await page.getByTestId('settings-add-provider-button').click();
  await page.getByRole('radio', { name: 'OpenRouter', exact: true }).or(page.getByRole('button', { name: 'OpenRouter', exact: true })).click();
  await expect(page.getByText('Configure OpenRouter')).toBeVisible();
  // The login-method picker offers both the server OAuth method and the generic API key.
  await page.getByTestId('provider-method-select').click();
  await expect(page.getByRole('option', { name: 'Sign in with account', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'API key', exact: true }).click();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-manual-key');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Remove OpenRouter credentials', exact: true })).toBeVisible();
});

test('chat model picker searches and groups models by provider', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Settings');
  await ensureAiSection(page);
  await page.getByTestId('settings-add-provider-button').click();
  await page.getByRole('radio', { name: 'OpenRouter', exact: true }).or(page.getByRole('button', { name: 'OpenRouter', exact: true })).click();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-openrouter');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'OpenRouter 0 of 1 selected' }).click();
  await page.getByText('Auto', { exact: true }).click();

  await goToTab(page, 'Chat');
  await page.getByTestId('chat-model-picker-trigger').click();
  const modelPicker = page.getByTestId('chat-model-picker');
  await expect(modelPicker.getByText('OpenAI', { exact: true })).toBeVisible();
  await expect(modelPicker.getByText('OpenRouter', { exact: true })).toBeVisible();
  await expect(modelPicker.getByText('Selected', { exact: true })).toBeVisible();
  await page.getByTestId('chat-model-picker-search').fill('openrouter');
  await expect(modelPicker.getByText('OpenAI', { exact: true })).not.toBeVisible();
  await expect(modelPicker.getByText('Selected', { exact: true })).not.toBeVisible();
  await modelPicker.getByRole('button', { name: /^Auto / }).click();
  await expect(page.getByTestId('chat-model-picker-trigger')).toHaveAccessibleName('Auto · OpenRouter');

  await page.getByTestId('chat-model-picker-trigger').click();
  await expect(page.getByTestId('chat-model-picker-search')).toHaveValue('');
  await modelPicker.getByRole('button', { name: /^GPT-4\.1 mini / }).click();
  await expect(page.getByTestId('chat-model-picker-trigger')).toContainText('GPT-4.1 mini');

  await page.getByTestId('chat-model-picker-trigger').click();
  await expect(modelPicker.getByText('Selected', { exact: true })).toBeVisible();
  await expect(modelPicker.getByText('Recent', { exact: true })).toBeVisible();
  await expect(modelPicker.getByText('OpenRouter · openrouter/auto', { exact: false })).toBeVisible();
  await page.getByTestId('chat-model-picker-search').fill('not-a-model');
  await expect(modelPicker.getByText('Recent', { exact: true })).not.toBeVisible();
  await expect(page.getByText('No matching models', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-model-picker-search')).toHaveValue('not-a-model');
  await page.getByTestId('chat-model-picker').getByRole('button', { name: 'Close', exact: true }).click();
});

test('deep links switch projects and open a specific session', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = backendOrigin();
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/api/session`, {
    data: { title: 'Deep Link Target Session', location: { directory: projectPath } },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()).data;
  const sessionId = created.id;
  expect(sessionId).toBe('session-1');

  await request.post(`${fakeServer}/api/session/${sessionId}/prompt`, {
    data: { text: 'Open me through a deep link' },
  });
  await sleep(1500);
  await openReadyChat(page);

  await page.goto(`/session/${sessionId}?project=${encodeURIComponent(projectPath)}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    page.locator('text="Deep Link Target Session" >> visible=true').first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('text="Open me through a deep link" >> visible=true').first(),
  ).toBeVisible();
  await expect(
    page.locator('text=/Finished: Open me through a deep link/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('deep links report sessions that are missing', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = backendOrigin();

  await request.post(`${fakeServer}/api/session`, {
    data: { title: 'Existing Session' },
  });

  await page.goto(`/session/session-999?project=${encodeURIComponent('/workspace/demo-project')}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('Could not open session', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/was not found/).first()).toBeVisible();
});

test('settings explain root-vs-api mismatches and reconnect through a prefixed API base URL', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = await getFreePort();
  const server = spawn(process.execPath, ['tests/fake-opencode/server-v1.mjs'], {
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

    await goToTab(page, 'Settings');
    await ensureConnectionSection(page);

    await setActiveServerUrl(page, `http://127.0.0.1:${port}`);
    await reconnectActiveConnection(page);
    await expect(page.getByText(new RegExp(`OpenCode endpoint not found at http://127.0.0.1:${port}`)).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(`http://127.0.0.1:${port}/api`)).first()).toBeVisible();

    await setActiveServerUrl(page, `http://127.0.0.1:${port}/api`);
    await reconnectActiveConnection(page);
    await expect(page.getByTestId('settings-section-overlay').getByText(/Connected to /).first()).toBeVisible({ timeout: 15_000 });
    await ensureConnectionSection(page);
    await expect(page.getByText(new RegExp(`Connected to http://127.0.0.1:${port}/api`))).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});

test('settings do not suggest a duplicated /api base when the API prefix is already set', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Settings');
  await ensureConnectionSection(page);

  const v1Api = `${fakeV1Origin()}/api`;
  await setActiveServerUrl(page, v1Api);
  await reconnectActiveConnection(page);
  await expect(page.getByText(`OpenCode endpoint not found at ${v1Api}`).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/OpenCode 1\.x and 2\.x servers/).first()).toBeVisible();
  await expect(page.getByText(`${v1Api}/api`)).toHaveCount(0);
});

test('a 1.x server exposing /api compatibility routes still connects as 1.x', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawn(process.execPath, ['tests/fake-opencode/server-v1.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_OPENCODE_PORT: String(port),
      FAKE_OPENCODE_SCENARIO: 'happy-path',
      FAKE_OPENCODE_V2_COMPAT: '1',
    },
    stdio: 'inherit',
  });

  try {
    await waitForServer(request, `http://127.0.0.1:${port}/global/health`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await sendPrompt(page, 'Confirm 1.x stays on 1.x');
    await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 30_000 });

    await goToTab(page, 'Settings');
    await ensureConnectionSection(page);
    await expect(page.getByText(new RegExp(`Connected to http://127\\.0\\.0\\.1:${port} \\(OpenCode 1\\.x\\)`))).toBeVisible({ timeout: 15_000 });
  } finally {
    server.kill('SIGTERM');
  }
});

test('settings search reveals advanced controls, preserves the query and keeps preferences unchanged @smoke', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Settings');
  const search = page.getByTestId('settings-search');
  const before = await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences'));
  await search.fill('wake phrase');
  await page.getByRole('button', { name: 'Wake phrase. Voice & audio', exact: true }).click();
  const sheet = page.getByTestId('settings-section-overlay');
  const destination = page.getByTestId('settings-search-destination');
  await expect(sheet.getByRole('button', { name: 'More audio settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(destination.getByRole('textbox')).toHaveValue('hey code');
  await expect(destination).toBeInViewport();
  expect(await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences'))).toBe(before);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(search).toHaveValue('wake phrase');
  await search.fill('not-a-setting');
  await expect(page.getByText('No matching settings. Try another word.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByTestId('settings-category-appearance')).toBeVisible();
});

test('appearance changes persist and settings remain usable at narrow widths', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Settings');
  await page.getByTestId('settings-category-appearance').click();
  const sheet = page.getByTestId('settings-section-overlay');
  await page.getByTestId('settings-theme-mode').click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  await page.getByTestId('settings-accent-purple').click();
  await expect(page.getByTestId('settings-accent-purple')).toHaveAttribute('aria-checked', 'true');
  const slim = sheet.getByRole('switch', { name: 'Slim interface', exact: true });
  await slim.click();
  await expect(slim).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByTestId('settings-category-appearance').click();
  await expect(page.getByTestId('settings-theme-mode')).toContainText('Light');
  await expect(page.getByTestId('settings-accent-purple')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByRole('switch', { name: 'Slim interface', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: test.info().outputPath('settings-appearance-narrow-light.png') });
});

test('search follows the interface language and opens the matching category', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Settings');
  await page.getByTestId('settings-category-language').click();
  await page.getByTestId('settings-language').click();
  await page.getByRole('option', { name: 'Español', exact: true }).click();
  await page.getByTestId('settings-section-overlay').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByTestId('settings-search').fill('tema');
  await page.getByRole('button', { name: 'Modo del tema. Apariencia', exact: true }).click();
  await expect(page.getByTestId('settings-search-destination').getByTestId('settings-theme-mode')).toBeVisible();
});
