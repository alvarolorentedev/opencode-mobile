import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

// Existing flows assume the app boots straight into chat. Seed a completed
// onboarding marker so first-run setup is skipped; the dedicated onboarding
// spec intentionally omits this so the assistant is exercised.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
  });
});

// Fixed ports collide with anything else bound on the CI runner. Ask the OS for
// an ephemeral port instead so self-spawned fake servers never hit EADDRINUSE.
async function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function resetScenario(request, scenario) {
  const response = await request.post('http://127.0.0.1:44096/__control/reset', {
    data: { scenario },
  });

  expect(response.ok()).toBeTruthy();
}

async function openReadyChat(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
}

async function openChatLibrary(page) {
  await page.getByRole('button', { name: /^Open chats/ }).click();
  await expect(page.getByTestId('chat-library')).toBeVisible();
}

async function closeSettingsOverlay(page) {
  const overlay = page.getByTestId('settings-section-overlay');
  if (await overlay.isVisible().catch(() => false)) await overlay.getByRole('button', { name: 'Close', exact: true }).first().click();
}

async function goToTab(page, name) {
  await closeSettingsOverlay(page);
  const changes = page.getByTestId('changes-overlay');
  if (await changes.isVisible().catch(() => false)) await changes.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name }).click();
}

async function chatAction(page, title, action) {
  const escapedTitlePrefix = title.slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('button', { name: new RegExp(`^${action} ${escapedTitlePrefix}`) }).click();
}

async function chooseDiffSource(page, source) {
  await page.getByRole('button', { name: /Change files changed source/ }).click();
  const sheet = page.getByTestId('diff-source-overlay-sheet');
  await expect(sheet).toBeVisible();
  expect((await sheet.boundingBox()).height).toBeLessThan(400);
  await page.getByTestId('diff-source-overlay').getByText(source, { exact: true }).click();
  const overlay = page.getByTestId('diff-source-overlay');
  if (await overlay.isVisible().catch(() => false)) await overlay.getByRole('button', { name: 'Close', exact: true }).first().click();
}

function spawnV2Server(port, scenario = 'happy-path') {
  return spawn(process.execPath, ['tests/fake-opencode/server-v2.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_OPENCODE_PORT: String(port),
      FAKE_OPENCODE_SCENARIO: scenario,
    },
    stdio: 'inherit',
  });
}

// A second V1 server with its own state, used by the multi-connection tests.
function spawnV1Server(port, scenario = 'happy-path') {
  return spawn(process.execPath, ['tests/fake-opencode/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_OPENCODE_PORT: String(port),
      FAKE_OPENCODE_SCENARIO: scenario,
    },
    stdio: 'inherit',
  });
}

// The settings screen re-renders its Connection subtree after a tab switch, so
// a click can fail on a moving target. Prefer Playwright's normal actionability
// checks, which wait for stability and verify the hit target (a forced click
// can land on the neighbouring accordion header instead); fall back to a forced
// click only when the target never settles. Callers always verify the effect
// of the tap rather than assuming it landed.
async function clickWithRetry(locator) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await locator.click({ timeout: 2500 }).then(() => true).catch(() => false)) {
      return true;
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await locator.click({ timeout: 2500, force: true }).then(() => true).catch(() => false)) {
      return true;
    }
  }
  return false;
}

// Settings categories open in the shared overlay. Close the previous category
// before opening a different one.
async function ensureConnectionSection(page) {
  const connectionHeader = page.getByRole('button', { name: /^Connection/ });
  const addButton = page.getByTestId('connection-add-button');
  // Wait for the screen itself; tapping a header before it mounts is what lets
  // a click land on the neighbouring accordion.
  await connectionHeader.waitFor({ state: 'visible', timeout: 15_000 });
  if (!await addButton.isVisible().catch(() => false)) await closeSettingsOverlay(page);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await addButton.isVisible().catch(() => false)) {
      return;
    }
    await clickWithRetry(connectionHeader);
    if (await addButton.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)) {
      return;
    }
  }
  await expect(addButton).toBeVisible({ timeout: 10_000 });
}

// The active connection is always a row, titled "Current connection" while it
// has not been saved as a profile. Expand it to reach Edit and Reconnect.
async function openCurrentConnectionRow(page) {
  await ensureConnectionSection(page);
  const edit = page.getByTestId('connection-edit-current');
  const row = page.getByTestId('connection-row-current');
  await row.waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
  if ((await row.count()) === 0) {
    await expect(edit).toBeVisible({ timeout: 10_000 });
    return;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await edit.isVisible().catch(() => false)) {
      return;
    }
    await clickWithRetry(row);
    if (await edit.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)) {
      return;
    }
  }
  await expect(edit).toBeVisible({ timeout: 10_000 });
}

// Opens the add/edit connection dialog and verifies it actually opened; the
// Connection subtree can still be animating when the trigger is tapped.
async function openConnectionDialog(page, trigger, openedLocator) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await clickWithRetry(trigger);
    if (await page.getByTestId('connection-method-manual').isVisible().catch(() => false)) await page.getByTestId('connection-method-manual').click();
    if (await openedLocator.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
      return;
    }
  }
  await expect(openedLocator).toBeVisible({ timeout: 10_000 });
}

// Editing the active connection applies to the live settings but deliberately
// waits for Reconnect, so these are two explicit steps.
async function setActiveServerUrl(page, url) {
  await openCurrentConnectionRow(page);
  await openConnectionDialog(page, page.getByTestId('connection-edit-current'), page.getByTestId('connection-profile-url-input'));
  await page.getByTestId('connection-profile-url-input').fill(url);
  await clickWithRetry(page.getByTestId('connection-profile-continue'));
  await clickWithRetry(page.getByTestId('connection-profile-save-confirm'));
  await expect(page.getByTestId('connection-profile-url-input')).not.toBeVisible({ timeout: 10_000 });
}

async function reconnectActiveConnection(page) {
  await openCurrentConnectionRow(page);
  await clickWithRetry(page.getByTestId('connection-reconnect'));
}

// The status card only renders inside the expanded Connection card, and the
// card can re-render while a tab becomes visible, so keep re-opening it until
// the message names the expected server.
async function expectConnectedTo(page, host) {
  const message = page.getByText(new RegExp(`Connected to http://127\\.0\\.0\\.1:${host}`));
  const deadline = Date.now() + 25_000;

  while (Date.now() < deadline) {
    await ensureConnectionSection(page);
    if ((await message.count()) > 0) {
      await expect(message.first()).toBeVisible();
      return;
    }
    await page.waitForTimeout(250);
  }

  await expect(message.first()).toBeVisible();
}

async function connectToServer(page, url) {
  await goToTab(page, 'Settings');
  await ensureConnectionSection(page);
  await setActiveServerUrl(page, url);
  await reconnectActiveConnection(page);
  // Wait for this connection, rather than the previous server's still-visible status.
  await expectConnectedTo(page, new URL(url).port);
  await closeSettingsOverlay(page);
  await goToTab(page, 'Chat');
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible({ timeout: 15_000 });
}

// "Add connection" saves and connects in one step.
async function addConnection(page, { name, url }) {
  await ensureConnectionSection(page);
  await openConnectionDialog(page, page.getByTestId('connection-add-button'), page.getByTestId('connection-profile-url-input'));
  await page.getByTestId('connection-profile-url-input').fill(url);
  await clickWithRetry(page.getByTestId('connection-profile-continue'));
  await page.getByTestId('connection-profile-name-input').fill(name);
  await clickWithRetry(page.getByTestId('connection-profile-save-confirm'));
  await expect(page.getByTestId('connection-profile-url-input')).not.toBeVisible({ timeout: 10_000 });
}

// Only one row is expanded at a time, so the visible Connect action belongs to
// the row the test just expanded.
async function connectToSavedConnection(page, name) {
  await ensureConnectionSection(page);
  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  const header = page.locator('[data-testid^="connection-row-"]').filter({ hasText: name }).first();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await connect.isVisible().catch(() => false)) {
      break;
    }
    await clickWithRetry(header);
    if (await connect.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)) {
      break;
    }
  }

  await expect(connect).toBeVisible({ timeout: 10_000 });
  await clickWithRetry(connect);
}

// The Connection card starts expanded, so reach the AI defaults card
// explicitly before configuring providers.
async function ensureAiSection(page) {
  const aiHeader = page.getByRole('button', { name: /^AI & providers/ });
  const addProvider = page.getByTestId('settings-add-provider-button');
  await aiHeader.waitFor({ state: 'visible', timeout: 15_000 });
  if (!await addProvider.isVisible().catch(() => false)) await closeSettingsOverlay(page);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await addProvider.isVisible().catch(() => false)) {
      return;
    }
    await clickWithRetry(aiHeader);
    if (await addProvider.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)) {
      return;
    }
  }
  await expect(addProvider).toBeVisible({ timeout: 10_000 });
}

async function sendPrompt(page, prompt) {
  const input = page.getByPlaceholder('Ask anything...');
  const primary = page.getByTestId('chat-primary-button');
  // The composer mounts after boot and, on small viewports, after a resize
  // settles. Its draft is local state, so a remount between typing and tapping
  // would wipe the input and leave the primary button on "Start conversation
  // mode". Re-assert the draft and wait for the send affordance each attempt so
  // the final click can never land on a stale voice button.
  await expect(async () => {
    await input.click();
    await input.fill(prompt);
    await expect(input).toHaveValue(prompt);
    await expect(primary).toHaveAccessibleName('Send task', { timeout: 2_000 });
    await primary.click();
  }).toPass({ timeout: 20_000 });
}

