import { expect, test } from '@playwright/test';

import { backendOrigin, chatAction, connectToServer, expectConnectedTo, getFreePort, goToTab, openChatLibrary, openReadyChat, reconnectActiveConnection, resetScenario, seedOnboarding, sendPrompt, spawnV1Server, spawnV2Server, waitForServer } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

test('Chat and Project use the same project picker', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Projects');
  const projectDropdown = page.getByRole('button', { name: 'Change project' });
  await expect(projectDropdown).toContainText('demo-project');
  await expect(projectDropdown).toContainText('/workspace/demo-project');
  await expect(page.getByTestId('project-refresh-button')).toBeVisible();
  await projectDropdown.click();
  await expect(page.getByTestId('project-picker')).toBeVisible();
  // A server project that was never opened on this connection is not listed.
  await expect(page.getByTestId('project-picker').getByRole('button', { name: 'Select secondary-project' })).toHaveCount(0);
  await page.getByTestId('project-add-button').click();
  await page.getByTestId('project-add-path').fill('/workspace/secondary-project');
  await page.getByTestId('project-add-submit').click();
  await expect(page.getByText('secondary-project', { exact: true }).first()).toBeVisible();
  await projectDropdown.click();
  await expect(page.getByRole('button', { name: 'Select secondary-project' })).toBeVisible();
  await page.getByRole('button', { name: 'Select secondary-project' }).click();
  await expect(page.getByText('secondary-project', { exact: true }).first()).toBeVisible();

  await goToTab(page, 'Chat');
  await openChatLibrary(page);
  await page.getByRole('button', { name: 'Change project' }).click();
  await expect(page.getByTestId('chat-project-picker')).toBeVisible();
  await page.getByTestId('chat-project-picker').getByRole('button', { name: 'Select demo-project' }).click();
  await goToTab(page, 'Projects');
  await expect(page.getByText('demo-project', { exact: true }).first()).toBeVisible();

  await projectDropdown.click();
  await page.getByTestId('project-add-button').click();
  await page.getByTestId('project-add-path').fill('/outside/new-project');
  await page.getByTestId('project-add-submit').click();
  await expect(page.getByText('OpenCode could not open that directory. Check the server path.')).toBeVisible();
  await page.getByTestId('project-add-path').fill('/workspace/new-project');
  await page.getByTestId('project-add-submit').click();
  await expect(projectDropdown).toContainText('new-project');
  await projectDropdown.click();
  await expect(page.getByRole('button', { name: 'Select new-project' })).toBeVisible();
});

test('project file search opens deterministic file content', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await goToTab(page, 'Projects');
  await page.getByTestId('project-file-search').fill('demo');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('src/demo.ts', { exact: true }).last()).toBeVisible();
  await page.getByText('src/demo.ts', { exact: true }).last().click();
  await expect(page.getByText(/OpenCode 1\.18\.3/)).toBeVisible();
});

test('project files save through a conflict-checked VCS patch', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Projects');
  await page.getByTestId('project-file-search').fill('demo');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText('src/demo.ts', { exact: true }).last().click();
  await page.getByText('Edit', { exact: true }).click();
  await page.getByTestId('project-file-editor').fill('export const demo = "OpenCode SDK 1.18.3";\n');
  await page.getByTestId('project-file-save-button').click();
  await expect(page.getByText(/OpenCode SDK 1\.18\.3/)).toBeVisible();
});

test('worktrees and MCP servers can be created', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Projects');
  await page.getByRole('button', { name: 'Change project' }).click();
  await page.getByTestId('project-worktree-add').click();
  await page.getByTestId('project-worktree-name').fill('mobile-test');
  await page.getByTestId('project-worktree-create').click();
  await expect(page.getByText('mobile-test', { exact: true })).toBeVisible();
  await page.getByTestId('project-picker').getByRole('button', { name: 'Close', exact: true }).click();

  await goToTab(page, 'Settings');
  await page.getByText('Advanced', { exact: true }).click();
  await page.getByText('Remote', { exact: true }).click();
  await page.getByTestId('settings-mcp-name').fill('web-tools');
  await page.getByTestId('settings-mcp-target').fill('https://example.test/mcp');
  await page.getByTestId('settings-mcp-add').click();
  await expect(page.getByText('web-tools', { exact: true })).toBeVisible();
});

