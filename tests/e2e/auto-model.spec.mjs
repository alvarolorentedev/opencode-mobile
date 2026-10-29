import { expect, test } from './helpers/fixtures.mjs';

import {
  backendOrigin,
  ensureAiSection,
  goToTab,
  openReadyChat,
  resetScenario,
  seedOnboarding,
  sendPrompt,
} from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

async function controlState(request) {
  const response = await request.get(`${backendOrigin()}/__control/state`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function waitForIdle(page, request) {
  await expect.poll(async () => {
    const state = await controlState(request);
    const sessionId = state.sessions[0]?.id;
    return sessionId ? state.sessionStatuses?.[sessionId]?.type ?? 'idle' : 'none';
  }, { timeout: 15_000 }).toBe('idle');
  // The server can report idle before the client has processed the completion.
  // Auto-routing skips busy sessions, so wait for the composer to leave the
  // running state before sending the next routed prompt.
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Start conversation mode', { timeout: 15_000 });
}

test('OpenCode classifier routes simple and complex prompts and explicit models turn it off', async ({ page, request }) => {
  await resetScenario(request, 'auto-routing');
  await openReadyChat(page);

  await goToTab(page, 'Settings');
  await ensureAiSection(page);
  await page.getByRole('button', { name: 'Auto model routing', exact: true }).click();

  await page.getByTestId('settings-auto-model-classifier').click();
  await page.getByRole('button', { name: 'OpenCode classifier', exact: true }).click();
  await page.getByTestId('settings-auto-model-check').click();
  await expect(page.getByText('Classifier available.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('switch', { name: 'Enable auto-routing', exact: true }).click();

  await goToTab(page, 'Chat');
  await sendPrompt(page, 'hello');
  await expect.poll(async () => {
    const session = (await controlState(request)).sessions[0];
    return session?.model?.id ?? session?.model?.modelID;
  }, { timeout: 15_000 }).toBe('openai/gpt-4.1-nano');
  await waitForIdle(page, request);

  await sendPrompt(page, 'Refactor the whole codebase');
  await expect.poll(async () => {
    const session = (await controlState(request)).sessions[0];
    return session?.model?.id ?? session?.model?.modelID;
  }, { timeout: 15_000 }).toBe('openai/o3-mini');
  await waitForIdle(page, request);

  const classified = (await controlState(request)).classifierCalls;
  expect(classified).toBeGreaterThanOrEqual(3);

  await page.getByTestId('chat-model-picker-trigger').click();
  await page.getByTestId('chat-model-picker').getByRole('button', { name: /^GPT-4\.1 mini / }).last().click();
  await expect(page.getByTestId('chat-model-picker-trigger')).toHaveAccessibleName('GPT-4.1 mini · OpenAI');

  await sendPrompt(page, 'hello again');
  await expect.poll(async () => {
    const session = (await controlState(request)).sessions[0];
    return session?.model?.id ?? session?.model?.modelID;
  }, { timeout: 15_000 }).toBe('openai/gpt-4.1-mini');
  await waitForIdle(page, request);
  expect((await controlState(request)).classifierCalls).toBe(classified);
});
