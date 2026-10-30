import { expect, test } from './helpers/fixtures.mjs';
import { Buffer } from 'node:buffer';

import { fakeV2Origin, pauseClockBefore } from './helpers/flows.mjs';

// Native APIs/SecureStore are substituted only in the development E2E build.
const CONTROL_PLANE = 'https://api.opencodecloud.link';
const STAGING = 'https://apistaging.opencodecloud.link';
let SERVER;
const CONNECT_SERVER = 'https://connect-machine.test';
const PRODUCT = 'fixture.connect';
function pairingLink(id = 'pair-1') {
  const url = new URL('opencodemobile://pair');
  for (const [key, value] of Object.entries({ v: '1', cp: CONTROL_PLANE, id, t: 'temporary-test-pairing', n: 'Test Mac' })) url.searchParams.set(key, value);
  return url;
}
async function storeFixture(page, options = {}) {
  await page.addInitScript(({ productId, options }) => {
    const purchase = { id: 'native-transaction', productId, store: 'google', purchaseState: 'purchased', purchaseToken: 'native-test-proof', quantity: 1, transactionDate: Date.now(), isAutoRenewing: true, isAcknowledgedAndroid: false };
    globalThis.__connectStoreTest = {
      products: [{ id: productId, title: 'Cloud Link Monthly', type: 'subs', platform: 'android', displayPrice: '$4.99', currency: 'USD', description: 'Cloud Link', nameAndroid: 'Cloud Link', subscriptionOffers: [{ id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'native-offer', displayPrice: '$4.99', price: 4.99, period: { unit: 'month', value: 1 }, pricingPhasesAndroid: { pricingPhaseList: [{ formattedPrice: '$4.99', billingPeriod: 'P1M', billingCycleCount: 0 }] } }] }],
      nextPurchase: purchase, restoredPurchases: [purchase], purchases: options.recovered ? [purchase] : [],
      events: [], outcome: options.outcome,
    };
    if (options.secureFailure) globalThis.__connectSecureWriteFailure = true;
  }, { productId: PRODUCT, options });
}
async function openPair(page, completed = true, id = 'pair-1') {
  if (completed) await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto(`/pair?${pairingLink(id).searchParams}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connect-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/pair$/);
  await expect(page.getByTestId('connect-purchase')).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId('connect-machine-name')).toHaveText('Test Mac');
  await expect(page.getByTestId('connect-user-token')).toHaveCount(0);
  await expect(page.getByTestId('connect-token-required')).toHaveCount(0);
}
async function showGuidedSubscription(page) {
  await expect(page.getByTestId('connect-step-1')).toBeVisible();
  await page.getByTestId('connect-next').click();
  await expect(page.getByTestId('connect-step-2')).toBeVisible();
  await page.getByTestId('connect-next').click();
  await expect(page.getByTestId('connect-step-3')).toBeVisible();
}
async function submitLink(page, link) {
  const errorSheet = page.getByTestId('connect-error-sheet');
  if (await errorSheet.isVisible()) await errorSheet.getByRole('button', { name: 'Open pairing link', exact: true }).click();
  else if (await page.getByTestId('connect-subscription-sheet').isVisible()) {
    await page.goto(`/pair?${new URL(link).searchParams}`);
    await expect(page).toHaveURL(/\/pair$/);
    return;
  } else await page.getByTestId('connect-options').click();
  await page.getByTestId('connect-pairing-link').fill(link);
  await page.getByTestId('connect-open-link').click();
}
async function manage(page) {
  await page.getByTestId('connect-options').click();
  await page.getByTestId('connect-manage').click();
  await expect(page.getByTestId('connect-management-panel')).toBeVisible();
}
async function events(page) { return page.evaluate(() => globalThis.__connectStoreTest.events); }
async function openSubscriptionSettings(page) {
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/settings');
  await page.getByRole('button', { name: /^Cloud Link/ }).click();
  await expect(page.getByTestId('subscription-section')).toBeVisible();
}
async function assertNoStoredSecrets(page) {
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  for (const secret of ['device-test-secret', 'test-user-token', 'temporary-test-pairing', 'native-test-proof']) expect(stored).not.toContain(secret);
  expect(page.url()).not.toContain('temporary-test-pairing');
}
async function mockControlPlane(page, options = {}) {
  const paidThrough = Date.now() + (options.ttl ?? 3600000);
  const machine = { id: 'machine-1', name: 'Test Mac', hostname: 'connect-machine.test', public_url: options.serverUrl ?? CONNECT_SERVER, created_at: new Date().toISOString(), access_enabled: true };
  const state = { paidThrough, subscriptionClaims: 0, pairClaims: 0, accesses: 0, deleted: [], machines: options.owned ? [machine] : [], requests: [] };
  await page.route(`${CONNECT_SERVER}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (/\/event$/.test(url.pathname)) { await route.abort(); return; }
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return; }
    if (options.startup && !options.startup.ready) {
      if (url.pathname === '/api/location') options.startup.attempts += 1;
      await route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, contentType: 'text/html', body: '<html>Cloudflare Error 1033</html>' }); return;
    }
    const response = await route.fetch({ url: `${SERVER}${url.pathname}${url.search}` });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await page.route('https://offline-machine.test/**', (route) => route.abort());
  const controlPlane = options.controlPlane ?? CONTROL_PLANE;
  await page.route(`${controlPlane}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(new URL(controlPlane).pathname.replace(/\/$/, '').length);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    state.requests.push({ method: request.method(), path });
    const send = (json, status = 200) => route.fulfill({ status, headers, json });
    if (path === '/v1/subscriptions/catalog') {
      expect(request.headers().authorization).toBeUndefined();
      await send({ plans: [{ id: 'cloudlink', entitlements: ['cloudlink'], products: [{ store: 'google', productId: options.productId ?? PRODUCT, basePlanId: 'monthly', offerIds: [] }] }] }, options.catalogStatus ?? 200); return;
    }
    if (path === '/v1/subscriptions/claim') {
      state.subscriptionClaims += 1;
      expect(request.headers().authorization).toBeUndefined();
      expect(request.postDataJSON()).toEqual({ store: 'google', purchaseToken: 'native-test-proof' });
      await page.evaluate(() => globalThis.__connectStoreTest.events.push('claim'));
      if (options.testPurchase) { await send({ error: 'Google test purchases are disabled in this environment' }, 403); return; }
      if (options.subscriptionStatus && state.subscriptionClaims === 1) { await send({ error: 'store unavailable' }, options.subscriptionStatus); return; }
      await send({ user_id: 'store-owner', user_token: 'test-user-token', session_expires_at: new Date(Date.now() + 86400000).toISOString(), subscription_expires_at: new Date(state.paidThrough).toISOString(), entitlements: ['cloudlink'] }); return;
    }
    expect(request.headers().authorization).toBe('Bearer test-user-token');
    const connection = { server_url: machine.public_url, machine_id: options.mismatch ? 'wrong-machine' : machine.id, machine_name: machine.name, device_id: `device-${state.accesses + 1}`, device_secret: 'device-test-secret', expires_at: new Date(state.paidThrough).toISOString() };
    if (/\/pairings\//.test(path)) {
      state.pairClaims += 1;
      expect(request.postDataJSON()).toEqual({ pairing_token: 'temporary-test-pairing', device_name: 'Web test device' });
      if (options.pairStatus && state.pairClaims === 1) { await send({ error: options.pairStatus === 409 ? 'pairing expired' : 'invalid pairing token' }, options.pairStatus); return; }
      state.machines = [machine];
      if (options.lostResponse && state.pairClaims === 1) { await route.abort(); return; }
      if (state.pairClaims > 1 && options.lostResponse) { await send({ error: 'pairing already redeemed', machine_id: machine.id }, 409); return; }
      if (options.reconciliation && state.pairClaims === 1) { await send({ error: 'access pending', machine_id: machine.id }, 503); return; }
      await send(connection); return;
    }
    if (/\/access$/.test(path)) {
      state.accesses += 1;
      if (Date.now() >= state.paidThrough || options.accessStatus) { await send({ error: 'no active subscription' }, options.accessStatus ?? 403); return; }
      await send({ ...connection, device_id: `device-${state.accesses + 1}` }); return;
    }
    if (request.method() === 'DELETE') {
      state.deleted.push(path.split('/').at(-1)); state.machines = [];
      await route.fulfill({ status: 204, headers }); return;
    }
    await send({ machines: state.machines.map((entry) => ({ ...entry, access_enabled: Date.now() < state.paidThrough })) });
  });
  return state;
}

test.beforeEach(async ({ request }) => {
  SERVER = fakeV2Origin();
  expect((await request.post(`${SERVER}/__control/reset`, { data: { scenario: 'happy-path' } })).ok()).toBeTruthy();
});
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

async function startApprovalWait(page, startup, theme = 'dark') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: theme });
  await page.clock.install();
  await storeFixture(page, { recovered: true });
  const state = await mockControlPlane(page, { startup });
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair');
  await expect(page.getByTestId('connect-options')).toBeEnabled();
  await submitLink(page, pairingLink().toString());
  await expect(page.getByTestId('connect-progress')).toHaveText('Confirm this connection on your computer.');
  await expect.poll(() => startup.attempts).toBeGreaterThan(0);
  // Pause before the first 3s startup retry. Computing the target in Node
  // immediately before pauseAt avoids the page.evaluate round trip that used to
  // let CI load advance the fake clock past the target.
  await pauseClockBefore(page);
  return state;
}

test('Cloud Link waits beyond 15 seconds without recovery controls and connects automatically @smoke', async ({ page }) => {
  const startup = { ready: false, attempts: 0 };
  const state = await startApprovalWait(page, startup);
  await page.clock.runFor(16_000);
  await expect(page.getByTestId('connect-progress')).toHaveText('Confirm this connection on your computer.');
  await expect(page.getByTestId('connect-error-sheet')).toHaveCount(0);
  await expect(page.getByTestId('connect-retry')).toHaveCount(0);
  await expect(page.getByTestId('connect-options')).toBeDisabled();
  await page.screenshot({ path: '/tmp/opencode-cloud-link-waiting.png' });
  startup.ready = true;
  await page.clock.runFor(15_000); await page.clock.resume();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(state.pairClaims).toBe(1); expect(state.accesses).toBe(0);
});

test('Cloud Link delayed activation stays calm and explicit Retry reuses credentials', async ({ page }) => {
  const startup = { ready: false, attempts: 0 };
  const state = await startApprovalWait(page, startup);
  await page.clock.fastForward(121_000);
  await expect(page.getByTestId('connect-delayed')).toHaveText('No approval yet. Approve on your computer, or scan a fresh QR code.');
  await expect(page.getByTestId('connect-error')).toHaveCount(0);
  await expect(page.getByTestId('connect-retry-connection')).toHaveCount(0);
  await expect(page.getByTestId('connect-rescan')).toHaveText('Scan the new QR code on your computer');
  const attempts = startup.attempts;
  await page.clock.fastForward(180_000);
  expect(startup.attempts).toBe(attempts);
  await page.screenshot({ path: '/tmp/opencode-cloud-link-delayed.png' });
  startup.ready = true; await page.clock.resume();
  await page.getByTestId('connect-retry').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(state.pairClaims).toBe(1); expect(state.accesses).toBe(0);
  await assertNoStoredSecrets(page);
});

test('Cloud Link delayed activation can scan the regenerated QR without deleting the saved profile', async ({ page }) => {
  const startup = { ready: false, attempts: 0 };
  const state = await startApprovalWait(page, startup, 'light');
  await page.clock.fastForward(121_000);
  await expect(page.getByTestId('connect-delayed')).toBeVisible();
  await page.clock.resume(); await page.getByTestId('connect-rescan').click();
  await expect(page.getByTestId('connect-error-sheet')).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('opencode-mobile.connection-profiles'));
  expect(saved).toContain('machine-1');
  startup.ready = true;
  await submitLink(page, pairingLink('regenerated').toString());
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(state.pairClaims).toBe(2); expect(state.accesses).toBe(0);
});

for (const theme of ['dark', 'light']) {
  test(`Subscription Settings shows verified access and opens management without a camera (${theme})`, async ({ page }) => {
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await storeFixture(page, { recovered: true });
    const state = await mockControlPlane(page, { owned: true });
    await openSubscriptionSettings(page);
    await expect(page.getByTestId('subscription-status')).toHaveText('Active');
    const date = new Date(state.paidThrough).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
    await expect(page.getByTestId('subscription-expiry')).toHaveText(`Access through ${date}`);
    await expect(page.getByTestId('connect-purchase')).toHaveCount(0);
    await expect(page.getByTestId('connect-restore')).toHaveCount(1);
    await expect(page.getByTestId('connect-options')).toHaveCount(0);
    expect(await events(page)).not.toContain('purchase');
    expect(await events(page)).not.toContain('restore');
    const managed = page.getByTestId('subscription-manage');
    await managed.click();
    await expect.poll(() => events(page)).toContain('manage-subscription');
    await expect(managed).toBeEnabled();
    await page.screenshot({ path: `/tmp/opencode-subscription-${theme}.png` });
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(managed).toBeInViewport();
      expect(await page.getByTestId('subscription-section').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/opencode-subscription-${theme}-${width}.png` });
    }
    expect(runtimeErrors).toEqual([]);
    await page.getByTestId('settings-section-overlay').getByText('Close', { exact: true }).click();
    await expect(page.getByTestId('subscription-section')).toHaveCount(0);
    await page.getByRole('button', { name: /^Cloud Link/ }).click();
    await page.getByTestId('subscription-machines').click();
    await expect(page).toHaveURL(/\/pair\?mode=manage$/);
    await expect(page.getByTestId('connect-access-machine-1')).toBeVisible();
    await expect(page.getByTestId('subscription-section')).toHaveCount(0);
    expect(state.pairClaims).toBe(0);
    await assertNoStoredSecrets(page);
  });
}

