import { expect, test } from '@playwright/test';

import { resetScenario, seedOnboarding } from './helpers/flows.mjs';

// Seed a completed onboarding marker so this probe boots straight into chat.
test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

// TEMPORARY probe (delete after the demo): shows whether the V1 plan
// overlay appears after a happy-path prompt completes.
test('probe: V1 plan overlay appears after completion', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();

  await page.getByPlaceholder('Ask anything...').click();
  await page.getByPlaceholder('Ask anything...').fill('execute echo "hello"');
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Send task');
  await page.getByTestId('chat-primary-button').click();

  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });

  await expect(page.getByRole('button', { name: 'Open progress. 2 of 2 tasks completed' })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '/tmp/opencode/plan-overlay-v1.png' });

  await page.getByRole('button', { name: 'Open progress. 2 of 2 tasks completed' }).click();
  await expect(page.getByText('Validate session transcript')).toBeVisible({ timeout: 10_000 });
  const sheet = page.getByTestId('progress-overlay-sheet');
  await expect(sheet).toBeVisible();
  expect((await sheet.boundingBox()).height).toBeLessThan(300);
  await page.screenshot({ path: '/tmp/opencode/plan-overlay-v1-expanded.png' });
});
