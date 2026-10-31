import { expect, test } from './helpers/fixtures.mjs';

import { resetScenario } from './helpers/flows.mjs';

async function boot(page, request, snapshot = { phase: 'available', version: '59' }, startResult = true, nativeConsent = true) {
  await resetScenario(request, 'happy-path');
  await page.addInitScript(({ snapshot, startResult, nativeConsent }) => {
    localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    globalThis.__appUpdateTest = { snapshot, startResult, nativeConsent, checks: 0, events: [] };
  }, { snapshot, startResult, nativeConsent });
  await page.goto('/');
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible({ timeout: 30000 });
  if (!nativeConsent) await expect(notice(page)).toBeVisible();
  else {
    await expect.poll(() => page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start']);
    await expect(page.getByTestId('app-update-handoff')).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
  }
}
const notice = (page) => page.getByTestId('app-update-notice');

test('open sheets suppress immediate native consent until safely closed', async ({ page, request }) => {
  await boot(page, request);
  await page.getByRole('tab', { name: /Settings/ }).click();
  await page.getByTestId('settings-category-advanced').click();
  await expect(page.getByTestId('settings-section-overlay')).toBeVisible();
  await page.evaluate(() => globalThis.__appUpdateTest.emit({ phase: 'available', version: '60' }));
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start']);
  await page.getByTestId('settings-section-overlay').getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start', 'start']);
  await expect(notice(page)).toHaveCount(0);
});

test('a draft suppresses immediate updates until cleared', async ({ page, request }) => {
  await boot(page, request);
  await page.getByPlaceholder('Ask anything...').fill('Unsaved work');
  await page.evaluate(() => globalThis.__appUpdateTest.emit({ phase: 'available', version: '60' }));
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start']);
  await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('Unsaved work');
  await page.getByPlaceholder('Ask anything...').fill('');
  await expect.poll(() => page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start', 'start']);
});

test('interrupted immediate recovery bypasses discovery cadence and respects cancellation cooldown on reload', async ({ page, request }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('opencode-mobile.app-updates')) localStorage.setItem('opencode-mobile.app-updates', JSON.stringify({ lastCheckAt: Date.now(), checkPeriod: 'weekly' }));
  });
  await boot(page, request, { phase: 'inProgress', version: '59' }, false);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.app-updates') || '{}').dismissal?.phase)).toBe('available');
  await page.reload();
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.__appUpdateTest.checks)).toBeGreaterThan(0);
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual([]);
});

test('cancelled native consent does not repeatedly offer the same update', async ({ page, request }) => {
  await boot(page, request, { phase: 'available', version: '59' }, false);
  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByText('Opening the update…', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: /Project/ }).click();
  await expect(notice(page)).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start']);
});

test('App Store navigation remains explicit and uses store-specific copy', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, request, { phase: 'available', version: '1.0.66' }, true, false);
  await expect(notice(page)).toContainText('Install the latest version through the App Store.');
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual([]);
  await notice(page).getByRole('button', { name: 'Open App Store', exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start']);
});

test('the nonmodal banner fits a small screen and keeps navigation usable', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await boot(page, request, { phase: 'available', version: '1.0.66' }, true, false);
  for (const button of await notice(page).getByRole('button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(16);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(304);
  }
  await page.screenshot({ path: test.info().outputPath('updates-mobile-small.png') });
  await page.getByPlaceholder('Ask anything...').fill('Keep composing');
  await expect(notice(page)).toHaveCount(0);
  await page.getByPlaceholder('Ask anything...').fill('');
  await expect(notice(page)).toBeVisible();
  await page.getByRole('tab', { name: /Project/ }).click();
  await expect(page).toHaveURL(/projects/);
  await expect(notice(page)).toBeVisible();
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual([]);
});