for (const outcome of [undefined, 'pending']) {
  test(`Subscription Settings purchases without a QR and guards pending actions (${outcome ?? 'completed'})`, async ({ page }) => {
    await storeFixture(page, { outcome });
    const state = await mockControlPlane(page);
    await openSubscriptionSettings(page);
    await expect(page.getByTestId('subscription-status')).toHaveText('No active subscription');
    await expect(page.getByTestId('subscription-expiry')).toHaveCount(0);
    await expect(page.getByTestId('connect-restore')).toHaveCount(1);
    await expect(page.getByTestId('connect-purchase')).toBeEnabled();
    expect(await events(page)).not.toContain('purchase');
    await page.getByTestId('connect-purchase').click();
    if (outcome === 'pending') {
      await expect(page.getByTestId('connect-progress')).toHaveText('Waiting for purchase approval…');
      await expect(page.getByTestId('connect-purchase')).toBeDisabled();
      await expect(page.getByTestId('connect-restore')).toBeDisabled();
      await expect(page.getByTestId('subscription-manage')).toBeDisabled();
      expect(state.subscriptionClaims).toBe(0);
    } else {
      await expect(page.getByTestId('subscription-status')).toHaveText('Active');
      await expect(page.getByTestId('subscription-expiry')).toBeVisible();
      await expect(page.getByTestId('connect-purchase')).toHaveCount(0);
      expect(state.subscriptionClaims).toBe(1);
    }
    expect((await events(page)).filter((event) => event === 'purchase')).toHaveLength(1);
    expect(state.pairClaims).toBe(0);
    await expect(page).toHaveURL(/\/settings$/);
    await assertNoStoredSecrets(page);
  });
}

