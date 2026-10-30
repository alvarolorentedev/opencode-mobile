import { Buffer } from 'node:buffer';
import { expect, test } from './helpers/fixtures.mjs';

import { attachFile, backendOrigin, chooseDiffSource, connectToServer, ensureConnectionSection, getFreePort, goToTab, openChatLibrary, openReadyChat, resetScenario, seedOnboarding, sendPrompt, spawnV1Server, spawnV2Server, swipeSheetHeaderDown, waitForServer, workspaceProjectButton } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

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
  // Compare document order rather than viewport coordinates. The transcript
  // auto-scrolls while the message settles, so two boundingBox() reads can be
  // taken at different scroll positions and report a false vertical inversion.
  await expect.poll(async () => message.evaluate((node) => {
    const tile = node.querySelector('[data-testid="attachment-tile"]');
    const text = [...node.querySelectorAll('*')].find((element) => element.textContent === 'Explain the attached pixel');
    return Boolean(tile && text && tile.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await page.reload();
  await expect(message.getByTestId('attachment-tile')).toBeVisible({ timeout: 20_000 });
  await message.getByTestId('attachment-tile').click();
  await expect(page.getByTestId('attachment-image-preview')).toBeVisible();
});

test('reverting a running reply stops it before staging the rewind', async ({ page, request }) => {
  await resetScenario(request, 'inbox');
  await page.setViewportSize({ width: 390, height: 844 });
  await openReadyChat(page);
  await sendPrompt(page, 'Keep working on the revert');
  await expect(page.getByTestId('transcript-activity-session-status')).toContainText('OpenCode is working…');
  await expect(page.getByText('Working on: Keep working on the revert', { exact: true }).first()).toBeVisible();

  const userMessage = page.locator('[data-testid^="transcript-message-"]').filter({ has: page.getByText('Keep working on the revert', { exact: true }) });
  await userMessage.getByRole('button', { name: 'Revert from this message' }).click();

  await expect(page.getByTestId('chat-revert-notice')).toBeVisible();
  await expect(page.getByText('Action failed', { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('Keep working on the revert');
});

test('OpenCode 2 keeps steer and append prompts pinned until delivery and recovers them after reload', async ({ page, request }) => {
  test.setTimeout(90_000);
  await resetScenario(request, 'happy-path');
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
    await page.getByTestId('settings-category-responses').click();
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

test('happy path keeps the main chat flow stable @smoke', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Stabilize the chat flow against the fake server');

  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Flow stayed stable against the fake OpenCode server/).first()).toBeVisible();
  await page.getByTestId('chat-changes-chip').click();
  await expect(page.getByTestId('chat-changes-chip')).toHaveAccessibleName('Review changes. 1 file changed, +6 / -1');
  await page.getByText('app/(tabs)/index.tsx', { exact: true }).click();
  await expect(page.getByText(/export default function ChatLandingScreen/)).toBeVisible();
  await goToTab(page, 'Projects');
  await expect(page.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /^Open chats/ })).toHaveCount(0);
  await expect(page.getByText('Modified', { exact: true })).toHaveCount(2);
});

test('tab navigation preserves the mounted app and an unsent chat draft @smoke', async ({ page, request }) => {
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
  await goToTab(page, 'Projects');
  await expect(workspaceProjectButton(page)).toBeVisible();
  await goToTab(page, 'Chat');
  await expect(page.getByPlaceholder('Ask anything...')).toHaveValue(draft);
  expect(documentRequests).toEqual([]);

  await page.getByTestId('chat-primary-button').click();
  await expect(page.getByText(`Finished: ${draft}`, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
});

test('returning to the chat tab keeps the loaded transcript without a skeleton', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await sendPrompt(page, 'Keep this transcript across tabs');
  const finished = page.getByText(/Finished: Keep this transcript across tabs/).first();
  await expect(finished).toBeVisible({ timeout: 20_000 });

  await goToTab(page, 'Projects');
  await expect(workspaceProjectButton(page)).toBeVisible();
  await goToTab(page, 'Chat');

  await expect(finished).toBeVisible();
  await expect(page.getByTestId('transcript-skeleton')).toHaveCount(0);
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

test('overlay sheets dismiss on a downward header swipe', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await openChatLibrary(page);
  const library = page.getByTestId('chat-library');
  await expect(library).toBeVisible();
  // The sheet carries the title as its accessible name and renders its header
  // (the drag zone) at the top of the panel.
  const sheet = page.getByLabel('Chats', { exact: true });
  await expect(sheet).toBeVisible();
  await swipeSheetHeaderDown(page, sheet);
  await expect(library).toBeHidden();
});

test('modal bottom sheets dismiss on a downward header swipe', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await page.getByTestId('chat-model-picker-trigger').click();
  const picker = page.getByTestId('chat-model-picker');
  await expect(picker).toBeVisible();
  await swipeSheetHeaderDown(page, picker);
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('chat-model-picker-trigger')).toBeVisible();
});

test('composer exposes agent selection without losing drafts', async ({ page, request }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  const prompt = page.getByTestId('chat-prompt-input');
  const agent = page.getByTestId('chat-agent-button');
  const model = page.getByTestId('chat-model-picker-trigger');
  await expect(model).toHaveAccessibleName('GPT-4.1 mini · OpenAI');
  await expect(page.getByTestId('chat-secondary-button')).toHaveAccessibleName('Start dictation');
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Start conversation mode');
  await expect(page.getByRole('button', { name: 'Start conversation mode', exact: true })).toHaveCount(1);
  await expect(agent).toHaveAccessibleName('Agent: Build');
  await prompt.fill('Keep this draft');
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Send task');
  await expect(page.getByRole('button', { name: 'Start conversation mode', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-secondary-button')).toHaveAccessibleName('Start dictation');
  await model.click();
  const picker = page.getByTestId('chat-model-picker');
  // The default catalog model has no variants, so no reasoning slider is shown.
  await expect(picker.getByRole('slider', { name: 'Reasoning', exact: true })).toHaveCount(0);
  await expect(picker.getByText('Selected', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(model).toHaveAccessibleName('GPT-4.1 mini · OpenAI');
  await expect(prompt).toHaveValue('Keep this draft');
  await agent.click();
  await page.getByText('General', { exact: true }).click();
  await expect(agent).toHaveAccessibleName('Agent: General');
  await expect(prompt).toHaveValue('Keep this draft');
  await expect(prompt).toHaveValue('Keep this draft');
  await expect(page.getByTestId('chat-primary-button')).toHaveAccessibleName('Send task');
  await expect(page.getByTestId('chat-attach-button')).toHaveAccessibleName('Attach files');
  await goToTab(page, 'Projects');
  await goToTab(page, 'Chat');
  await expect(page.getByTestId('chat-model-picker')).toHaveCount(0);
});

test('model variants follow the server catalog, reach sessions, and persist per model', async ({ page, request }) => {
  await resetScenario(request, 'reasoning-variants');
  await openReadyChat(page);

  const model = page.getByTestId('chat-model-picker-trigger');
  await expect(model).toHaveAccessibleName('GPT-4.1 mini · OpenAI');
  await model.click();
  const picker = page.getByTestId('chat-model-picker');
  await expect(picker.getByRole('slider', { name: 'Reasoning', exact: true })).toHaveCount(0);
  await picker.getByTestId('chat-model-picker-search').fill('deepseek');
  await picker.getByRole('button', { name: /DeepSeek V4\.1 Flash Free/ }).click();
  await expect(model).toHaveAccessibleName('DeepSeek V4.1 Flash Free · OpenCode · Default');

  await model.click();
  const variant = page.getByRole('slider', { name: 'Reasoning', exact: true });
  await expect(variant).toHaveAttribute('aria-valuemax', '3');
  await expect(variant).toHaveAttribute('aria-valuetext', 'Default');
  await variant.focus();
  await variant.press('ArrowRight');
  await expect(variant).toHaveAttribute('aria-valuetext', 'Low');
  await variant.press('ArrowRight');
  await expect(variant).toHaveAttribute('aria-valuetext', 'High');
  await variant.press('ArrowRight');
  await expect(variant).toHaveAttribute('aria-valuetext', 'Max');
  await page.keyboard.press('Escape');
  await expect(model).toHaveAccessibleName('DeepSeek V4.1 Flash Free · OpenCode · Max');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.workspaces')).connections.find((entry) => entry.id === JSON.parse(localStorage.getItem('opencode-mobile.workspaces')).focus.connectionId).preferences.modelVariantSelections['opencode/deepseek-v4.1-flash-free'])).toBe('max');

  const maxSwitch = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/model'));
  await sendPrompt(page, 'Use the maximum reasoning variant');
  const maxResponse = await maxSwitch;
  expect(maxResponse.request().postDataJSON()).toEqual({ model: { id: 'deepseek-v4.1-flash-free', providerID: 'opencode', variant: 'max' } });
  const stateResponse = await request.get(`${backendOrigin()}/__control/state`);
  expect(stateResponse.ok()).toBeTruthy();
  expect((await stateResponse.json()).sessions[0].model).toEqual({ id: 'deepseek-v4.1-flash-free', providerID: 'opencode', variant: 'max' });

  await page.reload();
  await expect(page.getByTestId('chat-prompt-input')).toBeVisible();
  await expect(model).toHaveAccessibleName('DeepSeek V4.1 Flash Free · OpenCode · Max');

  await model.click();
  const resetVariant = page.getByRole('slider', { name: 'Reasoning', exact: true });
  await resetVariant.focus();
  await resetVariant.press('Home');
  await expect(resetVariant).toHaveAttribute('aria-valuetext', 'Default');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.workspaces')).connections.find((entry) => entry.id === JSON.parse(localStorage.getItem('opencode-mobile.workspaces')).focus.connectionId).preferences.modelVariantSelections['opencode/deepseek-v4.1-flash-free'])).toBe(null);
  const defaultSwitch = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/model'));
  await sendPrompt(page, 'Use the default reasoning variant');
  const defaultResponse = await defaultSwitch;
  expect(defaultResponse.request().postDataJSON()).toEqual({ model: { id: 'deepseek-v4.1-flash-free', providerID: 'opencode' } });
  expect((await (await request.get(`${backendOrigin()}/__control/state`)).json()).sessions[0].model).toEqual({ id: 'deepseek-v4.1-flash-free', providerID: 'opencode' });
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

test('completed progress stays compact and activity patches keep their turn after a later response', async ({ page, request }) => {
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
    await page.getByTestId(/transcript-activity-/).last().click();
    await page.getByRole('button', { name: /1 file changed/ }).last().click();
    await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible();
    await expect(page.getByText('src/feature.ts', { exact: true })).toHaveCount(0);
  } finally { server.kill('SIGTERM'); }
});

test('Messages only keeps a live activity row while the server is working', async ({ page, request }) => {
  await resetScenario(request, 'inbox');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('opencode-mobile.chat-preferences', JSON.stringify({ timelineDetail: 'messages' }));
  });
  await openReadyChat(page);
  await sendPrompt(page, 'Keep working without activity rows');

  const liveActivity = page.getByTestId('transcript-activity-session-status');
  await expect(liveActivity).toBeVisible({ timeout: 15_000 });
  await expect(liveActivity).toContainText('OpenCode is working…');
  await expect(page.locator('[data-testid^="transcript-activity-"]:not([data-testid="transcript-activity-session-status"])')).toHaveCount(0);

  await page.getByTestId('chat-primary-button').click();
  await expect(liveActivity).toBeHidden({ timeout: 15_000 });
});

test('timeline detail hides activity and restores it from the settings slider', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await page.setViewportSize({ width: 390, height: 844 });
  await openReadyChat(page);
  await sendPrompt(page, 'Review the timeline detail');
  await expect(page.getByText(/Finished: Review the timeline detail/).first()).toBeVisible({ timeout: 20_000 });
  const activity = page.getByTestId(/transcript-activity-/);
  await expect(activity).toHaveCount(1);

  await goToTab(page, 'Settings');
  await page.getByTestId('settings-category-responses').click();
  const slider = page.getByTestId('settings-timeline-detail');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Everything');
  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Messages only');
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences')))).toMatchObject({ timelineDetail: 'messages' });

  await goToTab(page, 'Chat');
  await expect(page.getByText(/Finished: Review the timeline detail/).first()).toBeVisible();
  await expect(activity).toHaveCount(0);

  await goToTab(page, 'Settings');
  await page.getByTestId('settings-category-responses').click();
  await expect(slider).toHaveAttribute('aria-valuetext', 'Messages only');
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Everything');
  await goToTab(page, 'Chat');
  await expect(activity).toHaveCount(1);
});

test('commands execute through the primary chat action', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, '/review src');
  await expect(page.getByText('Command /review src completed.', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

test('V2 composer suggestions insert commands, context, and shell commands', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  const input = page.getByTestId('chat-prompt-input');
  const primary = page.getByTestId('chat-primary-button');

  await input.fill('/rev');
  await expect(page.getByTestId('composer-suggestion-command-review')).toContainText('Review code');
  await page.getByTestId('composer-suggestion-command-review').click();
  await expect(input).toHaveValue('/review ');

  await input.fill('Review @gen');
  await expect(page.getByTestId('composer-suggestion-agent-general')).toContainText('Delegate a focused task.');
  await expect(page.getByTestId('composer-suggestion-skill-opencode')).toHaveCount(0);
  await page.getByTestId('composer-suggestion-agent-general').click();
  await expect(input).toHaveValue('Review @general ');

  await input.fill('Review @open');
  await expect(page.getByTestId('composer-suggestion-skill-opencode')).toContainText('Use this skill for any question about OpenCode.');
  await page.getByTestId('composer-suggestion-skill-opencode').click();
  await expect(input).toHaveValue('Review @opencode ');

  await input.fill('Review @src/de');
  await expect(page.getByTestId('composer-suggestion-file-src-demo.ts')).toBeVisible();
  await page.getByTestId('composer-suggestion-file-src-demo.ts').click();
  await expect(input).toHaveValue('Review @src/demo.ts ');
  await primary.click();
  await expect(page.getByText(/Finished: Review @src\/demo\.ts.*Context: @src\/demo\.ts/).first()).toBeVisible({ timeout: 20_000 });

  await input.fill('!echo composer-shell');
  await expect(page.getByTestId('chat-shell-banner')).toBeVisible();
  await expect(primary).toHaveAccessibleName('Run shell command');
  await primary.click();
  const activity = page.getByTestId(/transcript-activity-/).filter({ hasText: 'Shell' }).first();
  await expect(activity).toContainText('Shell', { timeout: 20_000 });
  await activity.click();
  const shellRow = page.getByTestId(/transcript-activity-item-/).filter({ hasText: 'echo composer-shell' }).last();
  await expect(shellRow).toBeVisible();
  await shellRow.click();
  await expect(page.getByText(/\$ echo composer-shell/)).toBeVisible();
  await expect(page.getByText(/ran: echo composer-shell/)).toBeVisible();
});
