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
  if (snapshot.phase === 'downloaded' || !nativeConsent) await expect(notice(page)).toBeVisible();
  else {
    await expect.poll(() => page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start']);
    await expect(page.getByTestId('app-update-handoff')).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
  }
}
const notice = (page) => page.getByTestId('app-update-notice');

test('downloads without installing; open sheets suppress the ready offer', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await boot(page, request);
  await page.evaluate(() => globalThis.__appUpdateTest.emit({ phase: 'downloaded' }));
  await expect(notice(page)).toContainText('Update ready');
  for (const button of await notice(page).getByRole('button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: '/tmp/opencode-updates-mobile-dark.png' });
  const banner = await notice(page).boundingBox();
  const tabs = await page.getByRole('tab', { name: /Settings/ }).boundingBox();
  const composer = await page.getByPlaceholder('Ask anything...').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(banner.y);
  expect(banner.y + banner.height).toBeLessThanOrEqual(tabs.y);
  await page.getByRole('tab', { name: /Settings/ }).click();
  await page.getByTestId('settings-category-advanced').click();
  await expect(page.getByTestId('settings-section-overlay')).toBeVisible();
  await page.evaluate(() => globalThis.__appUpdateTest.emit({ phase: 'downloaded' }));
  await expect(notice(page)).toHaveCount(0);
  await page.getByTestId('settings-section-overlay').getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(notice(page)).toContainText('Update ready');
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start']);
  await notice(page).getByRole('button', { name: 'Restart & install', exact: true }).click();
  await expect(page.getByTestId('app-update-handoff')).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual(['start', 'complete']);
});

test('a draft suppresses the ready offer until cleared', async ({ page, request }) => {
  await boot(page, request);
  await page.getByPlaceholder('Ask anything...').fill('Unsaved work');
  await page.evaluate(() => globalThis.__appUpdateTest.emit({ phase: 'downloaded' }));
  await expect(notice(page)).toHaveCount(0);
  await page.getByPlaceholder('Ask anything...').fill('');
  await expect(notice(page)).toContainText('Update ready');
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
  await boot(page, request, { phase: 'downloaded', version: '59' });
  for (const button of await notice(page).getByRole('button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(16);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(304);
  }
  await page.screenshot({ path: '/tmp/opencode-updates-mobile-small.png' });
  await page.getByPlaceholder('Ask anything...').fill('Keep composing');
  await expect(notice(page)).toHaveCount(0);
  await page.getByPlaceholder('Ask anything...').fill('');
  await expect(notice(page)).toBeVisible();
  await page.getByRole('tab', { name: /Project/ }).click();
  await expect(page).toHaveURL(/projects/);
  await expect(notice(page)).toBeVisible();
  expect(await page.evaluate(() => globalThis.__appUpdateTest.events)).toEqual([]);
});