test('Subscription Settings retries catalog failures and restores access without purchasing', async ({ page }) => {
  await storeFixture(page);
  const options = { catalogStatus: 503, owned: true };
  const state = await mockControlPlane(page, options);
  await openSubscriptionSettings(page);
  await expect(page.getByTestId('connect-error')).toBeVisible();
  await expect(page.getByTestId('connect-restore')).toBeDisabled();
  options.catalogStatus = 200;
  await page.getByTestId('connect-retry').click();
  await expect(page.getByTestId('connect-error')).toHaveCount(0);
  await expect(page.getByTestId('connect-restore')).toBeEnabled();
  await page.getByTestId('connect-restore').click();
  await expect(page.getByTestId('subscription-status')).toHaveText('Active');
  await expect(page.getByTestId('connect-restore')).toHaveCount(1);
  expect(await events(page)).toContain('restore');
  expect(await events(page)).not.toContain('purchase');
  expect(state.pairClaims).toBe(0);
  await expect(page).toHaveURL(/\/settings$/);
});

test('Cloud Link trusts only fixed environments and has no manual control-plane configuration', async ({ page }) => {
  await storeFixture(page);
  const production = await mockControlPlane(page);
  await openPair(page);
  await expect(page.getByTestId('connect-settings')).toHaveCount(0);
  await expect(page.getByTestId('connect-control-plane')).toHaveCount(0);
  const legacyRequests = [];
  await page.route(/https:\/\/(api|apistaging)\.getopencode\.app\//, async (route) => {
    legacyRequests.push(route.request().url());
    await route.abort();
  });
  for (const controlPlane of ['https://attacker.test', 'https://api.getopencode.app', 'https://apistaging.getopencode.app']) {
    const untrusted = pairingLink('untrusted');
    untrusted.searchParams.set('cp', controlPlane);
    await page.goto(`/pair?${untrusted.searchParams}`);
    await expect(page.getByTestId('connect-error')).toContainText('trusted control plane');
  }
  expect(legacyRequests).toEqual([]);
  expect(production.subscriptionClaims).toBe(0);
  expect(production.pairClaims).toBe(0);
  expect(await events(page)).not.toContain('purchase');
  await assertNoStoredSecrets(page);
});

for (const legacyControlPlane of ['https://api.getopencode.app', 'https://apistaging.getopencode.app']) {
  test(`a remembered legacy preference ${legacyControlPlane} resets to the new production endpoint`, async ({ page }) => {
    await storeFixture(page);
    const production = await mockControlPlane(page);
    await page.addInitScript((url) => localStorage.setItem('opencode-mobile.connect-control-plane', url), legacyControlPlane);
    const legacyRequests = [];
    await page.route(/https:\/\/(api|apistaging)\.getopencode\.app\//, async (route) => {
      legacyRequests.push(route.request().url());
      await route.abort();
    });
    await openPair(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('opencode-mobile.connect-control-plane'))).toBe(CONTROL_PLANE);
    await page.getByTestId('connect-purchase').click();
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
    expect(production.subscriptionClaims).toBe(1);
    expect(production.pairClaims).toBe(1);
    expect(legacyRequests).toEqual([]);
    await assertNoStoredSecrets(page);
  });
}

test('a real buyer with a remembered staging preference automatically uses production', async ({ page }) => {
  await storeFixture(page);
  const production = await mockControlPlane(page);
  const staging = await mockControlPlane(page, { controlPlane: STAGING });
  await page.addInitScript((url) => localStorage.setItem('opencode-mobile.connect-control-plane', url), STAGING);
  await openPair(page);
  await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(production.subscriptionClaims).toBe(1);
  expect(production.pairClaims).toBe(1);
  expect(staging.subscriptionClaims).toBe(0);
  expect(staging.pairClaims).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('opencode-mobile.connect-control-plane'))).toBe(CONTROL_PLANE);
  await assertNoStoredSecrets(page);
});