async function waitForServer(request, url, timeoutMs = 10_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await request.get(url);
      if (response.ok()) {
        return;
      }
    } catch {
      // Keep polling until the timeout expires.
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for fake server at ${url}`);
}

async function attachFile(page, name, mimeType, buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('chat-attach-button').click();
  await (await chooser).setFiles({ name, mimeType, buffer });
}

test('attachment tiles preview images, text and documents above the related message', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await page.setViewportSize({ width: 390, height: 844 });
  await openReadyChat(page);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await attachFile(page, 'pixel.png', 'image/png', image);
  const tile = page.getByTestId('attachment-tile');
  await expect(tile).toHaveCount(1);
  expect((await tile.boundingBox()).width).toBe(56);
  await expect(tile).toHaveText('');
  await tile.click();
  await expect(page.getByTestId('attachment-image-preview')).toBeVisible();
  await page.getByTestId('attachment-preview').getByRole('button', { name: 'Close', exact: true }).first().click();
  const wave = Buffer.alloc(44 + 16000);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(16000, 40);
  await attachFile(page, 'sound.wav', 'audio/wav', wave);
  await tile.nth(1).click();
  const play = page.getByTestId('attachment-audio-play');
  await expect(play).toBeEnabled();
  await play.click();
  await expect(play).toContainText('Pause');
  await page.getByTestId('attachment-preview').getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByTestId('attachment-remove').nth(1).click();
  await attachFile(page, 'preview.pdf', 'application/pdf', Buffer.from('%PDF-1.4\npreview'));
  await tile.nth(1).click();
  const download = page.waitForEvent('download');
  await page.getByTestId('attachment-open-external').click();
  expect((await download).suggestedFilename()).toBe('preview.pdf');
  await page.getByTestId('attachment-preview').getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByTestId('attachment-remove').nth(1).click();
  await sendPrompt(page, 'Explain the attached pixel');
  const message = page.locator('[data-testid^="transcript-message-"]').filter({ has: page.getByText('Explain the attached pixel', { exact: true }) });
  await expect(message.getByTestId('attachment-tile')).toBeVisible();
  const previewBox = await message.getByTestId('attachment-tile').boundingBox();
  const textBox = await message.getByText('Explain the attached pixel', { exact: true }).boundingBox();
  expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(textBox.y);
  await page.reload();
  await expect(message.getByTestId('attachment-tile')).toBeVisible({ timeout: 20_000 });
  await message.getByTestId('attachment-tile').click();
  await expect(page.getByTestId('attachment-image-preview')).toBeVisible();
});

test('OpenCode 2 keeps steer and append prompts pinned until delivery and recovers them after reload', async ({ page, request }) => {
  test.setTimeout(90_000);
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawnV2Server(port, 'inbox');
  try {
    await waitForServer(request, `${origin}/api/info`);
    await page.setViewportSize({ width: 390, height: 844 });
    await openReadyChat(page);
    await connectToServer(page, origin);
    const admission = page.waitForResponse((response) => response.url().endsWith('/prompt') && response.request().method() === 'POST');
    await sendPrompt(page, 'Keep working on the first task');
    const sessionID = (await (await admission).json()).data.sessionID;
    await expect(page.getByText('Working on: Keep working on the first task', { exact: true })).toBeVisible();
    await sendPrompt(page, 'Steer at the next step');
    const pending = page.getByTestId('pending-prompts');
    await expect(pending).toContainText('Waiting to be used… · Steer');
    await expect(pending.getByTestId('pending-prompt')).toHaveCount(1);
    expect((await pending.boundingBox()).y).toBeLessThan((await page.getByPlaceholder('Ask anything...').boundingBox()).y);
    await goToTab(page, 'Settings');
    await page.getByRole('button', { name: /^Advanced/ }).click();
    await page.getByRole('button', { name: /Messages sent while working/ }).click();
    await page.getByText('Append', { exact: true }).click();
    await goToTab(page, 'Chat');
    await attachFile(page, 'notes.txt', 'text/plain', Buffer.from('Preview café notes'));
    await page.getByTestId('attachment-tile').click();
    await expect(page.getByTestId('attachment-text-preview')).toHaveText('Preview café notes');
    await page.getByTestId('attachment-preview').getByRole('button', { name: 'Close', exact: true }).first().click();
    await sendPrompt(page, 'Append these notes');
    await sendPrompt(page, 'Append the final task');
    await expect(pending.getByTestId('pending-prompt')).toHaveCount(3);
    await expect(pending).not.toContainText('Sending…');
    await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('');
    await expect(pending).toContainText('Waiting to be used… · Append');
    await page.reload();
    await expect(pending.getByTestId('pending-prompt')).toHaveCount(3, { timeout: 20_000 });
    expect(sessionID).toBeTruthy();
    await request.post(`${origin}/__control/inbox`, { data: { sessionID, action: 'step' } });
    await expect(pending.getByTestId('pending-prompt')).toHaveCount(2);
    await expect(page.getByText('Steer at the next step', { exact: true })).toHaveCount(1);
    await request.post(`${origin}/__control/event-stream`, { data: { suppress: true, disconnect: true } });
    await request.post(`${origin}/__control/inbox`, { data: { sessionID, action: 'complete' } });
    await expect(pending.getByTestId('pending-prompt')).toHaveCount(1, { timeout: 20_000 });
    const message = page.locator('[data-testid^="transcript-message-"]').filter({ has: page.getByText('Append these notes', { exact: true }) });
    await expect(message.getByTestId('attachment-tile')).toBeVisible();
    await message.getByTestId('attachment-tile').click();
    await expect(page.getByTestId('attachment-text-preview')).toHaveText('Preview café notes');
    await page.getByTestId('attachment-preview').getByRole('button', { name: 'Close', exact: true }).first().click();
    await request.post(`${origin}/__control/inbox`, { data: { sessionID, action: 'complete' } });
    await expect(pending).not.toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Append the final task', { exact: true })).toHaveCount(1);
    await page.route('**/api/session/*/prompt', (route) => route.fulfill({ status: 500, json: { error: 'Rejected prompt' } }));
    await sendPrompt(page, 'Retry my failed message');
    await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('Retry my failed message');
    await expect(pending).not.toBeVisible();
  } finally {
    server.kill();
  }
});

test('happy path keeps the main chat flow stable', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Stabilize the chat flow against the fake server');

  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Flow stayed stable against the fake OpenCode server/).first()).toBeVisible();
  await page.getByTestId('chat-changes-chip').click();
  await expect(page.getByTestId('chat-changes-chip')).toHaveAccessibleName('Review changes. 1 file changed, +6 / -1');
  await page.getByText('app/(tabs)/index.tsx', { exact: true }).click();
  await expect(page.getByText(/export default function ChatLandingScreen/)).toBeVisible();
  await goToTab(page, 'Workspace');
  await expect(page.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /^Open chats/ })).toHaveCount(0);
  await expect(page.getByText('Modified', { exact: true })).toHaveCount(2);
});

test('tab navigation preserves the mounted app and an unsent chat draft', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  const documentRequests = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documentRequests.push(request.url());
    }
  });
  const draft = 'Keep this draft while switching tabs';
  await page.getByPlaceholder('Ask anything...').click();
  await page.getByPlaceholder('Ask anything...').fill(draft);
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Send task');

  await goToTab(page, 'Settings');
  await ensureConnectionSection(page);
  await goToTab(page, 'Workspace');
  await expect(page.getByRole('button', { name: 'Change workspace' })).toBeVisible();
  await goToTab(page, 'Chat');
  await expect(page.getByPlaceholder('Ask anything...')).toHaveValue(draft);
  expect(documentRequests).toEqual([]);

  await page.getByTestId('chat-primary-button').click();
  await expect(page.getByText(`Finished: ${draft}`, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
});

test('chat renders GFM tables, ordered lists, and tappable links', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Render markdown regression fixture');

  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expect(table.getByRole('columnheader', { name: 'Tool' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Status' })).toHaveCSS('text-align', 'center');
  await expect(table.locator('tbody tr').nth(1).locator('td').nth(2)).toHaveCSS('text-align', 'right');
  await expect.poll(() => table.evaluate((element) => {
    const viewport = element.parentElement;
    return viewport ? getComputedStyle(viewport).overflowX : '';
  })).toBe('auto');
  await expect.poll(() => table.evaluate((element) => {
    const viewport = element.parentElement;
    return Boolean(viewport && viewport.scrollWidth > viewport.clientWidth);
  })).toBe(true);
  const tableViewport = table.locator('xpath=..');
  await tableViewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect.poll(() => tableViewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const orderedList = page.locator('ol');
  await expect(orderedList).toBeVisible();
  await expect(orderedList.locator('li')).toHaveCount(2);
  const link = page.getByRole('link', { name: 'Markdown reference' });
  await expect(link).toHaveAttribute('href', 'https://example.com/markdown-reference');
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
  const inlineCode = page.locator('code').filter({ hasText: '<text>' });
  await expect(inlineCode).toHaveCount(1);
  await expect(inlineCode).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.08)');
});

test('changes chip preserves the composer and hides for an empty scope', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const chip = page.getByTestId('chat-changes-chip');
  await expect(chip).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Session', exact: true })).toHaveCount(0);
  await sendPrompt(page, 'Review changes without losing my draft');
  await expect(chip).toHaveAccessibleName('Review changes. 1 file changed, +6 / -1');
  await expect(chip.getByText('+6', { exact: true })).toBeVisible();
  await expect(chip.getByText('−1', { exact: true })).toBeVisible();
  const input = page.getByPlaceholder('Ask anything...');
  await input.fill('Keep this draft while reviewing');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chip).toBeVisible();
  const chipBounds = await chip.boundingBox();
  const inputBounds = await input.boundingBox();
  expect(chipBounds.y + chipBounds.height).toBeLessThanOrEqual(inputBounds.y);
  expect(chipBounds.x).toBeGreaterThanOrEqual(0);
  expect(chipBounds.x + chipBounds.width).toBeLessThanOrEqual(390);
  const progressBounds = await page.getByTestId('chat-progress-button').boundingBox();
  expect(Math.abs(progressBounds.y + progressBounds.height / 2 - (chipBounds.y + chipBounds.height / 2))).toBeLessThanOrEqual(1);
  expect(progressBounds.x).toBeGreaterThanOrEqual(chipBounds.x + chipBounds.width);
  await page.getByTestId('chat-progress-button').click();
  await expect(page.getByTestId('progress-overlay')).toBeVisible();
  await page.getByTestId('progress-overlay').getByRole('button', { name: 'Close', exact: true }).click();
  await chip.click();
  const overlay = page.getByTestId('changes-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('1 file changed', { exact: true })).toBeVisible();
  const sheet = overlay.getByLabel('1 file changed', { exact: true });
  const sheetBounds = await sheet.boundingBox();
  expect(sheetBounds.width).toBe(390);
  expect(sheetBounds.y).toBeGreaterThan(300);
  const fileRow = overlay.getByRole('button', { name: /app\/\(tabs\)\/index.tsx/ });
  expect((await fileRow.boundingBox()).height).toBeLessThanOrEqual(56);
  await expect(fileRow).toHaveAttribute('aria-expanded', 'false');
  await expect(overlay.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible();
  await overlay.getByText('app/(tabs)/index.tsx', { exact: true }).click();
  await expect(overlay.getByText('export default function ChatLandingScreen() {', { exact: false })).toBeVisible();
  await expect(fileRow).toHaveAttribute('aria-expanded', 'true');
  expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(input).toHaveValue('Keep this draft while reviewing');
  await chip.click();
  await chooseDiffSource(page, 'Uncommitted');
  await expect(overlay.getByText('No uncommitted changes.', { exact: true })).toBeVisible();
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(chip).toHaveCount(0);
  await expect(page.getByTestId('chat-progress-button')).toBeVisible();
  await expect(input).toHaveValue('Keep this draft while reviewing');
  expect(errors).toEqual([]);
});

for (const scenario of ['permission', 'question']) {
  test(`incoming ${scenario} dismisses changes and its source picker`, async ({ page, request }) => {
    await resetScenario(request, scenario);
    await openReadyChat(page);
    const promptRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/prompt_async'));
    await sendPrompt(page, 'Create changes after resolving a blocker');
    const promptUrl = (await promptRequest).url();
    if (scenario === 'permission') {
      await page.getByText('Allow once', { exact: true }).click();
    } else {
      await page.getByText('Minimal', { exact: true }).click();
      await page.getByText('Submit answer', { exact: true }).click();
    }
    await expect(page.getByTestId('chat-changes-chip')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('chat-changes-chip').click();
    await page.getByRole('button', { name: /Change files changed source/ }).click();
    await expect(page.getByTestId('diff-source-overlay')).toBeVisible();
    const response = await request.post(promptUrl, { data: { parts: [{ type: 'text', text: 'Request another blocker' }] } });
    expect(response.ok()).toBeTruthy();
    await expect(page.getByTestId('changes-overlay')).toHaveCount(0);
    await expect(page.getByTestId('diff-source-overlay')).toHaveCount(0);
    await expect(page.getByText(scenario === 'permission' ? 'Allow once' : 'Which implementation should be used?', { exact: true })).toBeVisible();
  });
}

test('files changed follows the latest user turn', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Create the first file diff');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('chat-changes-chip').click();
  await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible();

  await page.getByTestId('changes-overlay').getByRole('button', { name: 'Close', exact: true }).click();
  await sendPrompt(page, 'Create the second file diff');
  await expect(page.getByText(/Finished: Create the second file diff/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('chat-changes-chip').click();
  await expect(page.getByText('src/feature.ts', { exact: true })).toBeVisible();
  await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).not.toBeVisible();
});

test('files changed switches between turn, uncommitted, and branch diffs', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Create a turn diff for scope switching');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('chat-changes-chip').click();
  await expect(page.getByRole('button', { name: /Change files changed source.*Latest turn diff/ })).toBeVisible();
  await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible();

  // No working-tree edits were saved in this scenario.
  await chooseDiffSource(page, 'Uncommitted');
  await expect(page.getByText('No uncommitted changes.', { exact: true })).toBeVisible();

  // Committed-on-branch fixture from the fake server.
  await chooseDiffSource(page, 'Branch');
  await expect(page.getByRole('button', { name: /Change files changed source.*Changes vs default branch/ })).toBeVisible();
  await expect(page.getByText('README.md', { exact: true })).toBeVisible();

  await chooseDiffSource(page, 'Turn');
  await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible();
});

test('permission requests unblock the agent flow', async ({ page, request }) => {
  await resetScenario(request, 'permission');
  await openReadyChat(page);

  await sendPrompt(page, 'Trigger a permission request');

  await expect(page.getByText('Approval needed', { exact: true }).last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Always allow applies to these future patterns:')).toBeVisible();
  await expect(page.getByText('app/(tabs)/*', { exact: true })).toBeVisible();
  await expect(page.getByText('The OpenCode server controls how long future approval rules apply.')).toBeVisible();
  await page.getByText('Allow once').click();
  await expect(page.getByText(/permission resolved/).first()).toBeVisible({ timeout: 20_000 });
});

test('assistant questions unblock the agent flow', async ({ page, request }) => {
  await resetScenario(request, 'question');
  await openReadyChat(page);

  await sendPrompt(page, 'Ask an implementation question');

  await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Make the smallest safe change.', { exact: true })).toBeVisible();
  await expect(page.getByText('Include broader improvements.', { exact: true })).toBeVisible();
  await page.getByText('Minimal', { exact: true }).click();
  await page.getByText('Submit answer', { exact: true }).click();
  await expect(page.getByText(/selected Minimal/).first()).toBeVisible({ timeout: 20_000 });
});

test('multi-step questions keep drafts across dismissal and submit conditional custom answers', async ({ page, request }) => {
  await resetScenario(request, 'question-multi');
  await openReadyChat(page);
  await sendPrompt(page, 'Ask several implementation questions');

  await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText('Expanded', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Which areas should change?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Return to chat' }).click();
  await expect(page.getByText('Answer needed')).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText('Which areas should change?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Why choose the expanded approach?', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('textbox').fill('Needed for both screens');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('Needed for both screens');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText(/selected Expanded, Chat, Needed for both screens/).first()).toBeVisible({ timeout: 20_000 });
});

test('question submission failure keeps the answer and allows retry', async ({ page, request }) => {
  await resetScenario(request, 'question-failure');
  await openReadyChat(page);
  await sendPrompt(page, 'Ask a question that fails once');
  await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText('Minimal', { exact: true }).click();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByRole('dialog').getByText(/503 Service Unavailable/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText(/Finished: selected Minimal/).first()).toBeVisible({ timeout: 20_000 });
});

test('sessions can be renamed and require confirmation before deletion', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Create a session to rename');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await openChatLibrary(page);
  await chatAction(page, 'Create a session to rename', 'Rename');
  await page.getByTestId('chat-library-title-input').fill('Renamed from Playwright');
  await page.getByText('Save', { exact: true }).click();
  await expect(page.getByText('Renamed from Playwright', { exact: true }).first()).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openChatLibrary(page);
  page.once('dialog', (dialog) => void dialog.accept());
  await chatAction(page, 'Renamed from Playwright', 'Delete');
  await expect(page.getByText('Renamed from Playwright', { exact: true }).nth(1)).not.toBeVisible();
});

test('commands execute through the primary chat action', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, '/review src');
  await expect(page.getByText('Command /review src completed.', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

test('Chat and Workspace use the same workspace picker', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Workspace');
  const workspaceDropdown = page.getByRole('button', { name: 'Change workspace' });
  await expect(workspaceDropdown).toContainText('demo-project');
  await expect(workspaceDropdown).toContainText('/workspace/demo-project');
  await expect(page.getByTestId('workspace-refresh-button')).toBeVisible();
  await workspaceDropdown.click();
  await expect(page.getByTestId('workspace-picker')).toBeVisible();
  await page.getByTestId('workspace-picker').getByRole('button', { name: 'Select secondary-project' }).click();
  await expect(page.getByText('secondary-project', { exact: true }).first()).toBeVisible();

  await goToTab(page, 'Chat');
  await openChatLibrary(page);
  await page.getByRole('button', { name: 'Change workspace' }).click();
  await expect(page.getByTestId('chat-workspace-picker')).toBeVisible();
  await page.getByTestId('chat-workspace-picker').getByRole('button', { name: 'Select demo-project' }).click();
  await goToTab(page, 'Workspace');
  await expect(page.getByText('demo-project', { exact: true }).first()).toBeVisible();

  await workspaceDropdown.click();
  await page.getByTestId('workspace-add-button').click();
  await page.getByTestId('workspace-add-path').fill('/outside/new-project');
  await page.getByTestId('workspace-add-submit').click();
  await expect(page.getByText('OpenCode could not open that directory. Check the server path.')).toBeVisible();
  await page.getByTestId('workspace-add-path').fill('/workspace/new-project');
  await page.getByTestId('workspace-add-submit').click();
  await expect(workspaceDropdown).toContainText('new-project');
  await workspaceDropdown.click();
  await expect(page.getByRole('button', { name: 'Select new-project' })).toBeVisible();
});

test('workspace file search opens deterministic file content', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Workspace');
  await page.getByTestId('workspace-file-search').fill('demo');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('src/demo.ts', { exact: true }).last()).toBeVisible();
  await page.getByText('src/demo.ts', { exact: true }).last().click();
  await expect(page.getByText(/OpenCode 1\.18\.3/)).toBeVisible();
});

test('workspace files save through a conflict-checked VCS patch', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Workspace');
  await page.getByTestId('workspace-file-search').fill('demo');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText('src/demo.ts', { exact: true }).last().click();
  await page.getByText('Edit', { exact: true }).click();
  await page.getByTestId('workspace-file-editor').fill('export const demo = "OpenCode SDK 1.18.3";\n');
  await page.getByTestId('workspace-file-save-button').click();
  await expect(page.getByText(/OpenCode SDK 1\.18\.3/)).toBeVisible();
});

test('sessions archive and restore without deletion', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await sendPrompt(page, 'Archive this session safely');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await openChatLibrary(page);
  await chatAction(page, 'Archive this session safely', 'Archive');
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Hide subagent chats' })).toBeVisible();
  await expect(page.getByText('Archive this session safely', { exact: true }).last()).toBeVisible();
  await chatAction(page, 'Archive this session safely', 'Restore');
  await expect(page.getByText('No archived chats.', { exact: true })).toBeVisible();
});

test('idle chats stay active and archived cards restore and continue the same session', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await sendPrompt(page, 'Continue this idle chat');
  await expect(page.getByText(/Finished: Continue this idle chat/).first()).toBeVisible({ timeout: 20_000 });
  const sessions = await (await request.get('http://127.0.0.1:44096/session')).json();
  const session = sessions.find((entry) => entry.title === 'Continue this idle chat');
  expect(session.time.archived).toBeFalsy();
  await openChatLibrary(page);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.getByText('No archived chats.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await page.getByRole('button', { name: 'Open Continue this idle chat', exact: true }).dblclick();
  await expect(page.getByTestId('chat-library')).not.toBeVisible();
  await openChatLibrary(page);
  await chatAction(page, 'Continue this idle chat', 'Archive');
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: 'Open Continue this idle chat', exact: true }).click();
  await expect(page.getByTestId('chat-library')).not.toBeVisible();
  await expect(page.getByText(/Finished: Continue this idle chat/).first()).toBeVisible();
  await sendPrompt(page, 'Second turn in the restored chat');
  await expect(page.getByText(/Finished: Second turn in the restored chat/).first()).toBeVisible({ timeout: 20_000 });
  const history = await (await request.get(`http://127.0.0.1:44096/session/${session.id}/message`)).json();
  expect(history.filter((entry) => entry.info.role === 'user')).toHaveLength(2);
});

