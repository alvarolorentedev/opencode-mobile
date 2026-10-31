import { expect, test } from './helpers/fixtures.mjs';

import { respondToConfirmation, resetScenario, fakeV1Origin, fakeV2Origin } from './helpers/flows.mjs';

// First-run setup coverage. Unlike the flow specs, these tests intentionally do
// NOT seed `opencode-mobile.onboarding-version`, so the assistant is exercised.

let FAKE_SERVER_URL;

async function waitForChat(page) {
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
}

async function openManual(page) {
  await page.getByTestId('connection-method-manual').click();
  await expect(page.getByTestId('connection-profile-url-input')).toBeVisible();
}

async function seedExistingInstall(page) {
  const serverUrl = FAKE_SERVER_URL;
  await page.addInitScript((url) => {
    // Seed before hydration, but only once per tab so clearing app storage and
    // reloading really exercises a fresh install.
    const seededKey = 'e2e.existing-install-seeded';
    if (globalThis.sessionStorage.getItem(seededKey)) return;
    globalThis.localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    globalThis.localStorage.setItem(
      'opencode-mobile.settings',
      JSON.stringify({ serverUrl: url, username: '', directory: '' }),
    );
    globalThis.sessionStorage.setItem(seededKey, '1');
  }, serverUrl);
}

test.beforeEach(async ({ request }) => {
  FAKE_SERVER_URL = fakeV2Origin();
  await resetScenario(request);
});

