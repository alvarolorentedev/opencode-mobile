import { expect, test } from '@playwright/test';
import { getFreePort, spawnV2Server, waitForServer, goToTab, openChatLibrary, ensureConnectionSection, sendPrompt, addConnection } from './helpers/flows.mjs';

const directory = '/workspace/demo-project';
let servers;
test.beforeEach(async ({ page, request }, info) => {
  const names = info.title.includes('single-server') ? ['MacBook Pro'] : ['MacBook Pro', 'Build server'];
  servers = await Promise.all(names.map(async (name) => {
    const port = await getFreePort();
    const process = spawnV2Server(port, info.title.includes('colliding approvals') ? 'permission' : 'happy-path');
    const serverUrl = `http://127.0.0.1:${port}`;
    await waitForServer(request, `${serverUrl}/api/info`);
    const response = await request.post(`${serverUrl}/api/session`, { data: { title: `Chat on ${name}`, location: { directory } } });
    const { data: session } = await response.json();
    return { name, process, serverUrl, session };
  }));
  if (servers.length > 1) expect(servers[0].session.id).toBe(servers[1].session.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ servers, directory }) => {
    if (localStorage.getItem('opencode-mobile.workspaces')) return;
    const connections = servers.map(({ name, serverUrl }) => ({
      id: btoa(`${serverUrl}\n`).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''),
      name, settings: { serverUrl, username: '', directory: '' }, enabled: true, preferences: { autoApprove: false }, projects: [directory],
    }));
    localStorage.setItem('opencode-mobile.onboarding-version', JSON.stringify({ version: 1 }));
    localStorage.setItem('opencode-mobile.connection-profiles', JSON.stringify(servers.map(({ name, serverUrl }, index) => ({ id: `server-${index}`, name, serverUrl, username: '' }))));
    localStorage.setItem('opencode-mobile.workspaces', JSON.stringify({ version: 1, connections, focus: { connectionId: connections[0].id, projectPath: directory } }));
  }, { servers: servers.map(({ name, serverUrl }) => ({ name, serverUrl })), directory });
  await page.goto('/');
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible({ timeout: 30000 });
});
test.afterEach(() => { for (const server of servers ?? []) server.process.kill('SIGTERM'); });

async function openChat(page, name) {
  await goToTab(page, 'Chat');
  await openChatLibrary(page);
  await page.getByRole('button', { name: `Open Chat on ${name}, ${name}, ${directory}`, exact: true }).click();
  await expect(page.getByTestId('chat-library')).not.toBeVisible();
}
async function choose(page, trigger, name) {
  await page.getByTestId(trigger).click();
  await page.getByRole('button', { name, exact: true }).last().click();
}

test('V2 mixes colliding chats, filters without navigation, and retains each draft @smoke', async ({ page }) => {
  await openChat(page, 'MacBook Pro');
  await page.getByPlaceholder('Ask anything...').fill('Draft on A');
  await openChatLibrary(page);
  const library = page.getByTestId('chat-library');
  await expect(library.getByText('MacBook Pro', { exact: true })).toBeVisible();
  await expect(library.getByText('Build server', { exact: true })).toBeVisible();
  await expect(library.getByRole('switch')).toHaveCount(1);
  await expect(library.getByRole('switch')).toBeChecked();
  await expect(library.getByText('Archived', { exact: true })).toHaveCount(0);
  await choose(page, 'chat-server-filter', 'Build server');
  await expect(library.getByRole('button', { name: /^Open Chat on MacBook/ })).toHaveCount(0);
  await expect(library.getByText('MacBook Pro / demo-project', { exact: true })).toBeVisible();
  await choose(page, 'chat-server-filter', 'All servers');
  await library.getByRole('button', { name: /^Open Chat on Build server,/ }).click();
  await expect(library).not.toBeVisible();
  await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('');
  await page.getByPlaceholder('Ask anything...').fill('Draft on B');
  await openChat(page, 'MacBook Pro');
  await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('Draft on A');
  await openChat(page, 'Build server');
  await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('Draft on B');
  await page.reload();
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible({ timeout: 30000 });
  await openChatLibrary(page);
  await expect(library.getByRole('button', { name: /^Open Chat on MacBook/ })).toBeVisible();
  await expect(library.getByRole('button', { name: /^Open Chat on Build server/ })).toBeVisible();
});