test('archived cards restore sessions in their own workspace and keep errors retryable', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const directory = '/workspace/secondary-project';
  const session = await (await request.post(`http://127.0.0.1:44096/session?directory=${encodeURIComponent(directory)}`, { data: { title: 'Archived elsewhere' } })).json();
  await request.patch(`http://127.0.0.1:44096/session/${session.id}`, { data: { time: { archived: 100 } } });
  await openReadyChat(page);
  await openChatLibrary(page);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  const row = page.getByRole('button', { name: 'Open Archived elsewhere', exact: true });
  const updates = [];
  await page.route(`**/session/${session.id}?*`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    updates.push(new URL(route.request().url()).searchParams.get('directory'));
    if (updates.length === 1) return route.fulfill({ status: 500, json: { error: 'Restore failed' } });
    await route.continue();
  });
  await row.click();
  await expect(page.getByTestId('chat-library').getByText(/PATCH .*500 Internal Server Error/)).toBeVisible();
  await row.click();
  await expect(page.getByTestId('chat-library')).not.toBeVisible();
  expect(updates).toEqual([directory, directory]);
  await sendPrompt(page, 'Continue restored workspace session');
  await expect(page.getByText(/Finished: Continue restored workspace session/).first()).toBeVisible({ timeout: 20_000 });
  const history = await (await request.get(`http://127.0.0.1:44096/session/${session.id}/message`)).json();
  expect(history.some((entry) => entry.info.role === 'user')).toBeTruthy();
});

