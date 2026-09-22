import { expect, test } from '@playwright/test';

// TEMPORARY probe (delete after the demo): shows whether the V1 plan
// overlay appears after a happy-path prompt completes.
async function resetScenario(request, scenario) {
  const response = await request.post('http://127.0.0.1:44096/__control/reset', {
    data: { scenario },
  });

  expect(response.ok()).toBeTruthy();
}

test('probe: V1 plan overlay appears after completion', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();

  await page.getByPlaceholder('Ask anything...').fill('execute echo "hello"');
  await page.getByTestId('chat-primary-button').click();

  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });

  await expect(page.getByText('Plan', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('2 of 2 tasks completed')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '/tmp/opencode/plan-overlay-v1.png' });

  await page.getByLabel('Expand plan').click();
  await expect(page.getByText('Validate session transcript')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: '/tmp/opencode/plan-overlay-v1-expanded.png' });
});
