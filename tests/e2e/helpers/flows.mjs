import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

// Shared Playwright helpers for the flow specs. Extracted from the former
// monolithic flows.spec.mjs so each domain spec can stay readable.

// Existing flows assume the app boots straight into chat. Seed a completed
// onboarding marker so first-run setup is skipped; the dedicated onboarding
// spec intentionally omits this so the assistant is exercised.
export const compatibilityTitles = [
  'sessions archive and restore without deletion',
  'idle chats stay active and archived cards restore and continue the same session',
  'archived cards restore sessions in their own project and keep errors retryable',
  'V1 providers retain API-key login alongside OAuth metadata',
  'settings do not suggest a duplicated /api base when the API prefix is already set',
  'composer exposes direct approvals, agent selection and thinking in the model picker without losing drafts',
  'project files save through a conflict-checked VCS patch',
];
export const usesCompatibility = (title) => compatibilityTitles.includes(title) || title.includes('v1 compatibility');
export const backendOrigin = () => `http://127.0.0.1:${usesCompatibility(test.info().title) ? 44097 : 44096}`;

export async function getFreePort() {
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

export async function resetScenario(request, scenario) {
  const response = await request.post(`${backendOrigin()}/__control/reset`, {
    data: { scenario },
  });

  expect(response.ok()).toBeTruthy();
}

export async function openReadyChat(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
}

export async function openChatLibrary(page) {
  await page.getByRole('button', { name: /^Open chats/ }).click();
  await expect(page.getByTestId('chat-library')).toBeVisible();
}

// Drag a bottom sheet's header straight down until it dismisses. The transparent
// modal sheets slide in over ~250ms, so wait for the measured top to settle
// before starting the drag; otherwise the pointer lands mid-sheet.
export async function swipeSheetHeaderDown(page, locator) {
  await expect.poll(async () => {
    const first = await locator.boundingBox();
    await page.waitForTimeout(50);
    const second = await locator.boundingBox();
    return Boolean(first && second && Math.abs(first.y - second.y) < 1);
  }).toBe(true);
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + 24;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(startX, startY + step * 40);
  }
  await page.mouse.up();
}

export async function closeSettingsOverlay(page) {
  const overlay = page.getByTestId('settings-section-overlay');
  if (await overlay.isVisible().catch(() => false)) await overlay.getByRole('button', { name: 'Close', exact: true }).first().click();
}

export async function goToTab(page, name) {
  await closeSettingsOverlay(page);
  const changes = page.getByTestId('changes-overlay');
  if (await changes.isVisible().catch(() => false)) await changes.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name }).click();
}

export async function chatAction(page, title, action) {
  const escapedTitlePrefix = title.slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('button', { name: new RegExp(`^${action} ${escapedTitlePrefix}`) }).click();
}

export async function chooseDiffSource(page, source) {
  await page.getByRole('button', { name: /Change files changed source/ }).click();
  const sheet = page.getByTestId('diff-source-overlay-sheet');
  await expect(sheet).toBeVisible();
  expect((await sheet.boundingBox()).height).toBeLessThan(400);
  await page.getByTestId('diff-source-overlay').getByText(source, { exact: true }).click();
  const overlay = page.getByTestId('diff-source-overlay');
  if (await overlay.isVisible().catch(() => false)) await overlay.getByRole('button', { name: 'Close', exact: true }).first().click();
}

export function spawnV2Server(port, scenario = 'happy-path') {
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

export function spawnV1Server(port, scenario = 'happy-path') {
  return spawn(process.execPath, ['tests/fake-opencode/server-v1.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_OPENCODE_PORT: String(port),
      FAKE_OPENCODE_SCENARIO: scenario,
    },
    stdio: 'inherit',
  });
}

export async function clickWithRetry(locator) {
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
export async function ensureConnectionSection(page) {
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
export async function openCurrentConnectionRow(page) {
  const edit = page.locator('[data-testid^="connection-edit-"]').first();
  for (let attempt = 0; attempt < 4; attempt++) {
    await ensureConnectionSection(page);
    if (await edit.isVisible().catch(() => false)) return;
    const current = page.getByTestId('connection-row-current');
    const row = await current.count() ? current : page.locator('[data-testid^="connection-row-"]').first();
    await clickWithRetry(row);
    if (await edit.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)) return;
  }
  await expect(edit).toBeVisible();
}

// Opens the add/edit connection dialog and verifies it actually opened; the
// Connection subtree can still be animating when the trigger is tapped.
export async function openConnectionDialog(page, trigger, openedLocator) {
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
export async function setActiveServerUrl(page, url) {
  await openCurrentConnectionRow(page);
  await openConnectionDialog(page, page.locator('[data-testid^="connection-edit-"]').first(), page.getByTestId('connection-profile-url-input'));
  await page.getByTestId('connection-profile-url-input').fill(url);
  await clickWithRetry(page.getByTestId('connection-profile-continue'));
  await clickWithRetry(page.getByTestId('connection-profile-save-confirm'));
  await expect(page.getByTestId('connection-profile-url-input')).not.toBeVisible({ timeout: 10_000 });
}

export async function reconnectActiveConnection(page) {
  await openCurrentConnectionRow(page);
  await clickWithRetry(page.getByTestId('connection-reconnect').or(page.locator('[data-testid^="connection-connect-"]')).first());
}

// The status card only renders inside the expanded Connection card, and the
// card can re-render while a tab becomes visible, so keep re-opening it until
// the message names the expected server.
export async function expectConnectedTo(page, host) {
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

export async function connectToServer(page, url) {
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
export async function addConnection(page, { name, url }) {
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
export async function connectToSavedConnection(page, name) {
  await ensureConnectionSection(page);
  const header = page.locator('[data-testid^="connection-row-"]').filter({ hasText: name }).first();
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click();
  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  if (await connect.isVisible()) { await connect.click(); return; }
  // Connected servers stay connected. Select their project to change chat focus.
  await goToTab(page, 'Projects');
  await page.getByRole('button', { name: 'Change project', exact: true }).click();
  await page.getByRole('button', { name: /^All servers: / }).click();
  await page.getByRole('button', { name, exact: true }).last().click();
  await page.getByRole('button', { name: /^Select / }).first().click();
  await goToTab(page, 'Settings');
}

// The Connection card starts expanded, so reach the AI defaults card
// explicitly before configuring providers.
export async function ensureAiSection(page) {
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

export async function sendPrompt(page, prompt) {
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

export async function waitForServer(request, url, timeoutMs = 10_000) {
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

export async function attachFile(page, name, mimeType, buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('chat-attach-button').click();
  await (await chooser).setFiles({ name, mimeType, buffer });
}

export async function exerciseInteractiveTerminal(page, request, origin, command) {
  await page.getByTestId('terminal-create-confirm').click();
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

export async function seedOnboarding(page, info) {
  await page.addInitScript((legacy) => {
    globalThis.localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    if (legacy) globalThis.localStorage.setItem('opencode-mobile.settings', JSON.stringify({ serverUrl: 'http://127.0.0.1:44097', username: '', directory: '' }));
  }, usesCompatibility(info.title));
}