test('purchase completes then automatically pairs, saves securely, and connects with Basic auth @smoke', async ({ page }) => {
  await storeFixture(page);
  const state = await mockControlPlane(page);
  const dataAuth = [];
  page.on('request', (request) => { if (request.url().startsWith(CONNECT_SERVER) && request.headers().authorization) dataAuth.push(request.headers().authorization); });
  await page.setViewportSize({ width: 390, height: 844 });
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await openPair(page);
  await expect(page.getByText('Cloud Link', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: '/tmp/opencode-subscriptions-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '/tmp/opencode-subscriptions-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await events(page)).not.toContain('purchase');
  expect(await events(page)).not.toContain('restore');
  expect(state.pairClaims).toBe(0);
  await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(state.subscriptionClaims).toBe(1); expect(state.pairClaims).toBe(1);
  expect((await events(page)).filter((event) => ['purchase', 'claim'].includes(event))).toEqual(['purchase', 'claim']);
  expect(dataAuth.length).toBeGreaterThan(0);
  expect(dataAuth.every((value) => value === `Basic ${Buffer.from('device-1:device-test-secret').toString('base64')}`)).toBeTruthy();
  await assertNoStoredSecrets(page);
  expect(runtimeErrors).toEqual([]);
});

test('Restore continues the exact pending QR without purchasing', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page);
  await openPair(page);
  await page.getByTestId('connect-restore').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect((await events(page)).filter((event) => ['purchase', 'restore', 'claim'].includes(event))).toEqual(['restore', 'claim']);
  expect(state.pairClaims).toBe(1); await assertNoStoredSecrets(page);
});

for (const [name, options, message] of [
  ['failed verification', { subscriptionStatus: 502 }, 'temporarily unavailable'],
  ['secure session failure', { secureFailure: true }, 'secure session saving failed'],
]) {
  test(`${name} retries without another purchase`, async ({ page }) => {
    await storeFixture(page, options); const state = await mockControlPlane(page, options);
    await openPair(page); await page.getByTestId('connect-purchase').click();
    await expect(page.getByTestId('connect-error')).toContainText(message);
    await expect(page.getByTestId('connect-control-plane')).toHaveCount(0);
    await expect(page.getByTestId('connect-purchase')).toBeDisabled();
    expect(state.pairClaims).toBe(0);
    expect(await events(page)).not.toContain('finish');
    await page.getByTestId('connect-retry').click();
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
    expect((await events(page)).filter((event) => event === 'purchase')).toHaveLength(1);
    expect(state.subscriptionClaims).toBe(options.subscriptionStatus ? 2 : 1);
  });
}

for (const recovery of ['purchase', 'restore', 'restart']) {
  test(`a Google test buyer automatically uses staging through ${recovery}`, async ({ page }) => {
    await storeFixture(page, { recovered: recovery === 'restart' });
    const production = await mockControlPlane(page, { testPurchase: true });
    const staging = await mockControlPlane(page, { controlPlane: STAGING });
    await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
    const link = pairingLink('staging-pair');
    link.searchParams.set('cp', STAGING);
    await page.goto(`/pair?${link.searchParams}`);
    if (recovery !== 'restart') {
      await expect(page.getByTestId('connect-purchase')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId(recovery === 'purchase' ? 'connect-purchase' : 'connect-restore').click();
    }
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
    expect(production.subscriptionClaims).toBe(1);
    expect(production.pairClaims).toBe(0);
    expect(staging.subscriptionClaims).toBe(1);
    expect(staging.pairClaims).toBe(1);
    expect((await events(page)).filter((event) => event === 'purchase')).toHaveLength(recovery === 'purchase' ? 1 : 0);
    expect((await events(page)).filter((event) => event === 'restore')).toHaveLength(recovery === 'restore' ? 1 : 0);
    expect((await events(page)).filter((event) => event === 'finish')).toHaveLength(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('opencode-mobile.connect-control-plane'))).toBe(STAGING);
    await assertNoStoredSecrets(page);
  });
}

for (const outcome of ['pending', 'canceled']) {
  test(`${outcome} purchases grant and finalize nothing`, async ({ page }) => {
    await storeFixture(page, { outcome }); const state = await mockControlPlane(page);
    await openPair(page); await page.getByTestId('connect-purchase').click();
    await expect(page.getByTestId('connect-notice')).toContainText(outcome === 'pending' ? 'pending store approval' : 'Purchase canceled');
    await expect(page.getByTestId('connect-settings')).toHaveCount(0);
    expect(state.subscriptionClaims).toBe(0); expect(state.pairClaims).toBe(0);
    expect(await events(page)).not.toContain('finish'); expect(await events(page)).not.toContain('restore');
    await assertNoStoredSecrets(page);
  });
}

test('unfinished native purchase recovery after restart never synchronizes or purchases', async ({ page }) => {
  await storeFixture(page, { recovered: true }); const state = await mockControlPlane(page, { owned: true });
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair');
  await expect(page.getByTestId('connect-subscription-sheet')).toHaveCount(0);
  await expect.poll(async () => (await events(page)).includes('claim')).toBeTruthy();
  expect(state.subscriptionClaims).toBe(1); expect(await events(page)).not.toContain('restore'); expect(await events(page)).not.toContain('purchase');
  await page.reload();
  await expect.poll(() => state.subscriptionClaims).toBe(2);
  expect(await events(page)).not.toContain('restore'); expect(await events(page)).not.toContain('purchase');
});

test('an expired QR preserves the subscription and accepts a fresh QR without repurchase', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page, { pairStatus: 409 });
  await openPair(page); await page.getByTestId('connect-purchase').click();
  await expect(page.getByTestId('connect-error')).toContainText('pairing expired');
  await expect(page.getByTestId('connect-subscription-sheet')).toHaveCount(0);
  await expect(page.getByTestId('connect-machine-name')).toHaveCount(0);
  await submitLink(page, pairingLink('fresh-pair').toString());
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(state.subscriptionClaims).toBe(1); expect((await events(page)).filter((event) => event === 'purchase')).toHaveLength(1);
});

for (const options of [{ lostResponse: true }, { reconciliation: true }]) {
  test(`ambiguous pairing recovers the same owned machine (${Object.keys(options)[0]})`, async ({ page }) => {
    await storeFixture(page); const state = await mockControlPlane(page, options);
    await openPair(page); await page.getByTestId('connect-purchase').click();
    if (options.lostResponse) { await expect(page.getByTestId('connect-error')).toContainText('Retry the same request'); await page.getByTestId('connect-retry').click(); }
    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
    expect(state.accesses).toBe(1); expect(state.subscriptionClaims).toBe(1);
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')));
    const connected = profiles.find((profile) => profile.connect);
    expect(connected.connect.machineId).toBe('machine-1'); expect(connected.serverUrl).toBe(CONNECT_SERVER);
  });
}

test('second-device Restore lists durable machines; access mismatch saves nothing', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page, { owned: true, mismatch: true });
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair'); await showGuidedSubscription(page); await expect(page.getByTestId('connect-restore')).toBeEnabled();
  await page.getByTestId('connect-restore').click();
  await expect(page.getByTestId('connect-subscription-sheet')).toHaveCount(0);
  await manage(page);
  await expect(page.getByTestId('connect-access-machine-1')).toBeVisible();
  await page.getByTestId('connect-access-machine-1').click();
  await expect(page.getByTestId('connect-error')).toContainText('machine_identity_mismatch');
  expect(state.pairClaims).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')).filter((profile) => profile.connect))).toEqual([]);
});

