import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import net from 'node:net';

import { fakeV1Origin } from './helpers/flows.mjs';

const V1 = fakeV1Origin();
async function openManual(page, url) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('onboarding-welcome-start').click();
  await page.getByTestId('onboarding-permissions-skip').click();
  await page.getByTestId('connection-method-manual').click();
  await page.getByTestId('connection-profile-url-input').fill(url);
  await page.getByTestId('connection-profile-continue').click();
  await expect(page.getByTestId('connection-profile-password-input')).toBeVisible();
}
async function v2Server(request, password = '') {
  const port = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['tests/fake-opencode/server.mjs'], { env: { ...process.env, FAKE_OPENCODE_PORT: String(port), FAKE_OPENCODE_PASSWORD: password }, stdio: 'inherit' });
  await expect.poll(async () => { try { return (await request.get(`${origin}/api/info`)).status(); } catch { return 0; } }).toBe(password ? 401 : 200);
  return { server, origin };
}

test.beforeEach(async ({ request }) => { await request.post(`${V1}/__control/reset`, { data: { scenario: 'happy-path' } }); });

test('protected V2 asks for credentials without claiming V1, rejects a wrong password and saves a hostname default once', async ({ page, request }) => {
  const { server, origin } = await v2Server(request, 'local-password');
  try {
    await openManual(page, origin);
    await expect(page.getByTestId('connection-profile-detection')).toHaveText('Enter credentials to identify the server.');
    await expect(page.getByTestId('connection-profile-username-input')).toHaveCount(0);
    await expect(page.getByTestId('connection-profile-name-input')).toHaveAttribute('placeholder', '127.0.0.1');
    await page.getByTestId('connection-profile-name-input').fill('   ');
    await page.getByTestId('connection-profile-password-input').fill('wrong');
    await page.getByTestId('connection-profile-save-confirm').click();
    await expect(page.getByTestId('connection-profile-error')).toContainText('Credentials rejected');
    expect(await page.evaluate(() => localStorage.getItem('opencode-mobile.connection-profiles'))).toBeNull();
    await page.getByTestId('connection-profile-password-input').fill('local-password');
    await page.getByTestId('connection-profile-save-confirm').click();
    await expect(page.getByTestId('onboarding-ai')).toBeVisible();
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ name: '127.0.0.1', serverUrl: origin, username: '' });
    expect(profiles[0].password).toBeUndefined();
  } finally { server.kill('SIGTERM'); }
});

test('confirmed V2 hides Username, preserves values through Change and saves a custom name', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { server, origin } = await v2Server(request);
  try {
    await openManual(page, origin);
    await expect(page.getByTestId('connection-profile-detection')).toHaveText('OpenCode 2 detected');
    await expect(page.getByTestId('connection-profile-username-input')).toHaveCount(0);
    await expect(page.getByTestId('connection-local-scan')).toHaveCount(0);
    await page.getByTestId('connection-profile-name-input').fill('Office');
    await page.getByTestId('connection-profile-change').click();
    await expect(page.getByTestId('connection-profile-url-input')).toHaveValue(origin);
    await page.getByTestId('connection-profile-continue').click();
    await expect(page.getByTestId('connection-profile-name-input')).toHaveValue('Office');
    await page.screenshot({ path: 'test-results/manual-v2-details.png', fullPage: true });
    await page.getByTestId('connection-profile-save-confirm').click();
    await expect(page.getByTestId('onboarding-ai')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles'))[0].name)).toBe('Office');
  } finally { server.kill('SIGTERM'); }
});

