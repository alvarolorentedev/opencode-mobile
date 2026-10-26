import { expect, test } from './helpers/fixtures.mjs';

import { backendOrigin, goToTab, openReadyChat, resetScenario, seedOnboarding, sendPrompt } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

for (const scenario of ['happy-path', 'permission', 'question', 'stream-disconnect']) {
  test(`v1 compatibility retains the ${scenario} prompt lifecycle`, async ({ page, request }) => {
    await resetScenario(request, scenario);
    await openReadyChat(page);
    await sendPrompt(page, 'Compatibility prompt');
    if (scenario === 'permission') await page.getByRole('button', { name: 'Allow once', exact: true }).click();
    if (scenario === 'question') {
      await page.getByText('Minimal', { exact: true }).click();
      await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
    }
    await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 40_000 });
    await page.reload();
    await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 30_000 });
  });
}

for (const mode of ['auto', 'code']) {
  test(`v2 MCP OAuth completes through ${mode} authorization`, async ({ page, request }) => {
    await resetScenario(request, 'happy-path'); await openReadyChat(page);
    await goToTab(page, 'Settings'); await page.getByText('Extensions', { exact: true }).click();
    await page.getByText('Remote', { exact: true }).click();
    const name = `tools-${mode}`;
    await page.getByTestId('settings-extension-mcp-name').fill(name);
    await page.getByTestId('settings-extension-mcp-target').fill('https://tools.test/mcp');
    await page.getByTestId('settings-extension-mcp-add').click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'OAuth', exact: true }).click();
    await page.getByTestId('settings-provider-save-button').click();
    if (mode === 'code') {
      await page.getByTestId('provider-oauth-code-input').fill('authorization-code');
      await page.getByTestId('provider-oauth-complete-button').click();
    }
    await expect(page.getByText(`Configure ${name}`, { exact: true })).not.toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await (await request.get(`${backendOrigin()}/__control/state`)).json()).mcpStatuses[name].status).toBe('connected');
  });
}