test('second-device Restore reconnects the same owned machine without a QR', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page, { owned: true });
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair'); await showGuidedSubscription(page); await expect(page.getByTestId('connect-restore')).toBeEnabled();
  await page.getByTestId('connect-restore').click();
  await expect(page.getByTestId('connect-subscription-sheet')).toHaveCount(0);
  await manage(page);
  await page.getByTestId('connect-access-machine-1').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(state.pairClaims).toBe(0); expect(state.accesses).toBe(1);
  expect(await events(page)).not.toContain('purchase'); await assertNoStoredSecrets(page);
});

test('secure profile-save recovery does not replay pairing or purchase', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page);
  await openPair(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem; let fail = true;
    Storage.prototype.setItem = function (key, value) { if (key === 'opencode-mobile.connection-profiles' && fail) { fail = false; throw new Error('storage unavailable'); } return original.call(this, key, value); };
  });
  await page.getByTestId('connect-purchase').click();
  await expect(page.getByTestId('connect-error')).toContainText('secure saving failed');
  await page.getByTestId('connect-retry').click(); await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(state.pairClaims).toBe(1); expect(state.subscriptionClaims).toBe(1);
});

test('expiry stops data-plane traffic while preserving owned machine and profile', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page, { ttl: 8000 });
  await openPair(page); await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  await page.waitForTimeout(8500);
  const requests = [];
  page.on('request', (request) => { if (request.url().startsWith(CONNECT_SERVER)) requests.push(request.url()); });
  await page.waitForTimeout(2000);
  expect(requests).toEqual([]); expect(state.machines).toHaveLength(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')).filter((profile) => profile.connect).length)).toBe(1);
});

test('fresh-install subscription pairing continues onboarding', async ({ page }) => {
  await storeFixture(page); await mockControlPlane(page); await openPair(page, false);
  await page.getByTestId('connect-purchase').click(); await expect(page.getByTestId('onboarding-ai')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('onboarding-ai-continue').click();
  await expect(page.getByTestId('onboarding-project')).toBeVisible();
});


test('renewal rotates credentials while preserving profile, machine, hostname and scoped favorites', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page);
  await openPair(page); await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  const previous = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')).find((profile) => profile.connect));
  const previousScope = Buffer.from(`${previous.serverUrl}\n${previous.username}`).toString('base64url');
  // Let the first connection finish its bootstrap write before seeding the
  // next-launch fixture, or that write can overwrite the remembered session.
  await expect.poll(() => page.evaluate((scope) => Object.keys(JSON.parse(localStorage.getItem('opencode-mobile.last-session-by-project') || '{}')[scope] || {}).length, previousScope)).toBeGreaterThan(0);
  await page.evaluate(({ previousScope }) => {
    localStorage.setItem('opencode-mobile.favorite-sessions', JSON.stringify([{ sessionId: 'remembered', projectPath: '/fixture', connectionScope: previousScope, favoritedAt: Date.now() }]));
    localStorage.setItem('opencode-mobile.last-session-by-project', JSON.stringify({ [previousScope]: { '/fixture': 'remembered' } }));
    localStorage.setItem(`opencode-mobile.sessions.${previousScope}./fixture`, JSON.stringify({ cachedAt: Date.now(), sessions: [{ id: 'remembered', title: 'Remembered', createdAt: 1, updatedAt: 1 }] }));
  }, { previousScope });
  // A second launch has only durable profile metadata; Restore reacquires its
  // store session, then refreshes access on the original machine.
  state.paidThrough += 3600000;
  await page.goto('/pair'); await showGuidedSubscription(page); await expect(page.getByTestId('connect-restore')).toBeEnabled();
  await page.evaluate((previousUsername) => {
    const original = Storage.prototype.setItem; let fail = true;
    Storage.prototype.setItem = function (key, value) { if (key === 'opencode-mobile.connection-profiles' && fail && JSON.parse(value).find((profile) => profile.connect)?.username !== previousUsername) { fail = false; throw new Error('storage unavailable'); } return original.call(this, key, value); };
  }, previous.username);
  const scopeBeforeRestore = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.favorite-sessions'))[0].connectionScope);
  await page.getByTestId('connect-restore').click();
  await expect(page.getByTestId('connect-error')).toContainText('secure saving failed');
  // A background renewal can rotate the scope before this explicit restore.
  // Compare against the immediate pre-restore scope so the rollback contract is
  // still asserted without depending on an earlier connection's timing.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.favorite-sessions'))[0].connectionScope)).toBe(scopeBeforeRestore);
  await page.getByTestId('connect-retry').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')).find((profile) => profile.connect);
    const scope = btoa(`${profile.serverUrl}\n${profile.username}`).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    return JSON.parse(localStorage.getItem('opencode-mobile.last-session-by-project') || '{}')[scope]?.['/fixture'];
  })).toBe('remembered');
  const updated = await page.evaluate(() => ({ profile: JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')).find((profile) => profile.connect), favorites: JSON.parse(localStorage.getItem('opencode-mobile.favorite-sessions')), last: JSON.parse(localStorage.getItem('opencode-mobile.last-session-by-project')) }));
  expect(updated.profile.id).toBe(previous.id); expect(updated.profile.name).toBe(previous.name);
  expect(updated.profile.connect.machineId).toBe(previous.connect.machineId); expect(updated.profile.serverUrl).toBe(previous.serverUrl);
  expect(updated.profile.username).not.toBe(previous.username);
  const refreshedScope = Buffer.from(`${updated.profile.serverUrl}\n${updated.profile.username}`).toString('base64url');
  expect(updated.favorites[0].connectionScope).toBe(refreshedScope); expect(updated.last[refreshedScope]['/fixture']).toBe('remembered');
  expect(state.pairClaims).toBe(1); expect(state.accesses).toBe(1); expect(await events(page)).not.toContain('purchase'); await assertNoStoredSecrets(page);
});

test('live renewal preserves the machine connection and selected session across panel reopening', async ({ page }) => {
  const runtimeErrors = [], dataAuth = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('request', (request) => { if (request.url().startsWith(CONNECT_SERVER) && request.method() !== 'OPTIONS') dataAuth.push(request.headers().authorization); });
  await page.setViewportSize({ width: 390, height: 844 });
  await storeFixture(page); const state = await mockControlPlane(page);
  await openPair(page); await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  const previous = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')).find((profile) => profile.connect));
  const oldScope = Buffer.from(`${previous.serverUrl}\n${previous.username}`).toString('base64url');
  await expect.poll(() => page.evaluate((scope) => Object.keys(JSON.parse(localStorage.getItem('opencode-mobile.last-session-by-project') || '{}')[scope] || {}).length, oldScope)).toBeGreaterThan(0);
  const selected = await page.evaluate((scope) => JSON.parse(localStorage.getItem('opencode-mobile.last-session-by-project'))[scope], oldScope);
  await page.getByRole('tab', { name: 'Chat' }).click();
  const chat = page.getByRole('button', { name: /^Open chats/ });
  await expect(chat).toBeVisible();
  const sessionLabel = await chat.getAttribute('aria-label');
  await page.getByRole('tab', { name: 'Settings' }).click();
  const overlay = page.getByTestId('settings-section-overlay');
  await page.getByRole('button', { name: /^Connection/ }).click();
  const row = page.getByTestId(`connection-row-${previous.id}`);
  await expect(row).toContainText('Connected');
  await expect(page.getByTestId('connection-row-current')).toHaveCount(0);
  await overlay.getByText('Close', { exact: true }).click();
  await page.getByRole('button', { name: /^Cloud Link/ }).click();
  state.paidThrough += 3600000;
  await page.getByTestId('connect-restore').click();
  await expect(page.getByTestId('connect-restore')).toBeEnabled();
  await expect(page.getByTestId('connect-error')).toHaveCount(0);
  await overlay.getByText('Close', { exact: true }).click();
  await page.getByRole('button', { name: /^Connection/ }).click();
  await expect(row).toContainText('Connected');
  await expect(page.getByTestId('connection-row-current')).toHaveCount(0);
  await row.click();
  await expect(overlay).toContainText('Username: device-2');
  await overlay.getByText('Close', { exact: true }).click();
  await page.getByRole('button', { name: /^Connection/ }).click();
  await expect(row).toContainText('Connected');
  await expect(page.getByTestId('connection-row-current')).toHaveCount(0);
  const newScope = Buffer.from(`${previous.serverUrl}\ndevice-2`).toString('base64url');
  await expect.poll(() => page.evaluate((scope) => JSON.parse(localStorage.getItem('opencode-mobile.last-session-by-project') || '{}')[scope], newScope)).toEqual(selected);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')).filter((profile) => profile.connect).length)).toBe(1);
  expect(state.accesses).toBe(1); expect(state.pairClaims).toBe(1);
  expect(dataAuth).toContain(`Basic ${Buffer.from('device-2:device-test-secret').toString('base64')}`);
  await page.screenshot({ path: '/tmp/opencode-cloud-link-renewal.png' });
  await overlay.getByText('Close', { exact: true }).click();
  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByRole('button', { name: sessionLabel, exact: true })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
  await assertNoStoredSecrets(page);
});

test('a subscriber opening a QR link pairs automatically without a purchase overlay', async ({ page }) => {
  await storeFixture(page, { recovered: true });
  const state = await mockControlPlane(page);
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  let purchaseOverlays = 0;
  await page.addInitScript(() => {
    globalThis.__subscriptionOverlaySeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="connect-subscription-sheet"]')) globalThis.__subscriptionOverlaySeen = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`/pair?${pairingLink().searchParams}`);
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  purchaseOverlays = await page.evaluate(() => Number(globalThis.__subscriptionOverlaySeen));
  expect(purchaseOverlays).toBe(0);
  expect(state.pairClaims).toBe(1);
  expect(await events(page)).not.toContain('purchase');
  expect(await events(page)).not.toContain('restore');
  await assertNoStoredSecrets(page);
});

test('guided setup can close or go back without purchasing and Manual stays available', async ({ page }) => {
  await storeFixture(page); await mockControlPlane(page);
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair');
  await showGuidedSubscription(page);
  await expect(page.getByTestId('connect-purchase')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('connect-step-2')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('connect-step-1')).toBeVisible();
  for (const dismiss of ['close', 'escape']) {
    if (dismiss === 'close') await page.getByTestId('connect-close').click();
    else await page.keyboard.press('Escape');
    await expect(page.getByTestId('connection-method-chooser')).toBeVisible();
    await expect(page.getByTestId('connect-panel')).toHaveCount(0);
    await expect(page.getByTestId('connect-subscription-sheet')).toHaveCount(0);
    await page.getByTestId('connection-method-connect').click();
    await expect(page.getByTestId('connect-step-1')).toBeVisible();
  }
  await page.getByTestId('connect-close').click();
  await page.getByTestId('connection-method-manual').click();
  await expect(page.getByTestId('connection-profile-url-input')).toBeVisible();
  expect(await events(page)).not.toContain('purchase');
});

test('closing an incoming pairing link clears its QR and starts guided setup when reopened from the chooser', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page);
  await openPair(page);
  await page.getByTestId('connect-subscription-sheet').getByText('Close', { exact: true }).click();
  await page.getByTestId('connection-method-connect').click();
  await expect(page.getByTestId('connect-step-1')).toBeVisible();
  await showGuidedSubscription(page);
  await page.getByTestId('connect-purchase').click();
  await expect(page.getByTestId('connect-step-4')).toBeVisible();
  expect(state.pairClaims).toBe(0);
});

