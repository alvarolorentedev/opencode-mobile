import { expect, test } from '@playwright/test';

import { connectToServer, getFreePort, openReadyChat, resetScenario, seedOnboarding, sendPrompt, spawnV2Server, waitForServer } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

for (const scenario of ['permission', 'question']) {
  test(`incoming ${scenario} dismisses changes and its source picker`, async ({ page, request }) => {
    await resetScenario(request, scenario);
    await openReadyChat(page);
    const promptRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/prompt'));
    await sendPrompt(page, 'Create changes after resolving a blocker');
    const promptUrl = (await promptRequest).url();
    if (scenario === 'permission') {
      await page.getByText('Allow once', { exact: true }).click();
    } else {
      await page.getByText('Minimal', { exact: true }).click();
      await page.getByText('Submit answer', { exact: true }).click();
    }
    await expect(page.getByTestId('chat-changes-chip')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('chat-changes-chip').click();
    await page.getByRole('button', { name: /Change files changed source/ }).click();
    await expect(page.getByTestId('diff-source-overlay')).toBeVisible();
    const response = await request.post(promptUrl, { data: { text: 'Request another blocker' } });
    expect(response.ok()).toBeTruthy();
    await expect(page.getByTestId('changes-overlay')).toHaveCount(0);
    await expect(page.getByTestId('diff-source-overlay')).toHaveCount(0);
    await expect(page.getByText(scenario === 'permission' ? 'Allow once' : 'Which implementation should be used?', { exact: true })).toBeVisible();
  });
}

test('permission requests unblock the agent flow', async ({ page, request }) => {
  await resetScenario(request, 'permission');
  await openReadyChat(page);

  await sendPrompt(page, 'Trigger a permission request');

  await expect(page.getByText('Approval needed', { exact: true }).last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Always allow applies to these future patterns:')).toBeVisible();
  await expect(page.getByText('app/(tabs)/*', { exact: true })).toBeVisible();
  await expect(page.getByText('The OpenCode server controls how long future approval rules apply.')).toBeVisible();
  await page.getByText('Allow once').click();
  await expect(page.getByText(/permission resolved/).first()).toBeVisible({ timeout: 20_000 });
});

test('assistant questions unblock the agent flow', async ({ page, request }) => {
  await resetScenario(request, 'question');
  await openReadyChat(page);

  await sendPrompt(page, 'Ask an implementation question');

  await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Make the smallest safe change.', { exact: true })).toBeVisible();
  await expect(page.getByText('Include broader improvements.', { exact: true })).toBeVisible();
  await page.getByText('Minimal', { exact: true }).click();
  await page.getByText('Submit answer', { exact: true }).click();
  await expect(page.getByText(/"approach":"minimal"/).first()).toBeVisible({ timeout: 20_000 });
});

test('multi-step questions keep drafts across dismissal and submit conditional custom answers', async ({ page, request }) => {
  await resetScenario(request, 'question-multi');
  await openReadyChat(page);
  await sendPrompt(page, 'Ask several implementation questions');

  await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText('Expanded', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Which areas should change?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Return to chat' }).click();
  await expect(page.getByText('Answer needed')).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText('Which areas should change?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Why choose the expanded approach?', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('textbox').fill('Needed for both screens');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('Needed for both screens');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText(/question resolved.*expanded.*chat.*Needed for both screens/).first()).toBeVisible({ timeout: 20_000 });
});

test('question submission failure keeps the answer and allows retry', async ({ page, request }) => {
  await resetScenario(request, 'question-failure');
  await openReadyChat(page);
  await sendPrompt(page, 'Ask a question that fails once');
  await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText('Minimal', { exact: true }).click();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('dialog').getByText(/503/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText(/Finished: question resolved.*minimal/).first()).toBeVisible({ timeout: 20_000 });
});

test('OpenCode 2 permission requests unblock the agent flow', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port, 'permission');
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await sendPrompt(page, 'Trigger a permission request');
    await expect(page.getByText('Approval needed', { exact: true }).last()).toBeVisible({ timeout: 15_000 });
    await page.getByText('Allow once').click();
    await expect(page.getByText(/permission resolved/).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    server.kill('SIGTERM');
  }
});

test('OpenCode 2 questions unblock the agent flow', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port, 'question');
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await sendPrompt(page, 'Ask an implementation question');
    await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByText('Minimal', { exact: true }).click();
    await page.getByText('Submit answer', { exact: true }).click();
    await expect(page.getByText(/question resolved/).first()).toBeVisible({ timeout: 20_000 });
    // The submitted label is translated back to the form option's value, not the label.
    await expect(page.getByText(/"approach":"minimal"/).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    server.kill('SIGTERM');
  }
});