test('worktrees and MCP servers can be created', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Workspace');
  await page.getByRole('button', { name: 'Change workspace' }).click();
  await page.getByTestId('workspace-worktree-add').click();
  await page.getByTestId('workspace-worktree-name').fill('mobile-test');
  await page.getByTestId('workspace-worktree-create').click();
  await expect(page.getByText('mobile-test', { exact: true })).toBeVisible();
  await page.getByTestId('workspace-picker').getByRole('button', { name: 'Close', exact: true }).click();

  await goToTab(page, 'Settings');
  await page.getByText('Advanced', { exact: true }).click();
  await page.getByText('Remote', { exact: true }).click();
  await page.getByTestId('settings-mcp-name').fill('web-tools');
  await page.getByTestId('settings-mcp-target').fill('https://example.test/mcp');
  await page.getByTestId('settings-mcp-add').click();
  await expect(page.getByText('web-tools', { exact: true })).toBeVisible();
});

async function exerciseInteractiveTerminal(page, request, origin, command) {
  const output = page.getByTestId('terminal-output');
  const input = page.getByRole('textbox', { name: 'Terminal input', exact: true });
  await expect(page.getByTestId('terminal-selector')).toContainText('Connected');
  await output.click();
  await input.pressSequentially(command);
  const snapshot = async () => (await (await request.get(`${origin}/__control/terminal`)).json()).data;
  await expect.poll(async () => (await snapshot())[0].input.join('')).toContain(command);
  await expect(output.locator('.xterm-accessibility-tree')).not.toContainText(`ran: ${command}`);
  await input.press('Enter');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText(`ran: ${command}`);
  await expect.poll(async () => (await snapshot())[0].size?.cols || 0).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'ArrowUp', exact: true }).click();
  await input.press('Enter');
  await expect.poll(async () => (await snapshot())[0].history.filter((line) => line === command).length).toBe(2);
  await input.pressSequentially('discard');
  await page.getByRole('button', { name: 'Ctrl, off', exact: true }).click();
  await input.press('c');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('^C');
  await expect(page.getByRole('button', { name: 'Ctrl, off', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More terminal keys', exact: true }).click();
  await page.getByRole('button', { name: 'F12', exact: true }).click();
  await expect.poll(async () => (await snapshot())[0].input.join('')).toContain('\x1b[24~');
  await page.getByRole('button', { name: 'More terminal keys', exact: true }).click();
  await input.pressSequentially('fixture-screen'); await input.press('Enter');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('FULL SCREEN');
  await expect(output.locator('.xterm-accessibility-tree')).not.toContainText(`ran: ${command}`);
  await input.press('q'); await expect(output.locator('.xterm-accessibility-tree')).toContainText(`ran: ${command}`);
  await page.getByRole('button', { name: 'Ctrl, off', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'Ctrl, locked', exact: true })).toBeVisible();
  await input.press('c'); await input.press('c');
  await expect(page.getByRole('button', { name: 'Ctrl, locked', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ctrl, locked', exact: true }).click();
  await input.pressSequentially('echo 中文😀'); await input.press('Enter');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo 中文😀');
  await input.evaluate(async (element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.value += 'é';
    element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'é' }));
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'é', isComposing: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'é' }));
  });
  await expect.poll(async () => (await snapshot())[0].input.at(-1)).toBe('é');
  await input.press('Enter'); await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: é');
  await input.pressSequentially('cancelled'); await input.press('Control+c');
  const pasteId = (await snapshot())[0].id;
  await request.post(`${origin}/__control/terminal`, { data: { id: pasteId, action: 'output', text: '\x1b[?2004hpaste-ready' } });
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('paste-ready');
  const pasteText = 'echo paste\necho second';
  const dispatchPaste = () => input.evaluate((element, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, pasteText);
  page.once('dialog', (dialog) => dialog.dismiss()); await dispatchPaste();
  const beforeCancel = (await snapshot())[0].input.length;
  await input.press('Control+c');
  await expect.poll(async () => (await snapshot())[0].input.length).toBeGreaterThan(beforeCancel);
  expect((await snapshot())[0].input.join('')).not.toContain('echo paste');
  page.once('dialog', (dialog) => dialog.accept()); await dispatchPaste();
  await expect.poll(async () => (await snapshot())[0].input.join('')).toContain('\x1b[200~echo paste\recho second\x1b[201~');
  await input.press('Control+c');
  await page.getByRole('button', { name: 'Ctrl, off', exact: true }).click();
  await goToTab(page, 'Chat');
  const id = (await snapshot())[0].id;
  await request.post(`${origin}/__control/terminal`, { data: { id, action: 'output', text: '\r\nbackground-output\r\n' } });
  await goToTab(page, 'Terminal'); await expect(output.locator('.xterm-accessibility-tree')).toContainText('background-output');
  await expect(page.getByRole('button', { name: 'Ctrl, off', exact: true })).toBeVisible();
  await request.post(`${origin}/__control/terminal`, { data: { id, action: 'disconnect' } });
  await expect.poll(async () => (await snapshot())[0].connections).toBe(2);
  await expect(page.getByTestId('terminal-selector')).toContainText('Connected');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('background-output');
  await expect.poll(async () => Number((await snapshot())[0].cursors[1])).toBe((await snapshot())[0].output.length);
  return { output, input, id, snapshot };
}

test('terminal streams input and output over the PTY websocket', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Terminal');
  await page.getByTestId('terminal-selector').click();
  await expect(page.getByTestId('terminal-picker-sheet')).toBeVisible();
  await page.getByTestId('terminal-picker').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Type directly in the terminal. Use the accessory for terminal keys.')).toBeVisible();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const { output, input, id, snapshot } = await exerciseInteractiveTerminal(page, request, 'http://127.0.0.1:44096', 'echo web');
  await page.getByTestId('terminal-create-button').click();
  await expect(output).not.toHaveAttribute('data-pty', id);
  await expect(page.getByTestId('terminal-selector')).toContainText('Connected');
  await output.click(); await input.pressSequentially('echo second'); await input.press('Enter');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo second');
  await page.getByTestId('terminal-selector').click();
  await page.getByRole('button', { name: new RegExp(`^Open Terminal, ${id.slice(0, 8)}$`) }).click();
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo web');
  await expect(output.locator('.xterm-accessibility-tree')).not.toContainText('ran: echo second');
  await expect.poll(async () => (await snapshot())[0].connections).toBe(2);
  await request.post('http://127.0.0.1:44096/__control/terminal', { data: { id, action: 'fail-terminate' } });
  await page.getByTestId('terminal-selector').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: new RegExp(`^Close Terminal, ${id.slice(0, 8)}$`) }).click();
  await expect(page.getByText(/DELETE .*\/pty\/pty-1 → 500 Internal Server Error/)).toBeVisible();
  await page.getByTestId('terminal-picker').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo web');
  await page.getByTestId('terminal-selector').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: new RegExp(`^Close Terminal, ${id.slice(0, 8)}$`) }).click();
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo second');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^Close Terminal,/ }).click();
  await expect(page.getByText('No terminals yet. Use + to create one.')).toBeVisible();
});

test('settings can configure an additional provider against the fake server', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Settings');
  await ensureAiSection(page);
  await expect(page.getByText('Configured providers')).toBeVisible();
  await page.getByTestId('settings-add-provider-button').click();
  await expect(page.getByRole('button', { name: 'OpenRouter', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'OpenRouter', exact: true }).click();
  await expect(page.getByText('Configure OpenRouter')).toBeVisible();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-openrouter');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'OpenRouter', exact: true })).toBeVisible();
});

test('V1 providers retain API-key login alongside OAuth metadata', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await page.route('**/provider/auth?**', (route) => route.fulfill({ json: {
    openrouter: [{ type: 'oauth', label: 'Sign in with account' }],
  } }));
  await openReadyChat(page);
  await goToTab(page, 'Settings');
  await ensureAiSection(page);
  await page.getByTestId('settings-add-provider-button').click();
  await page.getByRole('button', { name: 'OpenRouter', exact: true }).click();
  await expect(page.getByText('Configure OpenRouter')).toBeVisible();
  // The login-method picker offers both the server OAuth method and the generic API key.
  await page.getByTestId('provider-method-select').click();
  await expect(page.getByRole('button', { name: 'Sign in with account', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'API key', exact: true }).click();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-manual-key');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Remove OpenRouter credentials', exact: true })).toBeVisible();
});