test('an existing subscriber selecting Cloud Link opens the pairing screen without a purchase overlay', async ({ page }) => {
  await storeFixture(page, { recovered: true }); const state = await mockControlPlane(page);
  await page.addInitScript(() => {
    localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    globalThis.__subscriptionOverlaySeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="connect-subscription-sheet"]')) globalThis.__subscriptionOverlaySeen = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: /^Connection/ }).click();
  await page.getByTestId('connection-add-button').click();
  await page.getByTestId('connection-method-connect').click();
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await expect(page.getByTestId('connect-progress')).toHaveCount(0);
  await expect(page.getByTestId('connect-subscription-sheet')).toHaveCount(0);
  await expect(page).toHaveURL(/\/pair$/);
  expect(await page.evaluate(() => globalThis.__subscriptionOverlaySeen)).toBe(false);
  expect(await events(page)).not.toContain('purchase');
  expect(await events(page)).not.toContain('restore');
  expect(state.pairClaims).toBe(0);
});

test('a subscriber can reopen pairing after connecting without a subscription overlay', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page);
  await openPair(page);
  await page.getByTestId('connect-purchase').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Connection/ }).click();
  await page.getByTestId('connection-add-button').click();
  await page.getByTestId('connection-method-connect').click();
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await expect(page.getByTestId('connect-subscription-sheet')).toHaveCount(0);
  await expect(page.getByTestId('connect-options')).toBeEnabled();
  await expect(page).toHaveURL(/\/pair$/);
  expect(state.pairClaims).toBe(1);
  expect((await events(page)).filter((event) => event === 'purchase')).toHaveLength(1);
});

