import { expect, test } from '@playwright/test';

async function boot(page, request, snapshot = { phase: 'available', version: '59' }, startResult = true) {
  await request.post('http://127.0.0.1:44096/__control/reset', { data: { scenario: 'happy-path' } });
  await page.addInitScript(({ snapshot, startResult }) => {
    localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    globalThis.__appUpdateTest = { snapshot, startResult, checks: 0, events: [] };
  }, { snapshot, startResult });
  await page.goto('/');
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('app-update-notice')).toBeVisible();
}
const notice = (page) => page.getByTestId('app-update-notice');

test('downloads without installing; open sheets suppress the ready offer', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await boot(page, request);
  for (const button of await notice(page).getByRole('button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: '/tmp/opencode-updates-mobile-dark.png' });
  await notice(page).getByRole('button', { name: 'Update', exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await page.getByRole('tab', { name: /Settings/ }).click();
  await page.getByRole('button', { name: /^Advanced\./ }).click();
  await expect(page.getByTestId('settings-section-overlay')).toBeVisible();
  await page.evaluate(() => globalThis.__appUpdateTest.emit({ phase: 'downloaded' }));
  await expect(notice(page)).toHaveCount(0);
  await page.getByTestId('settings-section-overlay').getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(notice(page)).toContainText('Update downloaded.');
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start']);
  await notice(page).getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByText('Installing update…', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start', 'complete']);
});

test('a draft suppresses the ready offer until cleared', async ({ page, request }) => {
  await boot(page, request);
  await notice(page).getByRole('button', { name: 'Update', exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await page.getByPlaceholder('Ask anything...').fill('Unsaved work');
  await page.evaluate(() => globalThis.__appUpdateTest.emit({ phase: 'downloaded' }));
  await expect(notice(page)).toHaveCount(0);
  await page.getByPlaceholder('Ask anything...').fill('');
  await expect(notice(page)).toContainText('Update downloaded.');
});

test('Later survives reload and a downloaded update is recovered without completing', async ({ page, request }) => {
  await boot(page, request, { phase: 'downloaded', version: '59' });
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual([]);
  await notice(page).getByRole('button', { name: 'Later', exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.app-updates') || '{}').dismissal?.phase)).toBe('downloaded');
  await page.reload();
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.__appUpdateTest.checks)).toBeGreaterThan(0);
  await expect(notice(page)).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual([]);
});

test('cancelled native consent does not repeatedly offer the same update', async ({ page, request }) => {
  await boot(page, request, { phase: 'available', version: '59' }, false);
  await notice(page).getByRole('button', { name: 'Update', exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByText('Opening the update…', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: /Workspace/ }).click();
  await expect(notice(page)).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start']);
});