test('chat model picker searches and groups models by provider', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Settings');
  await ensureAiSection(page);
  await page.getByTestId('settings-add-provider-button').click();
  await page.getByRole('button', { name: 'OpenRouter', exact: true }).click();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-openrouter');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'OpenRouter 0 of 1 selected' }).click();
  await page.getByText('Auto', { exact: true }).click();

  await goToTab(page, 'Chat');
  await page.getByTestId('chat-model-picker-trigger').click();
  const modelPicker = page.getByTestId('chat-model-picker');
  await expect(modelPicker.getByText('OpenAI', { exact: true })).toBeVisible();
  await expect(modelPicker.getByText('OpenRouter', { exact: true })).toBeVisible();
  await expect(modelPicker.getByText('Selected', { exact: true })).toBeVisible();
  await page.getByTestId('chat-model-picker-search').fill('openrouter');
  await expect(modelPicker.getByText('OpenAI', { exact: true })).not.toBeVisible();
  await expect(modelPicker.getByText('Selected', { exact: true })).not.toBeVisible();
  await modelPicker.getByRole('button', { name: /^Auto / }).click();
  await expect(page.getByTestId('chat-model-picker-trigger')).toHaveAccessibleName('Auto · OpenRouter · Default');

  await page.getByTestId('chat-model-picker-trigger').click();
  await expect(page.getByTestId('chat-model-picker-search')).toHaveValue('');
  await modelPicker.getByRole('button', { name: /^GPT-4\.1 mini / }).click();
  await expect(page.getByTestId('chat-model-picker-trigger')).toContainText('GPT-4.1 mini');

  await page.getByTestId('chat-model-picker-trigger').click();
  await expect(modelPicker.getByText('Selected', { exact: true })).toBeVisible();
  await expect(modelPicker.getByText('Recent', { exact: true })).toBeVisible();
  await expect(modelPicker.getByText('OpenRouter · openrouter/auto', { exact: false })).toBeVisible();
  await page.getByTestId('chat-model-picker-search').fill('not-a-model');
  await expect(modelPicker.getByText('Recent', { exact: true })).not.toBeVisible();
  await expect(page.getByText('No matching models', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-model-picker-search')).toHaveValue('not-a-model');
  await page.getByLabel('Close model picker').click();
});

test('polling fallback still finishes the flow when SSE is unavailable', async ({ page, request }) => {
  await resetScenario(request, 'stream-disconnect');
  await openReadyChat(page);

  await sendPrompt(page, 'Finish through polling fallback');

  await expect(page.getByText(/Finished: Finish through polling fallback/).first()).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('chat-changes-chip').click();
  await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible({ timeout: 40_000 });
});

test('deep links switch projects and open a specific session', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = 'http://127.0.0.1:44096';
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/session?directory=${encodeURIComponent(projectPath)}`, {
    data: { title: 'Deep Link Target Session' },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = await createResponse.json();
  const sessionId = created.id;
  expect(sessionId).toBe('session-1');

  await request.post(`${fakeServer}/session/${sessionId}/prompt_async`, {
    data: { parts: [{ type: 'text', text: 'Open me through a deep link' }] },
  });
  await sleep(1500);
  await openReadyChat(page);

  await page.goto(`/session/${sessionId}?project=${encodeURIComponent(projectPath)}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    page.locator('text="Deep Link Target Session" >> visible=true').first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('text="Open me through a deep link" >> visible=true').first(),
  ).toBeVisible();
  await expect(
    page.locator('text=/Finished: Open me through a deep link/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('deep links report sessions that are missing', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = 'http://127.0.0.1:44096';

  await request.post(`${fakeServer}/session`, {
    data: { title: 'Existing Session' },
  });

  await page.goto(`/session/session-999?project=${encodeURIComponent('/workspace/demo-project')}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('Could not open session', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/was not found/).first()).toBeVisible();
});

test('settings explain root-vs-api mismatches and reconnect through a prefixed API base URL', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = await getFreePort();
  const server = spawn(process.execPath, ['tests/fake-opencode/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_OPENCODE_PORT: String(port),
      FAKE_OPENCODE_SCENARIO: 'happy-path',
      FAKE_OPENCODE_BASE_PATH: '/api',
    },
    stdio: 'inherit',
  });

  try {
    await waitForServer(request, `http://127.0.0.1:${port}/api/path`);
    await openReadyChat(page);

    await goToTab(page, 'Settings');
    await ensureConnectionSection(page);

    await setActiveServerUrl(page, `http://127.0.0.1:${port}`);
    await reconnectActiveConnection(page);
    await expect(page.getByText(new RegExp(`OpenCode endpoint not found at http://127.0.0.1:${port}`)).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(`http://127.0.0.1:${port}/api`)).first()).toBeVisible();

    await setActiveServerUrl(page, `http://127.0.0.1:${port}/api`);
    await reconnectActiveConnection(page);
    await expect(page.getByRole('button', { name: /^Connection\. Connected/ })).toBeVisible({ timeout: 15_000 });
    await ensureConnectionSection(page);
    await expect(page.getByText(new RegExp(`Connected to http://127.0.0.1:${port}/api`))).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});

test('settings do not suggest a duplicated /api base when the API prefix is already set', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Settings');
  await ensureConnectionSection(page);

  await setActiveServerUrl(page, 'http://127.0.0.1:44096/api');
  await reconnectActiveConnection(page);
  await expect(page.getByText(/OpenCode endpoint not found at http:\/\/127\.0\.0\.1:44096\/api\b/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/OpenCode 1\.x and 2\.x servers/).first()).toBeVisible();
  await expect(page.getByText(/http:\/\/127\.0\.0\.1:44096\/api\/api/)).toHaveCount(0);
});

test('a 1.x server exposing /api compatibility routes still connects as 1.x', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawn(process.execPath, ['tests/fake-opencode/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_OPENCODE_PORT: String(port),
      FAKE_OPENCODE_SCENARIO: 'happy-path',
      FAKE_OPENCODE_V2_COMPAT: '1',
    },
    stdio: 'inherit',
  });

  try {
    await waitForServer(request, `http://127.0.0.1:${port}/global/health`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await sendPrompt(page, 'Confirm 1.x stays on 1.x');
    await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 30_000 });

    await goToTab(page, 'Settings');
    await ensureConnectionSection(page);
    await expect(page.getByText(new RegExp(`Connected to http://127\\.0\\.0\\.1:${port} \\(OpenCode 1\\.x\\)`))).toBeVisible({ timeout: 15_000 });
  } finally {
    server.kill('SIGTERM');
  }
});

test('connects to an OpenCode 2 server and completes a prompt', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = await getFreePort();
  const server = spawnV2Server(port);

  try {
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await sendPrompt(page, 'Verify the OpenCode 2 adapter');
    await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Flow stayed stable against the fake OpenCode server/).first()).toBeVisible();

    // Context utilization must carry session.model/tokens through the V2
    // adapter and measure the latest model call instead of "Unavailable".
    // Fake V2 usage: 1200 in + 800 cache read + 100 cache write + 240 out.
    await page.getByLabel('Show session usage details').click();
    const usageSheet = page.getByTestId('session-usage-overlay-sheet');
    await expect(usageSheet).toBeVisible();
    expect((await usageSheet.boundingBox()).height).toBeLessThan(500);
    await expect(page.getByText('Context utilization', { exact: true })).toBeVisible();
    await expect(page.getByLabel('2 percent context utilization')).toBeVisible();
    await expect(page.getByText('2.3K of 128K input tokens', { exact: true })).toBeVisible();
    await expect(page.getByText('OpenCode did not provide a context limit for this model.')).toHaveCount(0);
    await page.getByText('Close', { exact: true }).click();

    // V2 prompts have no `system` field, so chat preferences must land in a
    // session instruction entry instead of being dropped.
    const instructions = await (await request.get(`http://127.0.0.1:${port}/__control/instructions`)).json();
    const preferenceValues = Object.values(instructions.data).flatMap((entries) => Object.values(entries));
    expect(preferenceValues.some((value) => typeof value === 'string' && value.includes('Keep responses tightly scoped'))).toBe(true);

    // V2 has no server-owned todo endpoint; the plan is derived from the
    // transcript's `todowrite` tool part.
    await expect(page.getByRole('button', { name: 'Open progress. 2 of 2 tasks completed' })).toBeVisible();

    // Unsupported V2 actions are hidden rather than failing at tap time.
    await expect(page.getByTestId('chat-approve-button')).toHaveCount(0);
    await expect(page.getByTestId('chat-agent-button')).toBeVisible();
    await openChatLibrary(page);
    await expect(page.getByRole('button', { name: 'Archived', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Rename / }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Share / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Archive / })).toHaveCount(0);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Advanced/ }).click();
    await expect(page.getByText(/LSP/)).toHaveCount(0);
    await expect(page.getByText(/Formatters/)).toHaveCount(0);
  } finally {
    server.kill('SIGTERM');
  }
});

for (const providerName of ['OpenCode Go', 'OpenRouter']) {
  test(`OpenCode 2 connects ${providerName} using an API key`, async ({ page, request }) => {
    await resetScenario(request, 'happy-path');
    const port = await getFreePort();
    const server = spawnV2Server(port);
    try {
      await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
      await openReadyChat(page);
      await connectToServer(page, `http://127.0.0.1:${port}`);
      await goToTab(page, 'Settings');
      await ensureAiSection(page);
      await page.getByTestId('settings-add-provider-button').click();
      await page.getByRole('button', { name: new RegExp(`${providerName}$`) }).click();
      await expect(page.getByText(`Configure ${providerName}`)).toBeVisible();
      await page.getByPlaceholder('Paste your API key').fill('sk-test-provider');
      await page.getByTestId('settings-provider-save-button').click();
      await expect(page.getByText(`Configure ${providerName}`)).not.toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: `Remove ${providerName} credentials`, exact: true })).toBeVisible();
      await page.getByRole('button', { name: new RegExp(`${providerName} [0-9]+ of`) }).click();
      await expect(page.getByText(`${providerName} coding model`, { exact: true })).toBeVisible();
      // A reconnect must rediscover the saved connection rather than relying
      // on the adapter's synthetic config.update response.
      await page.reload();
      await ensureAiSection(page);
      await expect(page.getByRole('button', { name: `Remove ${providerName} credentials`, exact: true })).toBeVisible();
      await page.getByRole('button', { name: new RegExp(`${providerName} [0-9]+ of`) }).click();
      await expect(page.getByText(`${providerName} coding model`, { exact: true })).toBeVisible();
      // Existing connections can also replace a key without removing the
      // provider first (including providers connected through environment).
      await page.getByRole('button', { name: new RegExp(`${providerName}$`) }).click();
      await expect(page.getByText(`Configure ${providerName}`)).toBeVisible();
      await page.getByPlaceholder('Paste your API key').fill('sk-test-replacement');
      await page.getByTestId('settings-provider-save-button').click();
      await expect(page.getByText(`Configure ${providerName}`)).not.toBeVisible();
    } finally {
      server.kill('SIGTERM');
    }
  });
}

test('OpenCode 2 lists provider accounts and switches the active one', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = await getFreePort();
  const server = spawnV2Server(port);
  try {
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await goToTab(page, 'Settings');
    await ensureAiSection(page);

    await expect(page.getByText('Accounts', { exact: true })).toBeVisible();
    const work = page.getByRole('button', { name: 'Work', exact: true });
    const personal = page.getByRole('button', { name: 'Personal', exact: true });
    await expect(work).toBeVisible();
    await expect(personal).toBeVisible();

    await personal.click();
    await expect(personal).toBeVisible();

    const removeButtons = page.getByRole('button', { name: 'Remove account', exact: true });
    await expect(removeButtons).toHaveCount(2);
    await removeButtons.last().click();
    await expect(personal).not.toBeVisible();
    await expect(work).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});