test('invalid and untrusted QR links can be replaced with a valid subscriber link', async ({ page }) => {
  await storeFixture(page, { recovered: true }); const state = await mockControlPlane(page);
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair');
  await expect(page.getByTestId('connect-subscription-sheet')).toHaveCount(0);
  await submitLink(page, 'https://unrelated.test');
  await expect(page.getByTestId('connect-error')).toContainText('Invalid or unsupported');
  const untrusted = pairingLink(); untrusted.searchParams.set('cp', 'https://untrusted.test');
  await submitLink(page, untrusted.toString());
  await expect(page.getByTestId('connect-error')).toContainText('trusted control plane');
  expect(state.pairClaims).toBe(0);
  await submitLink(page, pairingLink().toString());
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(state.pairClaims).toBe(1); expect(await events(page)).not.toContain('purchase');
});

test('Settings has one creation entry with Scan QR, Manual and Cloud Link methods', async ({ page }) => {
  await storeFixture(page); await mockControlPlane(page);
  await page.addInitScript((serverUrl) => {
    localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    localStorage.setItem('opencode-mobile.settings', JSON.stringify({ serverUrl, username: '', directory: '' }));
  }, SERVER);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await page.getByRole('button', { name: /^Connection/ }).click();
  await expect(page.getByTestId('connection-pair-connect')).toHaveCount(0);
  await expect(page.locator('[data-testid^="connection-row-"]').first()).toBeVisible();
  await expect(page.getByTestId('connection-row-current')).toHaveCount(0);
  await page.getByTestId('connection-add-button').click();
  await expect(page.getByTestId('connection-method-scan')).toHaveAttribute('role', 'button');
  await expect(page.getByTestId('connection-method-connect')).toHaveAttribute('role', 'button');
  await expect(page.getByTestId('connection-method-manual')).toHaveAttribute('role', 'button');
  await expect(page.getByText('Local QR scanning is available in the iOS and Android app.')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/opencode-add-connection-chooser.png' });
  await page.getByTestId('connection-method-connect').click();
  await showGuidedSubscription(page);
  await expect(page.getByTestId('connect-purchase')).toBeEnabled();
  await expect(page.getByRole('tab', { name: 'Settings' })).not.toBeVisible();
  const subscription = page.getByTestId('connect-step-3');
  await expect(subscription.getByRole('button', { name: 'Trusted control plane', exact: true })).toHaveCount(0);
  await expect(subscription.getByRole('button', { name: 'Open pairing link', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/opencode-add-connection-subscription.png' });
  await page.getByTestId('connect-close').click();
  await page.getByTestId('connection-method-manual').click();
  await page.getByTestId('connection-profile-url-input').fill(SERVER);
  await page.getByTestId('connection-profile-continue').click();
  await page.getByTestId('connection-profile-name-input').fill('Manual server');
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.connection-profiles')));
  expect(profiles).toHaveLength(2); // The original connection is migrated to a saved profile too.
  expect(profiles.find((profile) => profile.name === 'Manual server')?.connect).toBeUndefined();
  expect(await events(page)).not.toContain('purchase');
});


test('store setup errors keep subscription recovery separate from pairing settings', async ({ page }) => {
  await storeFixture(page);
  await mockControlPlane(page, { productId: 'unavailable.product' });
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.goto('/pair');
  await showGuidedSubscription(page);
  const sheet = page.getByTestId('connect-step-3');
  await expect(sheet.getByTestId('connect-error')).toContainText('No matching Cloud Link products');
  await expect(sheet.getByTestId('connect-retry')).toBeVisible();
  await expect(sheet.getByTestId('connect-purchase')).toBeDisabled();
  await expect(sheet.getByTestId('connect-restore')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Trusted control plane', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Open pairing link', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('connect-control-plane')).toHaveCount(0);
  await expect(page.getByTestId('connect-settings')).toHaveCount(0);
});

test('guided Cloud Link uses consistent illustrated steps, store pricing and explicit checkout', async ({ page }) => {
  await storeFixture(page); const state = await mockControlPlane(page);
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/pair');
  const positions = [];
  async function capture(step) {
    await expect(page.getByTestId(`connect-step-${step}`)).toBeVisible();
    const artwork = page.getByTestId('connect-illustration').locator('img').first();
    await expect(artwork).toHaveAttribute('src', new RegExp(step === 2 || step === 4 ? 'cloud-link-desktop' : 'cloud-link-devices'));
    await artwork.evaluate((image) => image.decode());
    if (step === 4) await page.getByTestId('connect-illustration').locator('img').last().evaluate((image) => image.decode());
    const image = await page.getByTestId('connect-illustration').boundingBox();
    const title = await page.getByTestId('connect-step-heading').boundingBox();
    const subtitle = await page.getByTestId('connect-step-subheading').boundingBox();
    const primary = await page.getByTestId(step === 3 ? 'connect-purchase' : step === 4 ? 'connect-start-scan' : 'connect-next').boundingBox();
    positions.push({ image: image.y, title: title.y, subtitle: subtitle.y, primary: primary.y });
    await page.screenshot({ path: `output/cloud-link-step-${step}.png` });
  }
  await capture(1);
  expect(await events(page)).not.toContain('purchase');
  await page.getByTestId('connect-next').click();
  await capture(2);
  await expect(page.getByRole('button', { name: 'Share setup link' })).toHaveCount(0);
  await page.getByTestId('connect-copy-setup-url').click();
  await expect(page.getByTestId('connect-copy-setup-url')).toHaveAccessibleName('Setup URL copied');
  await page.getByTestId('connect-next').click();
  await expect(page.getByTestId('connect-purchase')).toBeEnabled();
  await expect(page.getByTestId(`connect-offer-${PRODUCT}:monthly:monthly`)).toContainText('$4.99');
  const restore = await page.getByTestId('connect-restore').boundingBox();
  const purchase = await page.getByTestId('connect-purchase').boundingBox();
  expect(restore.height).toBeGreaterThanOrEqual(44);
  expect(restore.y + restore.height).toBeLessThanOrEqual(purchase.y);
  await capture(3);
  expect(state.subscriptionClaims).toBe(0);
  expect(state.pairClaims).toBe(0);
  await page.getByTestId('connect-purchase').click();
  await capture(4);
  expect(await events(page)).toContain('purchase');
  expect(state.subscriptionClaims).toBe(1);
  expect(state.pairClaims).toBe(0);
  for (const surface of ['image', 'title', 'subtitle', 'primary']) {
    expect(Math.max(...positions.map((position) => position[surface])) - Math.min(...positions.map((position) => position[surface]))).toBeLessThan(2);
  }
  await submitLink(page, pairingLink().toString());
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  expect(state.pairClaims).toBe(1);
  await assertNoStoredSecrets(page);
});

for (const outcome of ['pending', 'canceled']) {
  test(`guided ${outcome} checkout stays on subscription and never pairs`, async ({ page }) => {
    await storeFixture(page, { outcome }); const state = await mockControlPlane(page);
    await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
    await page.goto('/pair');
    await showGuidedSubscription(page);
    await page.getByTestId('connect-purchase').click();
    await expect(page.getByTestId('connect-notice')).toContainText(outcome === 'pending' ? 'pending store approval' : 'Purchase canceled');
    await expect(page.getByTestId('connect-step-3')).toBeVisible();
    await expect(page.getByTestId('connect-step-4')).toHaveCount(0);
    expect(state.subscriptionClaims).toBe(0); expect(state.pairClaims).toBe(0);
  });
}

test('guided subscription keeps actions accessible on a narrow light screen', async ({ page }) => {
  await storeFixture(page); await mockControlPlane(page);
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/pair');
  await showGuidedSubscription(page);
  await expect(page.getByTestId('connect-purchase')).toBeEnabled();
  const purchase = await page.getByTestId('connect-purchase').boundingBox();
  const restore = await page.getByTestId('connect-restore').boundingBox();
  const price = await page.getByTestId(`connect-offer-${PRODUCT}:monthly:monthly`).boundingBox();
  expect(purchase.height).toBeGreaterThanOrEqual(44);
  expect(purchase.y + purchase.height).toBeLessThanOrEqual(700);
  expect(restore.height).toBeGreaterThanOrEqual(44);
  expect(restore.y + restore.height).toBeLessThanOrEqual(purchase.y);
  expect(price.y + price.height).toBeLessThanOrEqual(restore.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: 'output/cloud-link-subscription-light-narrow.png' });
  await page.getByTestId('connect-restore').click();
  await expect(page.getByTestId('connect-step-4')).toBeVisible();
});

test('a paired device adds, edits and removes an exposed service', async ({ page, request }) => {
  await storeFixture(page, { recovered: true });
  await mockControlPlane(page);
  // The fake connector only trusts provisioned device credentials; the control
  // plane hands the app `device-<n>` with a fixed secret.
  for (const id of ['device-1', 'device-2', 'device-3']) {
    await request.post(`${SERVER}/__control/device`, { data: { device_id: id, device_secret: 'device-test-secret' } });
  }
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(`/pair?${pairingLink().searchParams}`);
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Cloud Link/ }).click();
  await expect(page.getByTestId('services-section')).toBeVisible();
  await expect(page.getByTestId('service-api')).toHaveCount(0);

  // Add opens the full-screen editor rather than an inline overlay form.
  await page.getByTestId('service-add').click();
  await expect(page).toHaveURL(/\/service$/, { timeout: 15_000 });
  await page.getByTestId('service-id-input').fill('api');
  await page.getByTestId('service-path-input').fill('/test/api');
  await page.getByTestId('service-target-input').fill('127.0.0.1:3000');
  await page.getByTestId('service-save').click();
  // Saving returns to Settings with the Cloud Link section reopened.
  await expect(page.getByTestId('services-section')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('service-api')).toContainText('/test/api');
  await expect(page.getByTestId('service-api')).toContainText(':8443/test/api/');

  // Edit reuses the same editor with the connector's stored values.
  await page.getByTestId('service-api').getByRole('button', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/service\?id=api$/, { timeout: 15_000 });
  await page.getByTestId('service-target-input').fill('127.0.0.1:3001');
  await page.getByTestId('service-save').click();
  await expect(page.getByTestId('service-api')).toContainText('127.0.0.1:3001', { timeout: 15_000 });

  // A root service owns its port: the empty path serves the whole origin and
  // the picker offers a free port.
  await page.getByTestId('service-add').click();
  await page.getByTestId('service-id-input').fill('site');
  await page.getByTestId('service-target-input').fill('127.0.0.1:4000');
  await page.getByTestId('service-port-select').click();
  await page.getByRole('button', { name: '2053', exact: true }).click();
  await page.getByTestId('service-save').click();
  await expect(page.getByTestId('service-site')).toContainText(':2053/', { timeout: 15_000 });
  await expect(page.getByTestId('service-site')).toContainText(':2053 → 127.0.0.1:4000');

  // A second root service picks another free port; the occupied one is marked.
  await page.getByTestId('service-add').click();
  await page.getByTestId('service-id-input').fill('site2');
  await page.getByTestId('service-target-input').fill('127.0.0.1:4001');
  await page.getByTestId('service-port-select').click();
  await expect(page.getByRole('button', { name: '2053 (in use)' })).toBeVisible();
  await page.getByRole('button', { name: '2083', exact: true }).click();
  await page.getByTestId('service-save').click();
  await expect(page.getByTestId('service-site2')).toContainText(':2083/', { timeout: 15_000 });

  await page.getByTestId('service-site2').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('service-site2')).toHaveCount(0);
  await page.getByTestId('service-site').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('service-site')).toHaveCount(0);

  await page.getByTestId('service-api').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('service-api')).toHaveCount(0);
  await expect(page.getByTestId('services-feedback')).toContainText('Removed');
});

