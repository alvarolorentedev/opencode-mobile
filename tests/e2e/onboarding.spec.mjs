import { expect, test } from '@playwright/test';

import { resetScenario } from './helpers/flows.mjs';

// First-run setup coverage. Unlike the flow specs, these tests intentionally do
// NOT seed `opencode-mobile.onboarding-version`, so the assistant is exercised.

const FAKE_SERVER_URL = 'http://127.0.0.1:44096';

async function waitForChat(page) {
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
}

async function openManual(page) {
  await page.getByTestId('connection-method-manual').click();
  await expect(page.getByTestId('connection-profile-url-input')).toBeVisible();
}

async function seedExistingInstall(page) {
  await page.addInitScript(() => {
    // Seed before hydration, but only once per tab so clearing app storage and
    // reloading really exercises a fresh install.
    const seededKey = 'e2e.existing-install-seeded';
    if (globalThis.sessionStorage.getItem(seededKey)) return;
    globalThis.localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    globalThis.localStorage.setItem(
      'opencode-mobile.settings',
      JSON.stringify({ serverUrl: 'http://127.0.0.1:44096', username: '', directory: '' }),
    );
    globalThis.sessionStorage.setItem(seededKey, '1');
  });
}

test.beforeEach(async ({ request }) => {
  await resetScenario(request);
});