test('OpenCode 2 adds a server workspace from the shared picker', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = await getFreePort();
  const server = spawnV2Server(port);
  try {
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await page.route('**/api/project', async (route) => {
      const response = await route.fetch();
      const projects = await response.json();
      await route.fulfill({ response, json: projects.filter((project) => project.canonical !== '/workspace/v2-new-project') });
    });
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await openChatLibrary(page);
    await page.getByRole('button', { name: 'Change workspace' }).click();
    await page.getByTestId('workspace-add-button').click();
    await page.getByTestId('workspace-add-path').fill('/workspace/v2-new-project');
    await page.getByTestId('workspace-add-submit').click();
    await expect(page.getByRole('button', { name: /^Open chats/ })).toContainText('v2-new-project');
    const [promptResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().startsWith(`http://127.0.0.1:${port}/api/session/`) && response.url().endsWith('/prompt') && response.request().method() === 'POST'),
      sendPrompt(page, 'Retained workspace chat'),
    ]);
    expect(promptResponse.status()).toBe(200);
    const { data: { sessionID: retainedSessionId } } = await promptResponse.json();
    const { data: promptedSession } = await (await request.get(`http://127.0.0.1:${port}/api/session/${retainedSessionId}`)).json();
    expect(promptedSession.location.directory).toBe('/workspace/v2-new-project');
    await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('');
    await expect(page.getByText(/Finished: Retained workspace chat/).first()).toBeVisible({ timeout: 30_000 });
    await goToTab(page, 'Workspace');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/project') && response.request().method() === 'GET'),
      page.getByTestId('workspace-refresh-button').click(),
    ]);
    await expect(page.getByRole('button', { name: 'Change workspace' })).toContainText('/workspace/v2-new-project');
    await expect.poll(() => page.evaluate(() => globalThis.localStorage.getItem('opencode-mobile.active-project'))).toBe('/workspace/v2-new-project');
    await goToTab(page, 'Chat');
    await openChatLibrary(page);
    await chatAction(page, 'Retained workspace chat', 'Favorite');
    await page.getByTestId(`chat-library-favorite-${retainedSessionId}`).click();
    await expect(page.getByTestId('chat-library')).not.toBeVisible();
    await expect(page.getByText(/Finished: Retained workspace chat/).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.localStorage.getItem('opencode-mobile.favorite-sessions'))).toContain(retainedSessionId);
    await goToTab(page, 'Workspace');
    await expect(page.getByRole('button', { name: 'Change workspace' })).toContainText('/workspace/v2-new-project');
    await page.getByRole('button', { name: 'Change workspace' }).click();
    await expect(page.getByRole('button', { name: 'Select v2-new-project' })).toBeVisible();
    await page.getByTestId('workspace-picker').getByRole('button', { name: 'Close', exact: true }).click();
    await goToTab(page, 'Settings');
    await reconnectActiveConnection(page);
    await expectConnectedTo(page, String(port));
    await page.reload();
    await goToTab(page, 'Workspace');
    await expect(page.getByRole('button', { name: 'Change workspace' })).toContainText('/workspace/v2-new-project');
    await page.getByRole('button', { name: 'Change workspace' }).click();
    await expect(page.getByRole('button', { name: 'Select v2-new-project' })).toBeVisible();
    await page.getByTestId('workspace-picker').getByRole('button', { name: 'Close', exact: true }).click();
    await goToTab(page, 'Chat');
    await openChatLibrary(page);
    await page.getByTestId(`chat-library-favorite-${retainedSessionId}`).click();
    await expect(page.getByTestId('chat-library')).not.toBeVisible();
    await expect(page.getByText(/Finished: Retained workspace chat/).first()).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});

test('OpenCode 2 permission requests unblock the agent flow', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port, 'permission');
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await sendPrompt(page, 'Trigger a permission request');
    await expect(page.getByText('Approval needed', { exact: true }).last()).toBeVisible({ timeout: 15_000 });
    await page.getByText('Allow once').click();
    await expect(page.getByText(/permission resolved/).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    server.kill('SIGTERM');
  }
});

test('OpenCode 2 questions unblock the agent flow', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port, 'question');
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await sendPrompt(page, 'Ask an implementation question');
    await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByText('Minimal', { exact: true }).click();
    await page.getByText('Submit answer', { exact: true }).click();
    await expect(page.getByText(/question resolved/).first()).toBeVisible({ timeout: 20_000 });
    // The submitted label is translated back to the form option's value, not the label.
    await expect(page.getByText(/"q0":"minimal"/).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    server.kill('SIGTERM');
  }
});

test('OpenCode 2 terminal streams input and output over the PTY websocket', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port);
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await goToTab(page, 'Terminal');
    await page.getByTestId('terminal-create-button').click();
    await exerciseInteractiveTerminal(page, request, `http://127.0.0.1:${port}`, 'echo v2');
    await page.getByTestId('terminal-selector').click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^Close Terminal,/ }).click();
    await expect(page.getByText('No terminals yet. Use + to create one.')).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});

test('OpenCode 2 files changed reads location-scoped VCS diffs', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port);
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await sendPrompt(page, 'Check the OpenCode 2 file changes');
    await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('chat-changes-chip').click();
    await expect(page.getByRole('button', { name: /Change files changed source.*Latest turn diff/ })).toBeVisible();

    // V2 answers unscoped VCS calls for the server's own directory, so the
    // request must carry location[directory] for the workspace diff to show.
    const scopedVcsDiff = page.waitForRequest((candidate) => {
      const url = decodeURIComponent(candidate.url());
      return url.includes('/api/vcs/diff') && url.includes('location[directory]');
    });
    await chooseDiffSource(page, 'Uncommitted');
    await scopedVcsDiff;
    await expect(page.getByText('No uncommitted changes.', { exact: true })).toBeVisible();

    // Committed-on-branch fixture: only reachable through a scoped call.
    await chooseDiffSource(page, 'Branch');
    await expect(page.getByRole('button', { name: /Change files changed source.*Changes vs default branch/ })).toBeVisible();
    await expect(page.getByText('README.md', { exact: true })).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});

