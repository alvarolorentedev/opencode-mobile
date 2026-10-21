import { expect, test } from '@playwright/test';

import { connectToServer, exerciseInteractiveTerminal, getFreePort, goToTab, openReadyChat, resetScenario, seedOnboarding, spawnV2Server, waitForServer } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

test('terminal streams input and output over the PTY websocket', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Terminal');
  await page.getByTestId('terminal-selector').click();
  await expect(page.getByTestId('terminal-picker-sheet')).toBeVisible();
  await page.getByTestId('terminal-picker').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Type directly in the terminal. Use the accessory for terminal keys.')).toBeVisible();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const { output, input, id, snapshot } = await exerciseInteractiveTerminal(page, request, 'http://127.0.0.1:44096', 'echo web');
  await page.getByTestId('terminal-create-button').click();
  await page.getByTestId('terminal-create-confirm').click();
  await expect(output).not.toHaveAttribute('data-pty', id);
  await expect(page.getByTestId('terminal-selector')).toContainText('Connected');
  await output.click(); await input.pressSequentially('echo second'); await input.press('Enter');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo second');
  await page.getByTestId('terminal-selector').click();
  await page.getByRole('button', { name: new RegExp(`^Open Terminal, ${id.slice(0, 8)}$`) }).click();
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo web');
  await expect(output.locator('.xterm-accessibility-tree')).not.toContainText('ran: echo second');
  await expect.poll(async () => (await snapshot())[0].connections).toBe(2);
  await request.post('http://127.0.0.1:44096/__control/terminal', { data: { id, action: 'fail-terminate' } });
  await page.getByTestId('terminal-selector').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: new RegExp(`^Close Terminal, ${id.slice(0, 8)}$`) }).click();
  await expect(page.getByText(/OpenCode request failed \(500\)/)).toBeVisible();
  await page.getByTestId('terminal-picker').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo web');
  await page.getByTestId('terminal-selector').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: new RegExp(`^Close Terminal, ${id.slice(0, 8)}$`) }).click();
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo second');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^Close Terminal,/ }).click();
  await expect(page.getByText('No terminals yet. Use + to create one.')).toBeVisible();
});

test('OpenCode 2 terminal streams input and output over the PTY websocket', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port);
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await goToTab(page, 'Terminal');
    await page.getByTestId('terminal-create-button').click();
    await exerciseInteractiveTerminal(page, request, `http://127.0.0.1:${port}`, 'echo v2');
    await page.getByTestId('terminal-selector').click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^Close Terminal,/ }).click();
    await expect(page.getByText('No terminals yet. Use + to create one.')).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});