test('fresh install walks through onboarding into a working chat', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('onboarding-welcome')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Start a new task')).toHaveCount(0);
  await expect(page.getByText('Step 1 of 5', { exact: true })).toBeVisible();
  await expect(page.getByTestId('onboarding-welcome').getByRole('button')).toHaveCount(1);

  await page.getByTestId('onboarding-welcome-start').click();
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await expect(page.getByText('Step 2 of 5', { exact: true })).toBeVisible();
  await page.getByTestId('onboarding-permissions-skip').click();
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await expect(page.getByText('Step 3 of 5', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await page.getByTestId('onboarding-permissions-continue').click();
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await expect(page.getByTestId('onboarding-connect-test')).toHaveCount(0);
  await expect(page.getByTestId('connection-method-chooser')).toBeVisible();
  await openManual(page);

  await page.getByTestId('connection-profile-url-input').fill(FAKE_SERVER_URL);
  await page.getByTestId('connection-profile-continue').click();
  await expect(page.getByTestId('connection-profile-save-confirm')).toHaveText('Save & connect');
  await page.getByTestId('connection-profile-save-confirm').click();

  await expect(page.getByTestId('onboarding-ai')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('onboarding-ai-continue').click();
  await expect(page.getByTestId('onboarding-project')).toBeVisible();
  await expect(page.getByText('Step 5 of 7', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Select / }).first().click();

  await expect(page.getByTestId('onboarding-general')).toBeVisible();
  await expect(page.getByText('Step 6 of 7', { exact: true })).toBeVisible();
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-ready')).toBeVisible();
  await expect(page.getByText('Step 7 of 7', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('onboarding-general')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('onboarding-project')).toBeVisible();
  await page.getByTestId('onboarding-project-continue').click();
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-ready')).toBeVisible();
  await page.getByTestId('onboarding-ready-start').click();

  await waitForChat(page);

  // Relaunch must go straight to the app.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForChat(page);
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
});

test('every onboarding step can be skipped', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('onboarding-welcome')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('onboarding-welcome-start').click();
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await page.getByTestId('onboarding-permissions-skip').click();

  // Skip the connection step without contacting a server.
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await page.getByTestId('onboarding-connect-skip').click();

  // Server-dependent steps and settings are absent, including on Back.
  await expect(page.getByTestId('onboarding-general')).toBeVisible();
  await expect(page.getByText('Step 4 of 5', { exact: true })).toBeVisible();
  await expect(page.getByTestId('onboarding-default-model')).toHaveCount(0);
  await expect(page.getByTestId('settings-prompt-delivery')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await page.getByTestId('onboarding-connect-skip').click();
  await page.getByTestId('onboarding-general-skip').click();

  await expect(page.getByTestId('onboarding-ready')).toBeVisible();
  await expect(page.getByText('Step 5 of 5', { exact: true })).toBeVisible();
  await expect(page.getByTestId('onboarding-summary-server')).toContainText('Not connected');
  await expect(page.getByTestId('onboarding-summary-language')).toBeVisible();
  await expect(page.getByTestId('onboarding-summary-default-model')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-summary-providers')).toHaveCount(0);
  await page.getByTestId('onboarding-ready-start').click();

  // Completing without a project lands on the chat project prompt instead
  // of a crash, and onboarding does not reappear on relaunch.
  await expect(page.getByText('Select a project in the Projects tab to open its chat context.')).toBeVisible({ timeout: 30_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
});

test('a failed connection keeps entered values and allows retry', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('onboarding-welcome-start').click();
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await page.getByTestId('onboarding-permissions-skip').click();

  await openManual(page);
  const url = page.getByTestId('connection-profile-url-input');
  await url.fill('http://127.0.0.1:1');
  await page.getByTestId('connection-profile-continue').click();

  await expect(page.getByTestId('connection-profile-error')).toBeVisible({ timeout: 25_000 });
  await expect(url).toHaveValue('http://127.0.0.1:1');

  await url.fill(FAKE_SERVER_URL);
  await page.getByTestId('connection-profile-continue').click();
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('onboarding-ai')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('onboarding-ai-continue').click();
  await expect(page.getByTestId('onboarding-project')).toBeVisible();
});

test('an existing configured installation skips onboarding', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      'opencode-mobile.settings',
      JSON.stringify({ serverUrl: 'http://127.0.0.1:44096', username: '', directory: '' }),
    );
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForChat(page);
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
});

test('clearing app data shows onboarding again', async ({ page }) => {
  await seedExistingInstall(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForChat(page);

  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('onboarding-welcome')).toBeVisible({ timeout: 30_000 });
});

test('Advanced groups editor and general settings and resets onboarding without wiping the connection', async ({ page }) => {
  await seedExistingInstall(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForChat(page);

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Advanced/ }).click();
  const editor = page.getByTestId('settings-editor-section');
  const general = page.getByTestId('settings-general-section');
  await expect(editor.getByRole('heading', { name: 'Editor', exact: true })).toBeVisible();
  await expect(editor.getByText('Chat text size', { exact: true })).toBeVisible();
  await expect(editor.getByRole('switch', { name: 'Flat conversation', exact: true })).toBeVisible();
  await expect(editor.getByRole('switch', { name: 'Slim interface', exact: true })).toHaveCount(0);
  await expect(general.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(general.getByRole('switch', { name: 'Slim interface', exact: true })).toBeVisible();
  await expect(general.getByText('Language', { exact: true })).toBeVisible();
  await general.getByRole('button', { name: 'Reset onboarding', exact: true }).click();

  await expect(page.getByTestId('onboarding-welcome')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Review setup · Step 1 of 7')).toBeVisible();
  await page.getByTestId('onboarding-welcome-start').click();
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await page.getByTestId('onboarding-permissions-continue').click();
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await expect(page.getByText('Review setup · Step 3 of 7')).toBeVisible();
  await openManual(page);
  await expect(page.getByTestId('connection-profile-url-input')).toHaveValue(FAKE_SERVER_URL);
  await page.getByTestId('connection-profile-continue').click();
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('onboarding-ai')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('onboarding-ai-continue').click();
  await expect(page.getByTestId('onboarding-project')).toBeVisible();
  await page.getByRole('button', { name: /^Select / }).first().click();
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-ready')).toBeVisible();
  await page.getByTestId('onboarding-ready-start').click();

  // Review mode returns to Settings with the app still usable.
  await page.getByRole('tab', { name: 'Chat' }).click();
  await waitForChat(page);
});


test('connection prevents duplicate submissions and disables Skip while validating', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('onboarding-welcome-start').click();
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await page.getByTestId('onboarding-permissions-skip').click();
  await openManual(page);
  await page.getByTestId('connection-profile-url-input').fill(FAKE_SERVER_URL);
  let probes = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route('**/global/health', async (route) => { probes += 1; await pending; await route.continue(); });
  const connect = page.getByTestId('connection-profile-continue');
  await connect.dispatchEvent('click');
  await connect.dispatchEvent('click');
  await expect(connect).toBeDisabled();
  await expect(page.getByTestId('onboarding-connect-skip')).toBeDisabled();
  await expect(page.getByTestId('connection-profile-url-input')).not.toBeEditable();
  await expect.poll(() => probes).toBe(1);
  release();
  await expect(page.getByTestId('connection-profile-name-input')).toBeVisible();
  expect(probes).toBe(1);
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('onboarding-ai')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('onboarding-ai-continue').click();
  await expect(page.getByTestId('onboarding-project')).toBeVisible();
});

async function enterAiStep(page, serverUrl = FAKE_SERVER_URL) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('onboarding-welcome-start').click();
  await page.getByTestId('onboarding-permissions-skip').click();
  await openManual(page);
  await page.getByTestId('connection-profile-url-input').fill(serverUrl);
  await page.getByTestId('connection-profile-continue').click();
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('onboarding-ai')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Step 4 of 7', { exact: true })).toBeVisible();
}

async function enterGeneralStep(page) {
  await page.getByTestId('onboarding-ai-continue').click();
  await page.getByTestId('onboarding-project-skip').click();
  await expect(page.getByTestId('onboarding-general')).toBeVisible();
}

async function selectPreference(page, testId, option) {
  await page.getByTestId(testId).click();
  const choice = page.getByRole('button', { name: option, exact: true });
  await choice.click();
  await expect(choice).toBeHidden();
}

async function addOpenRouter(page) {
  await page.getByTestId('settings-add-provider-button').click();
  await page.getByRole('button', { name: 'OpenRouter', exact: true }).click();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-onboarding');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).toHaveCount(0);
  await page.getByRole('button', { name: 'OpenRouter 0 of 1 selected', exact: true }).click();
  await page.getByText('Auto', { exact: true }).click();
}

test('onboarding embeds provider setup and persists the reviewed preferences and remembered model', async ({ page }) => {
  await enterAiStep(page);
  await addOpenRouter(page);
  await enterGeneralStep(page);
  await selectPreference(page, 'settings-language', 'English');
  await selectPreference(page, 'settings-transcript-detail', 'Reasoning');
  await page.getByTestId('onboarding-default-model').click();
  await page.getByPlaceholder('Default model').fill('openrouter');
  await expect(page.getByRole('button', { name: 'GPT-4.1 mini · OpenAI', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Auto · OpenRouter', exact: true }).click();
  await selectPreference(page, 'settings-prompt-delivery', 'Append');
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-summary-providers')).toContainText('OpenRouter');
  await expect(page.getByTestId('onboarding-summary-models')).toContainText('Auto · OpenRouter');
  await expect(page.getByTestId('onboarding-summary-language')).toContainText('English');
  await expect(page.getByTestId('onboarding-summary-transcript')).toContainText('Reasoning');
  await expect(page.getByTestId('onboarding-summary-default-model')).toContainText('Auto · OpenRouter');
  await expect(page.getByTestId('onboarding-summary-delivery')).toContainText('Append');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await selectPreference(page, 'settings-transcript-detail', 'Verbose');
  await page.getByTestId('onboarding-general-skip').click();
  await expect(page.getByTestId('onboarding-summary-transcript')).toContainText('Verbose');
  await page.getByTestId('onboarding-ready-start').click();
  await expect(page.getByTestId('chat-model-picker-trigger')).toContainText('Auto');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('chat-model-picker-trigger')).toContainText('Auto');
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences')))).toMatchObject({
    language: 'en', transcriptVerbosity: 'verbose', promptDelivery: 'queue', modelId: 'openrouter/openrouter/auto', providerId: 'openrouter',
  });
  await page.getByTestId('chat-model-picker-trigger').click();
  await page.getByTestId('chat-model-picker').getByRole('button', { name: /^GPT-4\.1 mini / }).click();
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences'))).modelId).toBe('openai/openai/gpt-4.1-mini');
});

test('offline language and transcript choices apply immediately and survive interrupted onboarding', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('onboarding-welcome-start').click();
  await page.getByTestId('onboarding-permissions-skip').click();
  await page.getByTestId('onboarding-connect-skip').click();
  await selectPreference(page, 'settings-transcript-detail', 'Reasoning');
  await selectPreference(page, 'settings-language', 'Español');
  await expect(page.getByText('Ajustes generales', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('onboarding-general')).toBeVisible();
  await expect(page.getByTestId('settings-language')).toContainText('Español');
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences'))).transcriptVerbosity).toBe('reasoning');
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-summary-language')).toContainText('Español');
  await expect(page.getByTestId('onboarding-summary-transcript')).not.toContainText('Basic');
  await expect(page.getByTestId('onboarding-summary-delivery')).toHaveCount(0);
});

test('v1 compatibility onboarding hides message delivery and retains the default model picker', async ({ page }) => {
  await enterAiStep(page, 'http://127.0.0.1:44097');
  await page.getByTestId('onboarding-ai-skip').click();
  await page.getByTestId('onboarding-project-skip').click();
  await expect(page.getByTestId('onboarding-default-model')).toBeEnabled();
  await expect(page.getByTestId('settings-prompt-delivery')).toHaveCount(0);
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-summary-default-model')).toBeVisible();
  await expect(page.getByTestId('onboarding-summary-delivery')).toHaveCount(0);
});

test('onboarding can continue when a connected server has no models', async ({ page }) => {
  await page.route((url) => url.pathname === '/api/model', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, data: [] } });
  });
  await enterAiStep(page);
  await expect(page.getByTestId('onboarding-ai').getByText('No models found for your configured providers.')).toBeVisible();
  await enterGeneralStep(page);
  await expect(page.getByTestId('onboarding-default-model')).toBeDisabled();
  await expect(page.getByTestId('onboarding-general').getByText('No models found for your configured providers.')).toBeVisible();
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-summary-models')).toContainText('None');
  await page.getByTestId('onboarding-ready-start').click();
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible();
});