test('favorites open sessions in the current workspace', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Favorite current workspace session');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });

  await openChatLibrary(page);
  await chatAction(page, 'Favorite current workspace session', 'Favorite');
  await expect(page.getByText('Favorites', { exact: true })).toBeVisible();
  await page.getByTestId('chat-library').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('chat-library')).not.toBeVisible();
  await page.locator('#root').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 15_000 });
  await openChatLibrary(page);
  await page.getByTestId('chat-library').getByRole('button', { name: 'Open Favorite current workspace session' }).first().click();

  await expect(
    page.locator('text=/Finished: Favorite current workspace session/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('favorites switch projects and open cross-workspace sessions', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = 'http://127.0.0.1:44096';
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/session?directory=${encodeURIComponent(projectPath)}`, {
    data: { title: 'Favorite Cross Workspace Session' },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: sessionId } = await createResponse.json();

  await request.post(`${fakeServer}/session/${sessionId}/prompt_async`, {
    data: { parts: [{ type: 'text', text: 'Open me through a favorite' }] },
  });
  await expect.poll(async () => {
    const response = await request.get(`${fakeServer}/session/${sessionId}/message`);
    return (await response.json()).some((entry) => entry.parts.some((part) => part.type === 'text' && part.text.startsWith('Finished: Open me through a favorite')));
  }, { timeout: 20_000 }).toBe(true);
  await openReadyChat(page);

  await page.goto(`/session/${sessionId}?project=${encodeURIComponent(projectPath)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(
    page.locator('text=/Finished: Open me through a favorite/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });

  await openChatLibrary(page);
  await chatAction(page, 'Favorite Cross Workspace Session', 'Favorite');
  await expect(page.getByText('Favorites', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Change workspace' }).click();
  await page.getByTestId('chat-workspace-picker').getByRole('button', { name: 'Select demo-project' }).click();
  await openChatLibrary(page);
  await expect(page.getByTestId('chat-library').getByText('demo-project · Swipe left for actions', { exact: true })).toBeVisible();
  await page.getByTestId(`chat-library-favorite-${sessionId}`).click();
  await expect(page.getByTestId('chat-library')).not.toBeVisible();

  await expect(
    page.locator('text=/Finished: Open me through a favorite/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('favorites report sessions that are missing', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Favorite vanishing session');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });

  await openChatLibrary(page);
  await chatAction(page, 'Favorite vanishing session', 'Favorite');
  await expect(page.getByText('Favorites', { exact: true })).toBeVisible();

  const deleteResponse = await request.delete('http://127.0.0.1:44096/session/session-1');
  expect(deleteResponse.ok()).toBeTruthy();

  await page.getByTestId('chat-library').getByRole('button', { name: 'Open Favorite vanishing session' }).first().click();
  await expect(
    page.getByText(/could not open|not found|failed/i).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test('rapid favorite taps across workspaces settle on the last target', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = 'http://127.0.0.1:44096';
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/session?directory=${encodeURIComponent(projectPath)}`, {
    data: { title: 'Rapid Tap Secondary' },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: secondarySessionId } = await createResponse.json();

  await request.post(`${fakeServer}/session/${secondarySessionId}/prompt_async`, {
    data: { parts: [{ type: 'text', text: 'Secondary rapid tap target' }] },
  });
  await sleep(1500);
  await openReadyChat(page);
  await sendPrompt(page, 'Primary rapid tap target');
  await expect(page.getByText(/Finished: Primary rapid tap target/).first()).toBeVisible({ timeout: 20_000 });

  await page.goto(`/session/${secondarySessionId}?project=${encodeURIComponent(projectPath)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(
    page.locator('text=/Finished: Secondary rapid tap target/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });
  await openChatLibrary(page);
  await chatAction(page, 'Rapid Tap Secondary', 'Favorite');

  await page.getByRole('button', { name: 'Change workspace' }).click();
  await page.getByTestId('chat-workspace-picker').getByRole('button', { name: 'Select demo-project' }).click();
  await openChatLibrary(page);
  await chatAction(page, 'Primary rapid tap target', 'Favorite');
  await expect(page.getByText('Favorites', { exact: true })).toBeVisible();

  // Dispatch both presses back to back so the second lands before the first
  // navigation closes the library.
  await page.getByTestId('chat-library').getByRole('button', { name: 'Open Rapid Tap Secondary' }).first().dispatchEvent('click');
  await page.getByTestId('chat-library').getByRole('button', { name: 'Open Primary rapid tap target' }).first().dispatchEvent('click');

  await expect(
    page.locator('text=/Finished: Primary rapid tap target/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('chat library lists recently used sessions from other workspaces and switches on tap', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = 'http://127.0.0.1:44096';
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/session?directory=${encodeURIComponent(projectPath)}`, {
    data: { title: 'Recent Secondary Session' },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: sessionId } = await createResponse.json();
  await request.post(`${fakeServer}/session/${sessionId}/prompt_async`, {
    data: { parts: [{ type: 'text', text: 'Recent secondary work' }] },
  });
  await sleep(1200);

  await openReadyChat(page);
  await openChatLibrary(page);

  await expect(page.getByText('Running & recent', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat-library').getByText('Recent Secondary Session', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-library').getByText('secondary-project', { exact: false }).first()).toBeVisible();

  await page.getByTestId('chat-library').getByRole('button', { name: 'Open Recent Secondary Session' }).first().click();

  await expect(page.locator('text=/Finished: Recent secondary work/ >> visible=true').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('secondary-project', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // The group is connection-wide, so it is still listed after switching to the
  // workspace that owns the session (and the session is not duplicated below).
  await openChatLibrary(page);
  await expect(page.getByText('Running & recent', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat-library').getByRole('button', { name: 'Open Recent Secondary Session' })).toHaveCount(1);
});

test('chat library lists running sessions from other workspaces', async ({ page, request }) => {
  await resetScenario(request, 'permission');
  const fakeServer = 'http://127.0.0.1:44096';
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/session?directory=${encodeURIComponent(projectPath)}`, {
    data: { title: 'Running Secondary Session' },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: sessionId } = await createResponse.json();
  await request.post(`${fakeServer}/session/${sessionId}/prompt_async`, {
    data: { parts: [{ type: 'text', text: 'Running secondary work' }] },
  });
  await sleep(500);

  await openReadyChat(page);
  await openChatLibrary(page);

  await expect(page.getByText('Running & recent', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat-library').getByText(/Running · secondary-project/)).toBeVisible();
  await expect(page.getByTestId('chat-library').getByText('Running Secondary Session', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-library').getByText('secondary-project', { exact: false }).first()).toBeVisible();
});

test('saved connections keep sessions, caches, and model preferences separate', async ({ page, request }) => {
  // Two servers, two prompts, and two profile switches need more headroom than
  // a single-flow test.
  test.setTimeout(90_000);
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  // Connection A is the default happy-path server. Give it a session, then
  // save it as a named connection and give it a non-default model preference.
  await connectToServer(page, 'http://127.0.0.1:44096');
  await sendPrompt(page, 'Server A session');
  await expect(page.getByText(/Finished: Server A session/).first()).toBeVisible({ timeout: 20_000 });

  await goToTab(page, 'Settings');
  await addConnection(page, { name: 'Server A', url: 'http://127.0.0.1:44096' });
  await expectConnectedTo(page, '44096');

  await ensureAiSection(page);
  await page.getByTestId('settings-add-provider-button').click();
  await page.getByRole('button', { name: 'OpenRouter', exact: true }).click();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-openrouter');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'OpenRouter 0 of 1 selected' }).click();
  await page.getByText('Auto', { exact: true }).click();
  await goToTab(page, 'Chat');
  await page.getByTestId('chat-model-picker-trigger').click();
  await page.getByTestId('chat-model-picker').getByRole('button', { name: /^Auto / }).click();
  await expect(page.getByTestId('chat-model-picker-trigger')).toHaveAccessibleName('Auto · OpenRouter · Default');

  // Connection B is a separate process with separate server state but the same
  // project paths, which is the cache-isolation case.
  const port = await getFreePort();
  const serverB = spawnV1Server(port);
  try {
    await waitForServer(request, `http://127.0.0.1:${port}/path`);
    await goToTab(page, 'Settings');
    await addConnection(page, { name: 'Server B', url: `http://127.0.0.1:${port}` });
    await expectConnectedTo(page, String(port));

    await goToTab(page, 'Chat');
    await expect(page.getByTestId('chat-model-picker-trigger')).toContainText('GPT-4.1 mini', { timeout: 15_000 });
    await sendPrompt(page, 'Server B session');
    await expect(page.getByText(/Finished: Server B session/).first()).toBeVisible({ timeout: 20_000 });

    // Switching to A restores A's model preference and A's own session list;
    // B's session must never appear while connected to A.
    await goToTab(page, 'Settings');
    await connectToSavedConnection(page, 'Server A');
    await expectConnectedTo(page, '44096');
    await goToTab(page, 'Chat');
    await expect(page.getByTestId('chat-model-picker-trigger')).toHaveAccessibleName('Auto · OpenRouter · Default', { timeout: 15_000 });
    await openChatLibrary(page);
    await expect(page.getByTestId('chat-library').getByRole('button', { name: 'Open Server A session' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('chat-library').getByRole('button', { name: 'Open Server B session' })).toHaveCount(0);
    await page.getByTestId('chat-library').getByRole('button', { name: 'Close' }).click();

    // Switching back to B restores B's default model and B's own sessions.
    await goToTab(page, 'Settings');
    await connectToSavedConnection(page, 'Server B');
    await expectConnectedTo(page, String(port));
    await goToTab(page, 'Chat');
    await expect(page.getByTestId('chat-model-picker-trigger')).toContainText('GPT-4.1 mini', { timeout: 15_000 });
    await openChatLibrary(page);
    await expect(page.getByTestId('chat-library').getByRole('button', { name: 'Open Server B session' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('chat-library').getByRole('button', { name: 'Open Server A session' })).toHaveCount(0);
  } finally {
    serverB.kill('SIGTERM');
  }
});


test('busy safety polling recovers completion while SSE remains connected', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV1Server(port);
  const origin = `http://127.0.0.1:${port}`;
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `${origin}/path`);
    await openReadyChat(page);
    await connectToServer(page, origin);
    const control = `${origin}/__control/event-stream`;
    await expect.poll(async () => (await (await request.post(control, { data: { suppress: true } })).json()).data.clients).toBeGreaterThan(0);
    await sendPrompt(page, 'Recover a missed completion');
    await expect(page.getByText(/Finished: Recover a missed completion/).first()).toBeVisible({ timeout: 20_000 });
    expect((await (await request.post(control, { data: { suppress: false } })).json()).data.clients).toBeGreaterThan(0);
  } finally {
    server.kill('SIGTERM');
  }
});

// A provider error schedules an automatic retry. The retry status is event-only
// (the running set excludes it), so a session-list refresh must not downgrade it
// to idle or the idle connected session stops polling and the transcript
// freezes. The fake server writes the recovered output with no SSE event, so
// only the preserved busy status and its safety poll can surface it.
test('v2 provider retry survives refresh and the safety poll recovers output', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port, 'retry');
  const origin = `http://127.0.0.1:${port}`;
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `${origin}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, origin);
    await sendPrompt(page, 'Retry recovery');
    await expect(page.getByText(/retrying \(attempt 2\)/)).toBeVisible({ timeout: 15_000 });
    // Recovered output lands after the post-send refresh window and emits no
    // event, so the 10s busy safety poll is the only thing that can render it.
    await expect(page.getByText(/Recovered: Retry recovery/).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    server.kill('SIGTERM');
  }
});

for (const protocol of ['v1', 'v2']) {
  test(`${protocol} SSE reconnect reconciles a missed blocking question`, async ({ page, request }) => {
    const port = await getFreePort();
    const server = protocol === 'v2' ? spawnV2Server(port, 'question') : spawnV1Server(port, 'question');
    const origin = `http://127.0.0.1:${port}`;
    try {
      await resetScenario(request, 'happy-path');
      await waitForServer(request, `${origin}${protocol === 'v2' ? '/api/info' : '/path'}`);
      await openReadyChat(page);
      await connectToServer(page, origin);
      const control = `${origin}/__control/event-stream`;
      await expect.poll(async () => (await (await request.post(control, { data: { suppress: true } })).json()).data.clients).toBeGreaterThan(0);
      // Create a pending interaction outside the selected chat. The idle client
      // has no safety poll, so only reconnect reconciliation can discover it.
      const sessionsPath = protocol === 'v2' ? '/api/session' : '/session';
      const created = await (await request.post(`${origin}${sessionsPath}`, { data: { title: 'Missed question' } })).json();
      const session = protocol === 'v2' ? created.data : created;
      await request.post(`${origin}${sessionsPath}/${session.id}/${protocol === 'v2' ? 'prompt' : 'prompt_async'}`, {
        data: protocol === 'v2' ? { text: 'Ask an implementation question' } : { parts: [{ type: 'text', text: 'Ask an implementation question' }] },
      });
      const pendingPath = protocol === 'v2' ? '/api/form?location[directory]=/workspace/demo-project' : '/question?directory=/workspace/demo-project';
      await expect.poll(async () => {
        const payload = await (await request.get(`${origin}${pendingPath}`)).json();
        return (protocol === 'v2' ? payload.data : payload).length;
      }).toBe(1);
      const snapshot = page.waitForResponse((response) => response.url().startsWith(`${origin}${sessionsPath}?`) && response.request().method() === 'GET');
      await request.post(control, { data: { suppress: true, disconnect: true } });
      await snapshot;
      await openChatLibrary(page);
      await page.getByText('Missed question', { exact: true }).first().click();
      await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
      await page.getByText('Minimal', { exact: true }).click();
      await page.getByText('Submit answer', { exact: true }).click();
      await expect(page.getByText(/question resolved|selected Minimal/).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      server.kill('SIGTERM');
    }
  });
}


test('composer exposes direct approvals, agent selection and thinking in the model picker without losing drafts', async ({ page, request }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  const prompt = page.getByTestId('chat-prompt-input');
  const approvals = page.getByTestId('chat-approve-button');
  const agent = page.getByTestId('chat-agent-button');
  const model = page.getByTestId('chat-model-picker-trigger');
  await expect(model).toHaveAccessibleName('GPT-4.1 mini · OpenAI · Default');
  await expect(page.getByTestId('chat-secondary-button')).toHaveAccessibleName('Start dictation');
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Start conversation mode');
  await expect(page.getByRole('button', { name: 'Start conversation mode', exact: true })).toHaveCount(1);
  await expect(approvals).toHaveAccessibleName('Approvals: Ask before actions');
  await expect(agent).toHaveAccessibleName('Agent: Build');
  await prompt.fill('Keep this draft');
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Send task');
  await expect(page.getByRole('button', { name: 'Start conversation mode', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-secondary-button')).toHaveAccessibleName('Start dictation');
  await model.click();
  const picker = page.getByTestId('chat-model-picker');
  const thinking = picker.getByRole('slider', { name: 'Reasoning', exact: true });
  await expect(thinking).toHaveAttribute('aria-valuenow', '1');
  await thinking.focus();
  await thinking.press('End');
  await expect(thinking).toHaveAttribute('aria-valuetext', 'High');
  // Thinking remains adjustable while comparing/selecting models.
  await expect(picker.getByText('Selected', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(model).toHaveAccessibleName('GPT-4.1 mini · OpenAI · High');
  await expect(prompt).toHaveValue('Keep this draft');
  await agent.click();
  await page.getByText('General', { exact: true }).click();
  await expect(agent).toHaveAccessibleName('Agent: General');
  await expect(prompt).toHaveValue('Keep this draft');
  await page.route('**/config?**', (route) => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { message: 'Could not update approvals' } }) : route.continue());
  await approvals.click();
  await expect(page.getByText('Action failed', { exact: true })).toBeVisible();
  await expect(approvals).toHaveAccessibleName('Approvals: Ask before actions');
  await page.unroute('**/config?**');
  await approvals.click();
  await expect(approvals).toHaveAccessibleName('Approvals: Auto-approve');
  await approvals.click();
  await expect(approvals).toHaveAccessibleName('Approvals: Ask before actions');
  await expect(prompt).toHaveValue('Keep this draft');
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Send task');
  await expect(page.getByTestId('chat-attach-button')).toHaveAccessibleName('Attach files');
  await goToTab(page, 'Workspace');
  await goToTab(page, 'Chat');
  await expect(page.getByTestId('chat-model-picker')).toHaveCount(0);
});

test('starter examples fill without sending and library empty copy follows visible chats', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await page.getByText('Explain this project', { exact: true }).click();
  await expect(page.getByTestId('chat-prompt-input')).toHaveValue('Explain this project');
  await expect(page.getByText('Start a new task')).toBeVisible();
  await page.getByText('Help investigate a bug', { exact: true }).click();
  await expect(page.getByTestId('chat-prompt-input')).toHaveValue(/Symptoms:/);
  await openChatLibrary(page);
  const library = page.getByTestId('chat-library');
  await expect(library.getByRole('button', { name: /^Open / }).first()).toBeVisible();
  await expect(library.getByText('No chats found.', { exact: true })).toHaveCount(0);
  await page.getByTestId('chat-library-search').fill('not-a-chat-zz');
  await expect(library.getByText('No chats match your search.', { exact: true })).toBeVisible();
});

test('workspace shows changed files, deleted scope, search states and failure recovery', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await page.route('**/file/status?**', (route) => route.fulfill({ json: [
    { path: 'src/demo.ts', status: 'modified', added: 2, removed: 1 },
    { path: 'README.md', status: 'added', added: 1, removed: 0 },
    { path: 'removed.ts', status: 'deleted', added: 0, removed: 1 },
  ] }));
  await openReadyChat(page);
  await goToTab(page, 'Workspace');
  await expect(page.getByText('Deleted file content is unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
  await page.getByText('src/demo.ts', { exact: true }).click();
  await expect(page.getByText(/OpenCode 1\.18\.3/)).toBeVisible();
  await page.getByLabel('Close file').click();
  await expect(page.getByLabel('Close file')).toHaveCount(0);
  const search = page.getByTestId('workspace-file-search');
  await search.fill('no-match-zz');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
  await expect(search).toBeFocused();
  await search.press('Enter');
  await expect(page.getByText('No files match “no-match-zz”.')).toBeVisible();
  await page.route('**/find/file?**', (route) => route.fulfill({ status: 500, json: { message: 'Search unavailable' } }));
  await search.fill('demo');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/Search unavailable|500|search workspace files/i).first()).toBeVisible();
  await page.unroute('**/find/file?**');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Results for “demo”')).toBeVisible();
});

test('completed progress stays compact and patch review selects its turn after a later response', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV1Server(port);
  try {
    await waitForServer(request, `http://127.0.0.1:${port}/path`);
    await request.post(`http://127.0.0.1:${port}/session`, { data: { title: 'Review turns' } });
    await page.addInitScript((serverUrl) => { globalThis.localStorage.setItem('opencode-mobile.settings', JSON.stringify({ serverUrl, username: '', directory: '/workspace/demo-project' })); }, `http://127.0.0.1:${port}`);
    await openReadyChat(page);
    await expect(page.getByRole('button', { name: 'Open chats. Review turns' })).toBeVisible();
    await sendPrompt(page, 'Review first turn');
    await expect(page.getByText(/Finished: Review first turn/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('All tasks completed', { exact: true })).toHaveCount(0);
    const progressFab = page.getByTestId('chat-progress-button');
    await expect(progressFab).toHaveAccessibleName('Open progress. 2 of 2 tasks completed');
    const progressBounds = await progressFab.boundingBox();
    expect(progressBounds.width).toBeLessThanOrEqual(56);
    expect(progressBounds.height).toBeLessThanOrEqual(56);
    // Present deterministic provider-owned todo snapshots through the existing endpoint.
    let completed = 0;
    await page.route('**/session/*/todo?**', (route) => route.fulfill({ json: [
      { content: 'Validate session transcript', status: completed >= 1 ? 'completed' : 'in_progress', priority: 'high' },
      { content: 'Confirm fake server integration', status: completed >= 2 ? 'completed' : 'pending', priority: 'medium' },
    ] }));
    for (completed of [0, 1, 2]) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(progressFab).toHaveAccessibleName(`Open progress. ${completed} of 2 tasks completed`);
    }
    await page.unroute('**/session/*/todo?**');
    await page.getByRole('button', { name: /^Open progress/ }).click();
    await expect(page.getByTestId('progress-overlay')).toBeVisible();
    await page.getByTestId('progress-overlay').getByRole('button', { name: 'Close', exact: true }).click();
    await sendPrompt(page, 'Review second turn');
    await expect(page.getByText(/Finished: Review second turn/).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Updated 1 patch. Review changes' }).first().click();
    await expect(page.getByRole('button', { name: /Change files changed source.*Selected turn diff/ })).toBeVisible();
    await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible();
    await expect(page.getByText('src/feature.ts', { exact: true })).toHaveCount(0);
  } finally { server.kill('SIGTERM'); }
});

for (const contract of ['v1', 'v2']) {
  test(`${contract} workspace browses scoped folders and switches worktrees across tabs`, async ({ page, request }) => {
    const port = await getFreePort();
    const server = contract === 'v1' ? spawnV1Server(port) : spawnV2Server(port);
    try {
      await resetScenario(request, 'happy-path');
      await waitForServer(request, `http://127.0.0.1:${port}/${contract === 'v1' ? 'path' : 'api/info'}`);
      await openReadyChat(page);
      await connectToServer(page, `http://127.0.0.1:${port}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await goToTab(page, 'Workspace');
      await expect(page.getByTestId('workspace-entry-src')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Worktrees' })).toHaveCount(0);
      await page.screenshot({ path: `/tmp/opencode-workspace-${contract}.png` });
      await page.getByTestId('workspace-entry-src').click();
      await expect(page.getByTestId('workspace-entry-src/demo.ts')).toBeVisible();
      await goToTab(page, 'Chat');
      await goToTab(page, 'Workspace');
      await expect(page.getByTestId('workspace-entry-src/demo.ts')).toBeVisible();
      await page.getByTestId('workspace-file-search').fill('README');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByTestId('workspace-entry-README.md').click();
      await expect(page.getByText(/# Demo project/)).toBeVisible();
      await page.getByLabel('Close file').click();
      await expect(page.getByText('Results for “README”')).toBeVisible();
      await page.getByRole('button', { name: 'Clear search' }).click();
      await expect(page.getByTestId('workspace-entry-src/demo.ts')).toBeVisible();
      await page.getByRole('button', { name: 'demo-project', exact: true }).click();
      await page.getByTestId('workspace-entry-assets').click();
      await page.getByTestId('workspace-entry-assets/binary.dat').click();
      await expect(page.getByText('Binary files cannot be previewed as text.')).toBeVisible();
      await page.getByRole('button', { name: 'Change workspace' }).click();
      const picker = page.getByTestId('workspace-picker');
      await picker.getByRole('button', { name: 'Select secondary-project' }).click();
      await page.getByTestId('workspace-entry-src').click();
      await page.getByTestId('workspace-entry-src/demo.ts').click();
      await expect(page.getByText(/export const workspace = "\/workspace\/secondary-project"/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(contract === 'v1' ? 1 : 0);
      await page.getByLabel('Close file').click();
      await page.getByRole('button', { name: 'Change workspace' }).click();
      await page.getByTestId('workspace-worktree-add').click();
      await expect(page.getByTestId('workspace-worktree-command')).toHaveCount(contract === 'v1' ? 1 : 0);
      await page.getByTestId('workspace-worktree-name').fill('scoped-task');
      await page.getByTestId('workspace-worktree-create').click();
      await expect(picker.getByRole('button', { name: 'Select scoped-task' })).toBeVisible();
      await page.screenshot({ path: `/tmp/opencode-workspace-picker-${contract}.png` });
      await picker.getByRole('button', { name: 'Select scoped-task' }).click();
      await expect(page.getByRole('button', { name: 'Change workspace' })).toContainText('/worktrees/scoped-task');
      await page.getByTestId('workspace-entry-README.md').click();
      await expect(page.getByText('# Worktree scoped-task', { exact: false })).toBeVisible();
      await page.getByLabel('Close file').click();
      await goToTab(page, 'Chat');
      await sendPrompt(page, 'Work in the selected worktree');
      await expect(page.getByText(/Finished: Work in the selected worktree/).first()).toBeVisible({ timeout: 20_000 });
      await goToTab(page, 'Terminal');
      await page.getByTestId('terminal-create-button').click();
      await expect(page.getByTestId('terminal-output')).toBeVisible();
      await goToTab(page, 'Workspace');
      await page.reload();
      await expect(page.getByRole('button', { name: 'Change workspace' })).toContainText('/worktrees/scoped-task');
      await page.getByRole('button', { name: 'Change workspace' }).click();
      await expect(picker.getByText('Worktrees · secondary-project')).toBeVisible();
      await expect(picker.getByRole('button', { name: 'Manage scoped-task' })).toBeDisabled();
      await picker.getByRole('button', { name: 'Select secondary-project' }).click();
      await page.getByRole('button', { name: 'Change workspace' }).click();
      await picker.getByRole('button', { name: 'Manage scoped-task' }).click();
      await expect(picker.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(contract === 'v1' ? 1 : 0);
      page.once('dialog', (dialog) => dialog.accept());
      await picker.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(picker.getByRole('button', { name: 'Select scoped-task' })).toHaveCount(0);
    } finally { server.kill('SIGTERM'); }
  });
}

test('workspace editor confirms discarded edits and keeps conflict failures recoverable', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Workspace');
  await page.getByTestId('workspace-entry-src').click();
  await page.getByTestId('workspace-entry-src/demo.ts').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByTestId('workspace-file-editor').fill('unsaved draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByLabel('Close file').click();
  await expect(page.getByTestId('workspace-file-editor')).toHaveValue('unsaved draft');
  await page.route('**/file/content?**', (route) => route.fulfill({ json: { type: 'text', content: 'changed on server' } }));
  await page.getByTestId('workspace-file-save-button').click();
  await expect(page.getByText('The file changed on the server. Reopen it before saving.')).toBeVisible();
  await expect(page.getByTestId('workspace-file-editor')).toHaveValue('unsaved draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Close file').click();
  await expect(page.getByTestId('workspace-entry-src/demo.ts')).toBeVisible();
});