test('exposed services stay available while a different connection is active', async ({ page, request }) => {
  await storeFixture(page, { recovered: true });
  await mockControlPlane(page);
  for (const id of ['device-1', 'device-2', 'device-3']) {
    await request.post(`${SERVER}/__control/device`, { data: { device_id: id, device_secret: 'device-test-secret' } });
  }
  await page.addInitScript(() => localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 })));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(`/pair?${pairingLink().searchParams}`);
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });

  // Expose one service while Cloud Link is the active connection.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Cloud Link/ }).click();
  await page.getByTestId('service-add').click();
  await page.getByTestId('service-id-input').fill('api');
  await page.getByTestId('service-path-input').fill('/test/api');
  await page.getByTestId('service-target-input').fill('127.0.0.1:3000');
  await page.getByTestId('service-save').click();
  await expect(page.getByTestId('service-api')).toHaveCount(1, { timeout: 15_000 });
  await page.getByTestId('settings-section-overlay').getByText('Close', { exact: true }).click();

  // Add and switch to a manual connection.
  await page.getByRole('button', { name: /^Connection/ }).click();
  await page.getByTestId('connection-add-button').click();
  await page.getByTestId('connection-method-manual').click();
  await page.getByTestId('connection-profile-url-input').fill(SERVER);
  await page.getByTestId('connection-profile-continue').click();
  await page.getByTestId('connection-profile-save-confirm').click();
  await expect(page.getByTestId('connection-profile-save-confirm')).toHaveCount(0, { timeout: 30_000 });
  await page.getByTestId('settings-section-overlay').getByText('Close', { exact: true }).click();

  // The saved Cloud Link machine's services remain manageable and explain that
  // they do not belong to the active connection.
  await page.getByRole('button', { name: /^Cloud Link/ }).click();
  await expect(page.getByTestId('services-section')).toBeVisible();
  await expect(page.getByTestId('service-api')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId('service-use-machine')).toBeVisible();
});