test('OpenCode 2 adds a server project from the shared picker', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = await getFreePort();
  const server = spawnV2Server(port);
  try {
    await waitForServer(request, `http://127.0.0.1:${port}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, `http://127.0.0.1:${port}`);
    await openChatLibrary(page);
    await page.getByRole('button', { name: 'Change project' }).click();
    await page.getByTestId('project-add-button').click();
    await page.getByTestId('project-add-path').fill('/workspace/v2-new-project');
    await page.getByTestId('project-add-submit').click();
    await expect(page.getByRole('button', { name: /^Open chats/ })).toContainText('v2-new-project');
    const serverProjects = await (await request.get(`http://127.0.0.1:${port}/api/project`)).json();
    expect(serverProjects.some((project) => project.canonical === '/workspace/v2-new-project')).toBe(true);
    const [promptResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().startsWith(`http://127.0.0.1:${port}/api/session/`) && response.url().endsWith('/prompt') && response.request().method() === 'POST'),
      sendPrompt(page, 'Retained project chat'),
    ]);
    expect(promptResponse.status()).toBe(200);
    const { data: { sessionID: retainedSessionId } } = await promptResponse.json();
    const { data: promptedSession } = await (await request.get(`http://127.0.0.1:${port}/api/session/${retainedSessionId}`)).json();
    expect(promptedSession.location.directory).toBe('/workspace/v2-new-project');
    await expect(page.getByPlaceholder('Ask anything...')).toHaveValue('');
    await expect(page.getByText(/Finished: Retained project chat/).first()).toBeVisible({ timeout: 30_000 });
    await goToTab(page, 'Projects');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/project') && response.request().method() === 'GET'),
      page.getByTestId('project-refresh-button').click(),
    ]);
    await expect(page.getByRole('button', { name: 'Change project' })).toContainText('/workspace/v2-new-project');
    await expect.poll(() => page.evaluate(() => globalThis.localStorage.getItem('opencode-mobile.active-project'))).toBe('/workspace/v2-new-project');
    await goToTab(page, 'Chat');
    await openChatLibrary(page);
    await chatAction(page, 'Retained project chat', 'Favorite');
    await page.getByTestId(`chat-library-favorite-${retainedSessionId}`).click();
    await expect(page.getByTestId('chat-library')).not.toBeVisible();
    await expect(page.getByText(/Finished: Retained project chat/).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.localStorage.getItem('opencode-mobile.favorite-sessions'))).toContain(retainedSessionId);
    await goToTab(page, 'Projects');
    await expect(page.getByRole('button', { name: 'Change project' })).toContainText('/workspace/v2-new-project');
    await page.getByRole('button', { name: 'Change project' }).click();
    await expect(page.getByRole('button', { name: 'Select v2-new-project' })).toBeVisible();
    await page.getByTestId('project-picker').getByRole('button', { name: 'Close', exact: true }).click();
    await goToTab(page, 'Settings');
    await reconnectActiveConnection(page);
    await expectConnectedTo(page, String(port));
    await page.reload();
    await goToTab(page, 'Projects');
    await expect(page.getByRole('button', { name: 'Change project' })).toContainText('/workspace/v2-new-project');
    await page.getByRole('button', { name: 'Change project' }).click();
    await expect(page.getByRole('button', { name: 'Select v2-new-project' })).toBeVisible();
    await page.getByTestId('project-picker').getByRole('button', { name: 'Close', exact: true }).click();
    await goToTab(page, 'Chat');
    await openChatLibrary(page);
    await page.getByTestId(`chat-library-favorite-${retainedSessionId}`).click();
    await expect(page.getByTestId('chat-library')).not.toBeVisible();
    await expect(page.getByText(/Finished: Retained project chat/).first()).toBeVisible();
  } finally {
    server.kill('SIGTERM');
  }
});