test('protected V1 custom username remains available after an inconclusive probe', async ({ page }) => {
  const authorization = `Basic ${Buffer.from('alice:secret').toString('base64')}`;
  await page.route(`${V1}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS' || route.request().headers().authorization === authorization) { await route.continue(); return; }
    await route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' }, json: { error: 'Authentication required' } });
  });
  await openManual(page, V1);
  await page.getByTestId('connection-profile-custom-username').click();
  await page.getByTestId('connection-profile-username-input').fill('alice');
  await page.getByTestId('connection-profile-password-input').fill('secret');
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('onboarding-ai')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles'))[0].username)).toBe('alice');
});

test('retry after project discovery fails reuses the saved profile', async ({ page }) => {
  await page.route(`${V1}/path**`, (route) => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
  await openManual(page, V1);
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('connection-profile-error')).not.toHaveText('');
  await expect(page.getByTestId('connection-profile-save-confirm')).toBeEnabled();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')));
  expect(before).toHaveLength(1);
  await page.unroute(`${V1}/path**`);
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('onboarding-ai')).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')));
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(before[0].id);
});

test('editing a saved profile preserves its username and leaves the active connection alone', async ({ page }) => {
  await page.addInitScript((origin) => {
    localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    localStorage.setItem('opencode-mobile.settings', JSON.stringify({ serverUrl: origin, username: '', directory: '' }));
    localStorage.setItem('opencode-mobile.connection-profiles', JSON.stringify([{ id: 'saved', name: 'Office', serverUrl: origin, username: 'alice' }]));
  }, V1);
  await page.goto('/');
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
  let discovery = 0;
  await page.route(`${V1}/path**`, async (route) => { discovery += 1; await route.continue(); });
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Connection\./ }).click();
  await page.getByTestId('connection-row-saved').click();
  await page.getByTestId('connection-edit-saved').click();
  await expect(page.getByTestId('connection-profile-url-input')).toHaveValue(V1);
  await page.getByTestId('connection-profile-continue').click();
  await expect(page.getByTestId('connection-profile-name-input')).toHaveValue('Office');
  await expect(page.getByTestId('connection-profile-username-input')).toHaveValue('alice');
  await page.getByTestId('connection-profile-name-input').fill('Renamed');
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('connection-profile-save-confirm')).toHaveCount(0);
  const stored = await page.evaluate(() => ({ profiles: JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')), settings: JSON.parse(localStorage.getItem('opencode-mobile.settings')) }));
  expect(stored.profiles.find((profile) => profile.id === 'saved')).toEqual({ id: 'saved', name: 'Renamed', serverUrl: V1, username: 'alice' });
  expect(stored.profiles.some((profile) => profile.serverUrl === V1 && profile.username === '')).toBe(true);
  expect(stored.settings).toMatchObject({ serverUrl: V1, username: '' });
  expect(discovery).toBe(0);
});

test('sends custom gateway headers on probe, API and SSE without persisting their values', async ({ page, request }) => {
  const { server, origin } = await v2Server(request);
  const required = { 'CF-Access-Client-Id': 'access-client-id', 'CF-Access-Client-Secret': 'access-client-secret' };
  try {
    expect((await request.post(`${origin}/__control/headers`, { data: { required } })).ok()).toBeTruthy();
    await openManual(page, origin);
    // The first probe has no header editor yet, so the Access gate is visible.
    await expect(page.getByTestId('connection-profile-detection')).toHaveText('Enter credentials to identify the server.');
    await page.getByTestId('connection-profile-headers-toggle').click();
    await page.getByTestId('connection-profile-header-add').click();
    await page.getByTestId('connection-profile-header-name-0').fill('CF-Access-Client-Id');
    await page.getByTestId('connection-profile-header-value-0').fill('access-client-id');
    await page.getByTestId('connection-profile-header-add').click();
    await page.getByTestId('connection-profile-header-name-1').fill('CF-Access-Client-Secret');
    await page.getByTestId('connection-profile-header-value-1').fill('access-client-secret');
    await page.getByTestId('connection-profile-save-confirm').click();
    await expect(page.getByTestId('onboarding-ai')).toBeVisible();

    // The saved connection carries the headers on REST and the shared SSE stream.
    await expect.poll(async () => {
      const state = await (await request.get(`${origin}/__control/state`)).json();
      return state.headers.paths;
    }).toEqual(expect.arrayContaining(['/api/info', '/api/event']));
    const state = await (await request.get(`${origin}/__control/state`)).json();
    expect(state.headers.received).toEqual(required);
    expect(state.headers.required).toEqual(required);

    // Header values are secrets: no AsyncStorage-backed metadata may contain them.
    const stored = await page.evaluate(() => JSON.stringify({
      settings: localStorage.getItem('opencode-mobile.settings'),
      profiles: localStorage.getItem('opencode-mobile.connection-profiles'),
      workspaces: localStorage.getItem('opencode-mobile.workspaces'),
    }));
    expect(stored).not.toContain('access-client-id');
    expect(stored).not.toContain('access-client-secret');
    expect(stored).not.toContain('CF-Access');
  } finally { server.kill('SIGTERM'); }
});