test('V2 creates a chat on the selected server and project from the New chat sheet', async ({ page, request }) => {
  const sessions = async (index) => (await (await request.get(`${servers[index].serverUrl}/api/session?directory=${encodeURIComponent(directory)}`)).json()).data;
  const beforeA = await sessions(0);
  const beforeB = await sessions(1);
  await page.locator('#root').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByTestId('new-chat-sheet')).toBeVisible();
  await choose(page, 'new-chat-server-picker', 'Build server');
  await expect(page.getByTestId('new-chat-confirm')).toBeDisabled();
  await choose(page, 'new-chat-project-picker', /^demo-project/);
  await page.getByTestId('new-chat-confirm').click();
  await expect(page.getByTestId('new-chat-sheet')).not.toBeVisible();
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 15_000 });
  await sendPrompt(page, 'Created on Build server from New chat');
  await expect(page.getByText(/Finished: Created on Build server from New chat/).first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await sessions(1)).length).toBe(beforeB.length + 1);
  expect((await sessions(0)).length).toBe(beforeA.length);
  const created = (await sessions(1)).find((session) => !beforeB.some((existing) => existing.id === session.id));
  expect(created).toBeTruthy();
  const history = await (await request.get(`${servers[1].serverUrl}/api/session/${created.id}/message`)).json();
  expect(history.data.some((entry) => (entry.content ?? []).some((part) => part.type === 'text' && part.text.startsWith('Finished: Created on Build server from New chat')))).toBe(true);
  await openChatLibrary(page);
  await page.getByTestId('chat-library').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByTestId('new-chat-sheet')).toBeVisible();
  await expect(page.getByTestId('chat-library')).not.toBeVisible();
  await page.getByTestId('new-chat-sheet').getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('V2 creates a PTY on B while chat stays on A and retains its renderer', async ({ page, request }) => {
  await goToTab(page, 'Terminal');
  await page.getByTestId('terminal-create-button').click();
  await choose(page, 'terminal-server-picker', 'Build server');
  await expect(page.getByTestId('terminal-create-confirm')).toBeDisabled();
  await choose(page, 'terminal-project-picker', new RegExp('^demo-project'));
  await expect(page.getByText('Your chat stays on MacBook Pro / demo-project.')).toBeVisible();
  await page.getByTestId('terminal-create-confirm').click();
  await expect(page.getByTestId('terminal-selector')).toContainText('Build server');
  await expect(page.getByTestId('terminal-selector')).toContainText('Connected');
  const output = page.getByTestId('terminal-output');
  const input = page.getByRole('textbox', { name: 'Terminal input', exact: true });
  await output.click();
  await input.pressSequentially('echo owned-by-B'); await input.press('Enter');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo owned-by-B');
  const records = async (index) => (await (await request.get(`${servers[index].serverUrl}/__control/terminal`)).json()).data;
  expect(await records(0)).toHaveLength(0);
  expect((await records(1))[0].input.join('')).toContain('echo owned-by-B');
  await goToTab(page, 'Chat');
  await expect(page.getByRole('button', { name: /^Open chats/ })).toContainText('Chat on MacBook Pro');
  await openChat(page, 'Build server'); await openChat(page, 'MacBook Pro');
  await goToTab(page, 'Terminal');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo owned-by-B');
  expect((await records(1))[0].connections).toBe(1);
  await goToTab(page, 'Chat');
  await openChat(page, 'Build server');
  await page.getByPlaceholder('Ask anything...').fill('Retain B while disconnected');
  await goToTab(page, 'Settings');
  await ensureConnectionSection(page);
  await page.getByTestId('connection-row-server-1').click();
  await page.getByTestId('connection-disconnect-server-1').click();
  await expect(page.getByTestId('connection-connect-server-1')).toBeVisible();
  await openChat(page, 'MacBook Pro');
  await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('');
  await goToTab(page, 'Settings');
  await ensureConnectionSection(page);
  await page.getByTestId('connection-row-server-1').click();
  await page.getByTestId('connection-connect-server-1').click();
  await goToTab(page, 'Chat');
  await expect(page.getByRole('button', { name: /^Open chats/ })).toContainText('Chat on Build server');
  await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('Retain B while disconnected');
  await goToTab(page, 'Terminal');
  await expect(output.locator('.xterm-accessibility-tree')).toContainText('ran: echo owned-by-B');
});