test('provider removal reconciles the remembered model before review', async ({ page }) => {
  let removed = false;
  // The fake retains environment-backed models after credential deletion;
  // model a credential-only provider disappearing from the server catalog.
  await page.route((url) => url.pathname === '/api/provider' || url.pathname === '/api/model', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, data: removed ? body.data.filter((item) => item.id !== 'openrouter' && item.providerID !== 'openrouter') : body.data } });
  });
  await page.route((url) => /^\/api\/credential\/[^/]+$/.test(url.pathname), async (route) => {
    if (route.request().method() !== 'DELETE') { await route.continue(); return; }
    const response = await route.fetch();
    removed = response.ok();
    await route.fulfill({ response });
  });
  await enterAiStep(page);
  await addOpenRouter(page);
  await enterGeneralStep(page);
  await selectPreference(page, 'onboarding-default-model', 'Auto · OpenRouter');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove OpenRouter credentials', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove OpenRouter credentials', exact: true })).toHaveCount(0);
  await enterGeneralStep(page);
  await expect(page.getByTestId('onboarding-default-model')).not.toContainText('Auto');
  await selectPreference(page, 'onboarding-default-model', 'GPT-4.1 mini · OpenAI');
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-summary-providers')).not.toContainText('OpenRouter');
  await expect(page.getByTestId('onboarding-summary-default-model')).toContainText('GPT-4.1 mini · OpenAI');
});

for (const appearance of [
  { name: 'dark mobile', colorScheme: 'dark', viewport: { width: 390, height: 844 } },
  { name: 'light narrow', colorScheme: 'light', viewport: { width: 320, height: 700 } },
]) {
  test.describe(appearance.name, () => {
    test.use({ viewport: appearance.viewport, colorScheme: appearance.colorScheme });
    test('onboarding settings and review fit the viewport and keep navigation usable', async ({ page }, info) => {
      await enterAiStep(page);
      await page.screenshot({ path: info.outputPath('providers.png') });
      await enterGeneralStep(page);
      await selectPreference(page, 'settings-language', 'English');
      const footer = page.getByTestId('onboarding-general-continue');
      const bounds = await footer.boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(appearance.viewport.height);
      await page.screenshot({ path: info.outputPath('general.png') });
      await selectPreference(page, 'onboarding-default-model', 'GPT-4.1 mini · OpenAI');
      await footer.click();
      await expect(page.getByTestId('onboarding-summary-default-model')).toContainText('GPT-4.1 mini · OpenAI');
      await expect(page.getByTestId('onboarding-ready-start')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('review.png') });
    });
  });
}
