import { expect, test } from '@playwright/test';

import { connectToServer, ensureAiSection, getFreePort, goToTab, openChatLibrary, openReadyChat, resetScenario, seedOnboarding, sendPrompt, spawnV2Server, waitForServer } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

test('connects to an OpenCode 2 server and completes a prompt', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = await getFreePort();
  const server = spawnV2Server(port);

  try {
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await sendPrompt(page, 'Verify the OpenCode 2 adapter');
    await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Flow stayed stable against the fake OpenCode server/).first()).toBeVisible();

    // Context utilization must carry session.model/tokens through the V2
    // adapter and measure the latest model call instead of "Unavailable".
    // Fake V2 usage: 1200 in + 800 cache read + 100 cache write + 240 out.
    await page.getByLabel('Show session usage details').click();
    const usageSheet = page.getByTestId('session-usage-overlay-sheet');
    await expect(usageSheet).toBeVisible();
    expect((await usageSheet.boundingBox()).height).toBeLessThan(500);
    await expect(page.getByText('Context utilization', { exact: true })).toBeVisible();
    await expect(page.getByLabel('2 percent context utilization')).toBeVisible();
    await expect(page.getByText('2.3K of 128K input tokens', { exact: true })).toBeVisible();
    await expect(page.getByText('OpenCode did not provide a context limit for this model.')).toHaveCount(0);
    await page.getByText('Close', { exact: true }).click();

    // V2 prompts have no `system` field, so chat preferences must land in a
    // session instruction entry instead of being dropped.
    const instructions = await (await request.get(`http://127.0.0.1:${port}/__control/instructions`)).json();
    const preferenceValues = Object.values(instructions.data).flatMap((entries) => Object.values(entries));
    expect(preferenceValues.some((value) => typeof value === 'string' && value.includes('Keep responses tightly scoped'))).toBe(true);

    // V2 has no server-owned todo endpoint; the plan is derived from the
    // transcript's `todowrite` tool part.
    await expect(page.getByRole('button', { name: 'Open progress. 2 of 2 tasks completed' })).toBeVisible();

    // Unsupported V2 actions are hidden rather than failing at tap time.
    await expect(page.getByTestId('chat-approve-button')).toHaveCount(0);
    await expect(page.getByTestId('chat-agent-button')).toBeVisible();
    await openChatLibrary(page);
    await expect(page.getByRole('button', { name: 'Archived', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Rename / }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Share / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Archive / })).toHaveCount(0);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Advanced/ }).click();
    await expect(page.getByText(/LSP/)).toHaveCount(0);
    await expect(page.getByText(/Formatters/)).toHaveCount(0);
  } finally {
    server.kill('SIGTERM');
  }
});

for (const providerName of ['OpenCode Go', 'OpenRouter']) {
  test(`OpenCode 2 connects ${providerName} using an API key`, async ({ page, request }) => {
    await resetScenario(request, 'happy-path');
    const port = await getFreePort();
    const server = spawnV2Server(port);
    try {
      await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
      await openReadyChat(page);
      await connectToServer(page, `http://127.0.0.1:${port}`);
      await goToTab(page, 'Settings');
      await ensureAiSection(page);
      await page.getByTestId('settings-add-provider-button').click();
      await page.getByRole('button', { name: new RegExp(`${providerName}$`) }).click();
      await expect(page.getByText(`Configure ${providerName}`)).toBeVisible();
      await page.getByPlaceholder('Paste your API key').fill('sk-test-provider');
      await page.getByTestId('settings-provider-save-button').click();
      await expect(page.getByText(`Configure ${providerName}`)).not.toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: `Remove ${providerName} credentials`, exact: true })).toBeVisible();
      await page.getByRole('button', { name: new RegExp(`${providerName} [0-9]+ of`) }).click();
      await expect(page.getByText('Auto', { exact: true })).toBeVisible();
      // A reconnect must rediscover the saved connection rather than relying
      // on local UI state.
      await page.reload();
      await ensureAiSection(page);
      await expect(page.getByRole('button', { name: `Remove ${providerName} credentials`, exact: true })).toBeVisible();
      await page.getByRole('button', { name: new RegExp(`${providerName} [0-9]+ of`) }).click();
      await expect(page.getByText('Auto', { exact: true })).toBeVisible();
      // Existing connections can also replace a key without removing the
      // provider first (including providers connected through environment).
      await page.getByRole('button', { name: new RegExp(`${providerName}$`) }).click();
      await expect(page.getByText(`Configure ${providerName}`)).toBeVisible();
      await page.getByPlaceholder('Paste your API key').fill('sk-test-replacement');
      await page.getByTestId('settings-provider-save-button').click();
      await expect(page.getByText(`Configure ${providerName}`)).not.toBeVisible();
    } finally {
      server.kill('SIGTERM');
    }
  });
}

test('OpenCode 2 lists provider accounts and switches the active one', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = await getFreePort();
  const server = spawnV2Server(port);
  try {
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await goToTab(page, 'Settings');
    await ensureAiSection(page);

    await expect(page.getByText('Accounts', { exact: true })).toBeVisible();
    const work = page.getByRole('button', { name: 'Work', exact: true });
    const personal = page.getByRole('button', { name: 'Personal', exact: true });
    await expect(work).toBeVisible();
    await expect(personal).toBeVisible();

    await personal.click();
    await expect(personal).toBeVisible();

    const removeButtons = page.getByRole('button', { name: 'Remove account', exact: true });
    await expect(removeButtons).toHaveCount(2);
    await removeButtons.last().click();
    await expect(personal).not.toBeVisible();
    await expect(work).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});