test('OpenCode 2 lists every project chat across session pages', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const port = await getFreePort();
  const server = spawnV2Server(port);
  const origin = `http://127.0.0.1:${port}`;
  const projectPath = '/workspace/demo-project';
  try {
    await waitForServer(request, `${origin}/api/info`);
    // A page smaller than the project's chat count: only a client that follows
    // the session-list cursor can show every chat.
    expect((await request.post(`${origin}/__control/session-page`, { data: { size: 2 } })).ok()).toBeTruthy();
    for (const title of ['First page chat', 'Second page chat', 'Third page chat']) {
      const created = await request.post(`${origin}/api/session`, { data: { title, location: { directory: projectPath } } });
      expect(created.ok()).toBeTruthy();
    }
    await openReadyChat(page);
    await connectToServer(page, origin);
    await openChatLibrary(page);
    for (const title of ['First page chat', 'Second page chat', 'Third page chat']) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    }
  } finally {
    server.kill('SIGTERM');
  }
});

for (const contract of ['v1', 'v2']) {
  test(`${contract} project browses scoped folders and switches worktrees across tabs`, async ({ page, request }) => {
    const port = await getFreePort();
    const server = contract === 'v1' ? spawnV1Server(port) : spawnV2Server(port);
    try {
      await resetScenario(request, 'happy-path');
      await waitForServer(request, `http://127.0.0.1:${port}/${contract === 'v1' ? 'path' : 'api/info'}`);
      await openReadyChat(page);
      await connectToServer(page, `http://127.0.0.1:${port}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await goToTab(page, 'Projects');
      await expect(page.getByTestId('project-entry-src')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Worktrees' })).toHaveCount(0);
      await page.screenshot({ path: `/tmp/opencode-project-${contract}.png` });
      await page.getByTestId('project-entry-src').click();
      await expect(page.getByTestId('project-entry-src/demo.ts')).toBeVisible();
      await goToTab(page, 'Chat');
      await goToTab(page, 'Projects');
      await expect(page.getByTestId('project-entry-src/demo.ts')).toBeVisible();
      await page.getByTestId('project-file-search').fill('README');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByTestId('project-entry-README.md').click();
      await expect(page.getByText(/# Demo project/)).toBeVisible();
      await page.getByLabel('Close file').click();
      await expect(page.getByText('Results for “README”')).toBeVisible();
      await page.getByRole('button', { name: 'Clear search' }).click();
      await expect(page.getByTestId('project-entry-src/demo.ts')).toBeVisible();
      await page.getByRole('button', { name: 'demo-project', exact: true }).click();
      await page.getByTestId('project-entry-assets').click();
      await page.getByTestId('project-entry-assets/binary.dat').click();
      await expect(page.getByText('Binary files cannot be previewed as text.')).toBeVisible();
      await page.getByRole('button', { name: 'Change project' }).click();
      const picker = page.getByTestId('project-picker');
      // The connection starts with the server's current project only; open the
      // secondary project before switching to it.
      await expect(picker.getByRole('button', { name: 'Select secondary-project' })).toHaveCount(0);
      await picker.getByTestId('project-add-button').click();
      await picker.getByTestId('project-add-path').fill('/workspace/secondary-project');
      await picker.getByTestId('project-add-submit').click();
      await page.getByTestId('project-entry-src').click();
      await page.getByTestId('project-entry-src/demo.ts').click();
      await expect(page.getByText(/export const workspace = "\/workspace\/secondary-project"/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(1);
      await page.getByLabel('Close file').click();
      await page.getByRole('button', { name: 'Change project' }).click();
      await page.getByTestId('project-worktree-add').click();
      await expect(page.getByTestId('project-worktree-command')).toHaveCount(contract === 'v1' ? 1 : 0);
      await page.getByTestId('project-worktree-name').fill('scoped-task');
      await page.getByTestId('project-worktree-create').click();
      await expect(picker.getByRole('button', { name: 'Select scoped-task' })).toBeVisible();
      await page.screenshot({ path: `/tmp/opencode-project-picker-${contract}.png` });
      await picker.getByRole('button', { name: 'Select scoped-task' }).click();
      await expect(page.getByRole('button', { name: 'Change project' })).toContainText('/worktrees/scoped-task');
      await page.getByTestId('project-entry-README.md').click();
      await expect(page.getByText('# Worktree scoped-task', { exact: false })).toBeVisible();
      await page.getByLabel('Close file').click();
      await goToTab(page, 'Chat');
      await sendPrompt(page, 'Work in the selected worktree');
      await expect(page.getByText(/Finished: Work in the selected worktree/).first()).toBeVisible({ timeout: 20_000 });
      await goToTab(page, 'Terminal');
      await page.getByTestId('terminal-create-button').click();
      await expect(page.getByTestId('terminal-output')).toBeVisible();
      await goToTab(page, 'Projects');
      await page.reload();
      await expect(page.getByRole('button', { name: 'Change project' })).toContainText('/worktrees/scoped-task');
      await page.getByRole('button', { name: 'Change project' }).click();
      await expect(picker.getByText('Worktrees · secondary-project')).toBeVisible();
      await expect(picker.getByRole('button', { name: 'Manage scoped-task' })).toBeDisabled();
      await picker.getByRole('button', { name: 'Select secondary-project' }).click();
      await page.getByRole('button', { name: 'Change project' }).click();
      await picker.getByRole('button', { name: 'Manage scoped-task' }).click();
      await expect(picker.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(contract === 'v1' ? 1 : 0);
      page.once('dialog', (dialog) => dialog.accept());
      await picker.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(picker.getByRole('button', { name: 'Manage scoped-task' })).toHaveCount(0);
      // The server worktree is gone; closing the project row removes the local
      // entry without touching the server.
      await picker.getByTestId('project-remove-/worktrees/scoped-task').click();
      await expect(picker.getByRole('button', { name: 'Select scoped-task' })).toHaveCount(0);
    } finally { server.kill('SIGTERM'); }
  });
}

test('project editor confirms discarded edits and keeps conflict failures recoverable', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await goToTab(page, 'Projects');
  await page.getByTestId('project-entry-src').click();
  await page.getByTestId('project-entry-src/demo.ts').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByTestId('project-file-editor').fill('unsaved draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByLabel('Close file').click();
  await expect(page.getByTestId('project-file-editor')).toHaveValue('unsaved draft');
  await page.route('**/api/fs/read/**', (route) => route.fulfill({ contentType: 'text/plain', body: 'changed on server' }));
  await page.getByTestId('project-file-save-button').click();
  await expect(page.getByText('The file changed on the server. Reopen it before saving.')).toBeVisible();
  await expect(page.getByTestId('project-file-editor')).toHaveValue('unsaved draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Close file').click();
  await expect(page.getByTestId('project-entry-src/demo.ts')).toBeVisible();
});

test('v2 file saves reject conflicts and retain drafts on write failure', async ({ page, request }) => {
  await resetScenario(request, 'happy-path'); await openReadyChat(page);
  await goToTab(page, 'Projects');
  await page.getByTestId('project-file-search').fill('demo');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText('src/demo.ts', { exact: true }).last().click();
  await page.getByText('Edit', { exact: true }).click();
  const draft = 'export const demo = "V2 😀";\n';
  await page.getByTestId('project-file-editor').fill(draft);
  let writes = 0;
  await page.route('**/api/experimental/fs/write?*', async (route) => {
    writes++; await route.fulfill({ status: 503, json: { error: 'Write offline' } });
  });
  await page.getByTestId('project-file-save-button').click();
  await expect(page.getByText(/Write offline/)).toBeVisible();
  await expect(page.getByTestId('project-file-editor')).toHaveValue(draft);
  expect(writes).toBe(1);
  await page.unroute('**/api/experimental/fs/write?*');
  await page.route('**/api/fs/read/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'External edit' }));
  await page.getByTestId('project-file-save-button').click();
  await expect(page.getByText(/changed on the server/)).toBeVisible();
  await expect(page.getByTestId('project-file-editor')).toHaveValue(draft);
  expect(writes).toBe(1);
  await page.unroute('**/api/fs/read/**');
  await page.getByTestId('project-file-save-button').click();
  await expect(page.getByTestId('project-file-editor')).not.toBeVisible();
  const result = await request.get(`${backendOrigin()}/api/fs/read/src/demo.ts?location[directory]=/workspace/demo-project`);
  expect(await result.text()).toBe(draft);
});
