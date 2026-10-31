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

function sessionModel(state, sessionID) {
  const session = state.sessions?.find((entry) => entry.id === sessionID);
  return session?.model?.id ?? session?.model?.modelID;
}

async function waitForIdle(page, request, sessionID) {
  await expect.poll(async () => {
    const state = await controlState(request);
    return state.sessionStatuses?.[sessionID]?.type ?? 'none';
  }, { timeout: 15_000 }).toBe('idle');
  // The server can report idle before the client has processed the completion.
  // Auto-routing skips busy sessions, so wait for the composer to leave the
  // running state before sending the next routed prompt.
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Start conversation mode', { timeout: 15_000 });
}

// Waiting for the prompt admission response pins the run to the session that
// actually accepted it. Without this, an idle check can observe the previous
// run's idle status and send the next prompt while the first run is still busy;
// auto-routing deliberately skips busy sessions and would fall back to the
// explicit model.
async function sendPromptAndWaitForAdmission(page, text) {
  const admission = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/prompt')
  ));
  await sendPrompt(page, text);
  const response = await admission;
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const sessionID = body?.data?.sessionID;
  expect(sessionID).toBeTruthy();
  return sessionID;
}

test('OpenCode classifier routes simple and complex prompts and explicit models turn it off', async ({ page, request }) => {
  await resetScenario(request, 'auto-routing');
  await openReadyChat(page);

  await goToTab(page, 'Settings');
  await ensureAiSection(page);
  await page.getByRole('button', { name: 'Auto model routing', exact: true }).click();

  await page.getByTestId('settings-auto-model-classifier').click();
  await page.getByRole('option', { name: 'OpenCode classifier', exact: true }).click();
  await page.getByTestId('settings-auto-model-check').click();
  await expect(page.getByText('Classifier available.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('switch', { name: 'Enable auto-routing', exact: true }).click();

  await goToTab(page, 'Chat');
  const classifiedBeforeSimple = (await controlState(request)).classifierCalls ?? 0;
  const firstSession = await sendPromptAndWaitForAdmission(page, 'hello');
  await expect.poll(async () => (await controlState(request)).classifierCalls ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(classifiedBeforeSimple);
  await expect.poll(async () => sessionModel(await controlState(request), firstSession), { timeout: 15_000 })
    .toBe('openai/gpt-4.1-nano');
  await waitForIdle(page, request, firstSession);

  const classifiedBeforeComplex = (await controlState(request)).classifierCalls ?? 0;
  const secondSession = await sendPromptAndWaitForAdmission(page, 'Refactor the whole codebase');
  expect(secondSession).toBe(firstSession);
  await expect.poll(async () => (await controlState(request)).classifierCalls ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(classifiedBeforeComplex);
  await expect.poll(async () => sessionModel(await controlState(request), secondSession), { timeout: 15_000 })
    .toBe('openai/o3-mini');
  await waitForIdle(page, request, secondSession);

  const classified = (await controlState(request)).classifierCalls;
  expect(classified).toBeGreaterThanOrEqual(3);

  await page.getByTestId('chat-model-picker-trigger').click();
  await page.getByTestId('chat-model-picker').getByRole('button', { name: /^GPT-4\.1 mini / }).last().click();
  await expect(page.getByTestId('chat-model-picker-trigger')).toHaveAccessibleName('GPT-4.1 mini · OpenAI');

  const classifiedBeforeExplicit = (await controlState(request)).classifierCalls;
  const thirdSession = await sendPromptAndWaitForAdmission(page, 'hello again');
  expect(thirdSession).toBe(firstSession);
  await expect.poll(async () => sessionModel(await controlState(request), thirdSession), { timeout: 15_000 })
    .toBe('openai/gpt-4.1-mini');
  await waitForIdle(page, request, thirdSession);
  expect((await controlState(request)).classifierCalls).toBe(classifiedBeforeExplicit);
});
