import { expect, test } from '@playwright/test';

// Web smoke coverage for the share route. OS share-sheet delivery and the
// native staging path cannot run in the browser, so this only proves the route
// renders, is reachable outside onboarding, and returns to chat. Native
// acceptance is required for the real share flow.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
  });
});

test('share route opens empty and returns to chat without submitting', async ({ page }) => {
  await page.goto('/share', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('There was nothing to share.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(page.getByText('There was nothing to share.')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('tab', { name: /Chat/ })).toBeVisible();
});