test('fresh install walks through onboarding into a working chat @smoke', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('onboarding-welcome')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Start a new task')).toHaveCount(0);
  await expect(page.getByText('Step 1 of 6', { exact: true })).toBeVisible();
  await expect(page.getByTestId('onboarding-welcome').getByRole('button')).toHaveCount(1);

  await page.getByTestId('onboarding-welcome-start').click();
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await expect(page.getByText('Step 2 of 6', { exact: true })).toBeVisible();
  await page.getByTestId('onboarding-permissions-skip').click();
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await expect(page.getByText('Step 3 of 6', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Step 5 of 8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Select / }).first().click();

  await expect(page.getByTestId('onboarding-general')).toBeVisible();
  await expect(page.getByText('Step 6 of 8', { exact: true })).toBeVisible();
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-continue').click();
  await expect(page.getByTestId('onboarding-ready')).toBeVisible();
  await expect(page.getByText('Step 8 of 8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('onboarding-general')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('onboarding-project')).toBeVisible();
  await page.getByTestId('onboarding-project-continue').click();
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-continue').click();
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
  await expect(page.getByText('Step 4 of 6', { exact: true })).toBeVisible();
  await expect(page.getByTestId('onboarding-default-model')).toHaveCount(0);
  await expect(page.getByTestId('settings-prompt-delivery')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await page.getByTestId('onboarding-connect-skip').click();
  await page.getByTestId('onboarding-general-skip').click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-skip').click();

  await expect(page.getByTestId('onboarding-ready')).toBeVisible();
  await expect(page.getByText('Step 6 of 6', { exact: true })).toBeVisible();
  await expect(page.getByTestId('onboarding-summary-server')).toContainText('Not connected');
  await expect(page.getByTestId('onboarding-summary-language')).toBeVisible();
  await expect(page.getByTestId('onboarding-summary-default-model')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-summary-providers')).toHaveCount(0);
  await page.getByTestId('onboarding-ready-start').click();

  // Completing without a server or project lands on the connection recovery
  // panel instead of a crash, and onboarding does not reappear on relaunch.
  await expect(page.getByText('Connect to OpenCode Mobile')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
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
  await page.addInitScript((serverUrl) => {
    globalThis.localStorage.setItem(
      'opencode-mobile.settings',
      JSON.stringify({ serverUrl, username: '', directory: '' }),
    );
  }, FAKE_SERVER_URL);

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

test('settings categories separate everyday preferences and review setup without wiping the connection', async ({ page }) => {
  await seedExistingInstall(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForChat(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByTestId('settings-category-responses').click();
  const sheet = page.getByTestId('settings-section-overlay');
  await expect(sheet.getByRole('slider', { name: 'Chat text size', exact: true })).toBeVisible();
  await expect(sheet.getByRole('switch', { name: 'Flat conversation', exact: true })).toBeVisible();
  await expect(sheet.getByRole('switch', { name: 'Slim interface', exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('settings-category-appearance').click();
  await expect(sheet.getByRole('switch', { name: 'Slim interface', exact: true })).toBeVisible();
  await expect(page.getByTestId('settings-theme-mode')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('settings-category-language').click();
  await expect(page.getByTestId('settings-language')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('settings-category-support').click();
  await sheet.getByRole('button', { name: 'Review setup', exact: true }).click();

  await expect(page.getByTestId('onboarding-welcome')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Review setup · Step 1 of 8')).toBeVisible();
  await page.getByTestId('onboarding-welcome-start').click();
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible();
  await page.getByTestId('onboarding-permissions-continue').click();
  await expect(page.getByTestId('onboarding-connect')).toBeVisible();
  await expect(page.getByText('Review setup · Step 3 of 8')).toBeVisible();
  await openManual(page);
  await expect(page.getByTestId('connection-profile-url-input')).toHaveValue(FAKE_SERVER_URL);
  await page.getByTestId('connection-profile-continue').click();
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('onboarding-ai')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('onboarding-ai-continue').click();
  await expect(page.getByTestId('onboarding-project')).toBeVisible();
  await page.getByRole('button', { name: /^Select / }).first().click();
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-continue').click();
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
  await expect(page.getByText('Step 4 of 8', { exact: true })).toBeVisible();
}

async function enterGeneralStep(page) {
  await page.getByTestId('onboarding-ai-continue').click();
  await page.getByTestId('onboarding-project-skip').click();
  await expect(page.getByTestId('onboarding-general')).toBeVisible();
}

async function selectPreference(page, testId, option) {
  await page.getByTestId(testId).click();
  const choice = page.getByRole('option', { name: option, exact: true }).or(page.getByRole('radio', { name: option, exact: true }));
  await choice.click();
  await expect(choice).toBeHidden();
}

async function addOpenRouter(page) {
  await page.getByTestId('settings-add-provider-button').click();
  await page.getByRole('radio', { name: 'OpenRouter', exact: true }).or(page.getByRole('button', { name: 'OpenRouter', exact: true })).click();
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
  await page.getByTestId('onboarding-default-model').click();
  await page.getByPlaceholder('Default model').fill('openrouter');
  await expect(page.getByRole('button', { name: 'GPT-4.1 mini · OpenAI', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Auto · OpenRouter', exact: true }).click();
  await selectPreference(page, 'settings-prompt-delivery', 'Append');
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-continue').click();
  await expect(page.getByTestId('onboarding-summary-providers')).toContainText('OpenRouter');
  await expect(page.getByTestId('onboarding-summary-models')).toContainText('Auto · OpenRouter');
  await expect(page.getByTestId('onboarding-summary-language')).toContainText('English');
  await expect(page.getByTestId('onboarding-summary-default-model')).toContainText('Auto · OpenRouter');
  await expect(page.getByTestId('onboarding-summary-delivery')).toContainText('Append');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByTestId('onboarding-general-skip').click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-skip').click();
  await page.getByTestId('onboarding-ready-start').click();
  await expect(page.getByTestId('chat-model-picker-trigger')).toContainText('Auto');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('chat-model-picker-trigger')).toContainText('Auto');
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences')))).toMatchObject({
    language: 'en', promptDelivery: 'queue', modelId: 'openrouter/openrouter/auto', providerId: 'openrouter',
  });
  await page.getByTestId('chat-model-picker-trigger').click();
  await page.getByTestId('chat-model-picker').getByRole('button', { name: /^GPT-4\.1 mini / }).click();
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences'))).modelId).toBe('openai/openai/gpt-4.1-mini');
});

test('offline language choice applies immediately and survives interrupted onboarding', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('onboarding-welcome-start').click();
  await page.getByTestId('onboarding-permissions-skip').click();
  await page.getByTestId('onboarding-connect-skip').click();
  await selectPreference(page, 'settings-language', 'Español');
  await expect(page.getByText('Ajustes generales', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('onboarding-general')).toBeVisible();
  await expect(page.getByTestId('settings-language')).toContainText('Español');
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-continue').click();
  await expect(page.getByTestId('onboarding-summary-language')).toContainText('Español');
  await expect(page.getByTestId('onboarding-summary-delivery')).toHaveCount(0);
});

test('v1 compatibility onboarding hides message delivery and retains the default model picker', async ({ page }) => {
  await enterAiStep(page, fakeV1Origin());
  await page.getByTestId('onboarding-ai-skip').click();
  await page.getByTestId('onboarding-project-skip').click();
  await expect(page.getByTestId('onboarding-default-model')).toBeEnabled();
  await expect(page.getByTestId('settings-prompt-delivery')).toHaveCount(0);
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-continue').click();
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
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-continue').click();
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
  await page.getByRole('button', { name: 'Remove OpenRouter credentials', exact: true }).click();
  await respondToConfirmation(page, true);
  await expect(page.getByRole('button', { name: 'Remove OpenRouter credentials', exact: true })).toHaveCount(0);
  await enterGeneralStep(page);
  await expect(page.getByTestId('onboarding-default-model')).not.toContainText('Auto');
  await selectPreference(page, 'onboarding-default-model', 'GPT-4.1 mini · OpenAI');
  await page.getByTestId('onboarding-general-continue').click();
  await expect(page.getByTestId('onboarding-voice')).toBeVisible();
  await page.getByTestId('onboarding-voice-continue').click();
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
      await expect(page.getByTestId('onboarding-voice')).toBeVisible();
      await expect(page.getByTestId('onboarding-voice-continue')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('voice.png') });
      await page.getByTestId('onboarding-voice-continue').click();
      await expect(page.getByTestId('onboarding-summary-default-model')).toContainText('GPT-4.1 mini · OpenAI');
      await expect(page.getByTestId('onboarding-ready-start')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('review.png') });
    });
  });
}


test('offline voice and response choices persist through Back, Skip, and reload', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('onboarding-welcome-start').click();
  await page.getByTestId('onboarding-permissions-skip').click();
  await page.getByTestId('onboarding-connect-skip').click();
  await page.getByTestId('onboarding-general-continue').click();
  const voice = page.getByTestId('onboarding-voice');
  await expect(voice).toBeVisible();
  await expect(page.getByText('Step 5 of 6', { exact: true })).toBeVisible();
  await voice.getByRole('switch', { name: 'Read replies aloud', exact: true }).click();
  await voice.getByRole('button', { name: 'Response scope. Brief', exact: true }).click();
  await page.getByRole('option', { name: 'Detailed', exact: true }).click();
  await voice.getByRole('switch', { name: 'Simple next actions', exact: true }).click();
  await page.getByTestId('onboarding-voice-continue').click();
  await expect(page.getByTestId('onboarding-summary-voice-input')).toContainText('System');
  await expect(page.getByTestId('onboarding-summary-voice-autoplay')).toContainText('Enabled');
  await expect(page.getByTestId('onboarding-summary-response-style')).toContainText('Detailed');
  await expect(page.getByTestId('onboarding-summary-next-actions')).toContainText('Off');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(voice.getByRole('switch', { name: 'Read replies aloud', exact: true })).toBeChecked();
  await expect(voice.getByRole('button', { name: 'Response scope. Detailed', exact: true })).toBeVisible();
  await page.getByTestId('onboarding-voice-skip').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('onboarding-summary-response-style')).toContainText('Detailed');
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences')))).toMatchObject({
    autoPlayAssistantReplies: true, responseScope: 'detailed', includeNextActions: false,
    voiceWakeMode: 'phrase', ttsEngine: 'system',
  });
  await page.getByTestId('onboarding-ready-start').click();
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible();
});