test('V2 settings inspection and auto-approve are independent of chat', async ({ page }) => {
  await goToTab(page, 'Settings');
  await choose(page, 'settings-server-picker', 'Build server');
  await page.getByRole('button', { name: /^Approvals/ }).click();
  const overlay = page.getByTestId('settings-section-overlay');
  await expect(overlay.getByText('Changes apply to Build server')).toBeVisible();
  await overlay.getByRole('switch', { name: 'Auto-approve', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-mobile.workspaces')).connections.map((entry) => entry.preferences.autoApprove))).toEqual([false, true]);
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await goToTab(page, 'Chat');
  await expect(page.getByRole('button', { name: /^Open chats/ })).toContainText('Chat on MacBook Pro');
  await goToTab(page, 'Settings');
  await expect(page.getByTestId('settings-server-picker')).toContainText('Build server');
});


test('V2 replies to colliding approvals only on the Settings server', async ({ page, request }) => {
  const state = async (index) => (await request.get(`${servers[index].serverUrl}/__control/state`)).json();
  await openChat(page, 'MacBook Pro');
  await sendPrompt(page, 'A waits for approval');
  await expect.poll(async () => (await state(0)).pendingPermissions.length).toBe(1);
  await openChat(page, 'Build server');
  await sendPrompt(page, 'B waits for approval');
  await expect.poll(async () => (await state(1)).pendingPermissions.length).toBe(1);
  expect((await state(0)).pendingPermissions[0].id).toBe((await state(1)).pendingPermissions[0].id);
  await goToTab(page, 'Settings');
  await choose(page, 'settings-server-picker', 'Build server');
  await page.getByRole('button', { name: /^Approvals/ }).click();
  const overlay = page.getByTestId('settings-section-overlay');
  await expect(overlay.getByText('Requested by Chat on Build server')).toBeVisible();
  await overlay.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect.poll(async () => (await state(1)).pendingPermissions.length).toBe(0);
  expect((await state(0)).pendingPermissions).toHaveLength(1);
  await goToTab(page, 'Chat');
  await expect(page.getByText(/Finished: permission resolved/).first()).toBeVisible();
  await openChat(page, 'MacBook Pro');
  await expect(page.getByText('Approval needed', { exact: true }).last()).toBeVisible();
});


test('V2 terminal picker is one list with server chips and colliding PTY IDs stay separate', async ({ page, request }) => {
  await request.post(`${servers[0].serverUrl}/api/pty`, { data: { location: { directory }, cwd: directory } });
  await goToTab(page, 'Terminal');
  await page.getByTestId('terminal-create-button').click();
  await choose(page, 'terminal-server-picker', 'Build server');
  await choose(page, 'terminal-project-picker', /^demo-project/);
  await page.getByTestId('terminal-create-confirm').click();
  await page.getByTestId('terminal-selector').click();
  const picker = page.getByTestId('terminal-picker');
  await expect(picker.getByTestId('terminal-server-chip')).toHaveText(['MacBook Pro', 'Build server']);
  await page.getByTestId('terminal-picker-sheet').screenshot({ path: test.info().outputPath('terminal-list.png') });
  await expect(picker.getByRole('button', { name: /^Open Terminal,/ })).toHaveCount(2);
  await expect(picker.getByText('MacBook Pro / demo-project', { exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: /^Open Terminal,.*MacBook Pro/ }).click();
  await expect(page.getByTestId('terminal-selector')).toContainText('MacBook Pro');
  const output = page.getByTestId('terminal-output');
  await output.click();
  const input = page.getByRole('textbox', { name: 'Terminal input', exact: true });
  await input.pressSequentially('echo A-only'); await input.press('Enter');
  const records = async (index) => (await (await request.get(`${servers[index].serverUrl}/__control/terminal`)).json()).data;
  await expect.poll(async () => (await records(0))[0].input.join('')).toContain('echo A-only');
  expect((await records(1))[0].input.join('')).not.toContain('echo A-only');
});

test('V2 single-server mode hides redundant context and restores it when a second server is added', async ({ page, request }) => {
  await page.locator('#root').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByTestId('new-chat-sheet')).toBeVisible();
  await expect(page.getByTestId('new-chat-server-picker')).toHaveCount(0);
  await expect(page.getByTestId('new-chat-project-picker')).toBeVisible();
  await page.getByTestId('new-chat-sheet').getByRole('button', { name: 'Cancel', exact: true }).click();
  await openChatLibrary(page);
  const library = page.getByTestId('chat-library');
  await expect(library.getByTestId('chat-server-filter')).toHaveCount(0);
  await expect(library.getByText('MacBook Pro', { exact: true })).toHaveCount(0);
  await expect(library.getByTestId('chat-project-filter')).toBeVisible();
  await library.getByRole('button', { name: 'Change project', exact: true }).click();
  const projects = page.getByTestId('chat-project-picker');
  await expect(projects.getByRole('button', { name: /^All servers:/ })).toHaveCount(0);
  await expect(projects.getByText('MacBook Pro', { exact: true })).toHaveCount(0);
  await projects.getByTestId('project-add-button').click();
  await expect(projects.getByRole('button', { name: /^Server:/ })).toHaveCount(0);
  await projects.getByTestId('project-add-path').fill('/workspace/secondary-project');
  await projects.getByTestId('project-add-submit').click();
  await expect(projects).not.toBeVisible();
  await goToTab(page, 'Terminal');
  await page.getByTestId('terminal-create-button').click();
  await expect(page.getByTestId('terminal-server-picker')).toHaveCount(0);
  await expect(page.getByTestId('terminal-project-picker')).toBeVisible();
  await expect(page.getByTestId('terminal-create-confirm')).toBeEnabled();
  await page.getByTestId('new-terminal-sheet').getByRole('button', { name: 'Cancel', exact: true }).click();
  await goToTab(page, 'Settings');
  await expect(page.getByTestId('settings-server-picker')).toHaveCount(0);
  await expect(page.getByText('Server settings', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('single-server-settings.png') });
  await page.getByRole('button', { name: /^Advanced/ }).click();
  await expect(page.getByTestId('settings-project-picker')).toBeVisible();
  await expect(page.getByTestId('settings-server-picker')).toHaveCount(0);
  await goToTab(page, 'Settings');
  const port = await getFreePort();
  const process = spawnV2Server(port);
  const serverUrl = `http://127.0.0.1:${port}`;
  servers.push({ name: 'Second server', process, serverUrl });
  await waitForServer(request, `${serverUrl}/api/info`);
  await addConnection(page, { name: 'Second server', url: serverUrl });
  await goToTab(page, 'Settings');
  await expect(page.getByTestId('settings-server-picker')).toBeVisible();
  await goToTab(page, 'Chat');
  await openChatLibrary(page);
  await expect(library.getByTestId('chat-server-filter')).toBeVisible();
});

test('V2 keeps server chips visible for long chat titles', async ({ page, request }) => {
  const title = `Long-session-${'x'.repeat(96)}`;
  await request.post(`${servers[0].serverUrl}/api/session`, { data: { title, location: { directory } } });
  await openChatLibrary(page);
  const row = page.getByTestId('chat-library').getByRole('button', { name: `Open ${title}, MacBook Pro, ${directory}`, exact: true });
  const chip = row.getByTestId('chat-library-server-chip');
  await expect(row).toBeVisible();
  await expect(chip).toHaveText('MacBook Pro');
  await expect(chip).toBeVisible();
  const rowBox = await row.boundingBox();
  const chipBox = await chip.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(chipBox).not.toBeNull();
  expect(chipBox.x).toBeGreaterThanOrEqual(rowBox.x);
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
});

test('V2 opens a chat on another server without waiting for its session list', async ({ page, request }) => {
  const title = 'Slow switch target';
  await request.post(`${servers[1].serverUrl}/api/session`, { data: { title, location: { directory } } });
  await openChatLibrary(page);
  const row = page.getByTestId('chat-library').getByRole('button', { name: `Open ${title}, Build server, ${directory}`, exact: true });
  await expect(row).toBeVisible();

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(`${servers[1].serverUrl}/api/session**`, async (route) => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  });

  try {
    await row.click();
    await expect(page.getByTestId('chat-library')).not.toBeVisible({ timeout: 10_000 });
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: /^Open chats/ })).toContainText(title);
});
