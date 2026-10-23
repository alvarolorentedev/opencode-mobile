import { setTimeout as sleep } from 'node:timers/promises';

import { expect, test } from './helpers/fixtures.mjs';

import { addConnection, backendOrigin, chatAction, connectToSavedConnection, connectToServer, ensureAiSection, expectConnectedTo, fakeV2Origin, getFreePort, goToTab, openChatLibrary, openReadyChat, resetScenario, seedOnboarding, sendPrompt, spawnV1Server, waitForServer } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
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

test('sessions archive and restore without deletion @smoke', async ({ page, request }) => {
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
  const sessions = await (await request.get(`${backendOrigin()}/session`)).json();
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
  const history = await (await request.get(`${backendOrigin()}/session/${session.id}/message`)).json();
  expect(history.filter((entry) => entry.info.role === 'user')).toHaveLength(2);
});

test('archived cards restore sessions in their own project and keep errors retryable', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const directory = '/workspace/secondary-project';
  const session = await (await request.post(`${backendOrigin()}/session?directory=${encodeURIComponent(directory)}`, { data: { title: 'Archived elsewhere' } })).json();
  await request.patch(`${backendOrigin()}/session/${session.id}`, { data: { time: { archived: 100 } } });
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
  await sendPrompt(page, 'Continue restored project session');
  await expect(page.getByText(/Finished: Continue restored project session/).first()).toBeVisible({ timeout: 20_000 });
  const history = await (await request.get(`${backendOrigin()}/session/${session.id}/message`)).json();
  expect(history.some((entry) => entry.info.role === 'user')).toBeTruthy();
});

test('favorites open sessions in the current project', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Favorite current project session');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });

  await openChatLibrary(page);
  await chatAction(page, 'Favorite current project session', 'Favorite');
  await expect(page.getByRole('button', { name: /^Unfavorite / }).first()).toBeVisible();
  await page.getByTestId('chat-library').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('chat-library')).not.toBeVisible();
  await page.locator('#root').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByTestId('new-chat-sheet')).toBeVisible();
  await page.getByTestId('new-chat-confirm').click();
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 15_000 });
  await openChatLibrary(page);
  await page.getByTestId('chat-library').getByRole('button', { name: 'Open Favorite current project session' }).first().click();

  await expect(
    page.locator('text=/Finished: Favorite current project session/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('favorites switch projects and open cross-project sessions @smoke', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = backendOrigin();
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/api/session`, {
    data: { title: 'Favorite Cross Project Session', location: { directory: projectPath } },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: sessionId } = (await createResponse.json()).data;

  await request.post(`${fakeServer}/api/session/${sessionId}/prompt`, {
    data: { text: 'Open me through a favorite' },
  });
  await expect.poll(async () => {
    const response = await request.get(`${fakeServer}/api/session/${sessionId}/message`);
    return (await response.json()).data.some((entry) => (entry.content ?? []).some((part) => part.type === 'text' && part.text.startsWith('Finished: Open me through a favorite')));
  }, { timeout: 20_000 }).toBe(true);
  await openReadyChat(page);

  await page.goto(`/session/${sessionId}?project=${encodeURIComponent(projectPath)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(
    page.locator('text=/Finished: Open me through a favorite/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });

  await openChatLibrary(page);
  await chatAction(page, 'Favorite Cross Project Session', 'Favorite');
  await expect(page.getByRole('button', { name: /^Unfavorite / }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Change project' }).click();
  await page.getByTestId('chat-project-picker').getByRole('button', { name: 'Select demo-project' }).click();
  await openChatLibrary(page);
  await expect(page.getByTestId('chat-library').getByText('demo-project', { exact: true }).last()).toBeVisible();
  await page.getByTestId('chat-library').getByRole('button', { name: /^Open Favorite Cross Project Session,/ }).click();
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
  await expect(page.getByRole('button', { name: /^Unfavorite / }).first()).toBeVisible();

  const deleteResponse = await request.delete(`${backendOrigin()}/api/session/session-1`);
  expect(deleteResponse.ok()).toBeTruthy();

  await page.getByTestId('chat-library').getByRole('button', { name: 'Open Favorite vanishing session' }).first().click();
  await expect(
    page.getByText(/could not open|not found|failed/i).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test('rapid favorite taps across projects settle on the last target', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = backendOrigin();
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/api/session`, {
    data: { title: 'Rapid Tap Secondary', location: { directory: projectPath } },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: secondarySessionId } = (await createResponse.json()).data;

  await request.post(`${fakeServer}/api/session/${secondarySessionId}/prompt`, {
    data: { text: 'Secondary rapid tap target' },
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

  await page.getByRole('button', { name: 'Change project' }).click();
  await page.getByTestId('chat-project-picker').getByRole('button', { name: 'Select demo-project' }).click();
  await openChatLibrary(page);
  await chatAction(page, 'Primary rapid tap target', 'Favorite');
  await expect(page.getByRole('button', { name: /^Unfavorite / }).first()).toBeVisible();

  // Dispatch both presses back to back so the second lands before the first
  // navigation closes the library.
  await page.getByTestId('chat-library').getByRole('button', { name: /^Open (Rapid Tap Secondary|Primary rapid tap target)/ }).evaluateAll((nodes) => {
    const secondary = nodes.find((node) => node.getAttribute('aria-label').startsWith('Open Rapid Tap Secondary'));
    const primary = nodes.find((node) => node.getAttribute('aria-label').startsWith('Open Primary rapid tap target'));
    if (!secondary || !primary) throw new Error('Both captured chat targets must be present.');
    secondary.click(); primary.click();
  });

  await expect(
    page.locator('text=/Finished: Primary rapid tap target/ >> visible=true').first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('chat library lists recently used sessions from other projects and switches on tap', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = backendOrigin();
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/api/session`, {
    data: { title: 'Recent Secondary Session', location: { directory: projectPath } },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: sessionId } = (await createResponse.json()).data;
  await request.post(`${fakeServer}/api/session/${sessionId}/prompt`, {
    data: { text: 'Recent secondary work' },
  });
  await sleep(1200);

  await openReadyChat(page);
  await openChatLibrary(page);

  await expect(page.getByText('Running & recent', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-library').getByText('Recent Secondary Session', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-library').getByText('secondary-project', { exact: false }).first()).toBeVisible();

  await page.getByTestId('chat-library').getByRole('button', { name: 'Open Recent Secondary Session' }).first().click();

  await expect(page.locator('text=/Finished: Recent secondary work/ >> visible=true').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('secondary-project', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // The group is connection-wide, so it is still listed after switching to the
  // project that owns the session (and the session is not duplicated below).
  await openChatLibrary(page);
  await expect(page.getByText('Running & recent', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-library').getByRole('button', { name: 'Open Recent Secondary Session' })).toHaveCount(1);
});

test('chat library navigation does not wait for the session list', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const fakeServer = backendOrigin();
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/api/session`, {
    data: { title: 'List independent target', location: { directory: projectPath } },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: sessionId } = (await createResponse.json()).data;
  await request.post(`${fakeServer}/api/session/${sessionId}/prompt`, {
    data: { text: 'List independent work' },
  });
  await sleep(1200);

  await openReadyChat(page);
  await openChatLibrary(page);
  const row = page.getByTestId('chat-library').getByRole('button', { name: 'Open List independent target' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Hold every session read. In-app navigation must not await one: the sheet
  // closes from provider state even though the target runtime's list is stalled.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(`${fakeServer}/api/session**`, async (route) => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  });
  try {
    await row.click();
    await expect(page.getByTestId('chat-library')).not.toBeVisible({ timeout: 10_000 });
  } finally {
    release();
  }
  await expect(page.locator('text=/Finished: List independent work/ >> visible=true').first()).toBeVisible({ timeout: 20_000 });
});

test('chat library lists running sessions from other projects', async ({ page, request }) => {
  await resetScenario(request, 'permission');
  const fakeServer = backendOrigin();
  const projectPath = '/workspace/secondary-project';

  const createResponse = await request.post(`${fakeServer}/api/session`, {
    data: { title: 'Running Secondary Session', location: { directory: projectPath } },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: sessionId } = (await createResponse.json()).data;
  await request.post(`${fakeServer}/api/session/${sessionId}/prompt`, {
    data: { text: 'Running secondary work' },
  });
  await sleep(500);

  await openReadyChat(page);
  await openChatLibrary(page);

  await expect(page.getByText('Running & recent', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-library').getByText(/secondary-project · Running/)).toBeVisible();
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
  const serverA = fakeV2Origin();
  await connectToServer(page, serverA);
  await sendPrompt(page, 'Server A session');
  await expect(page.getByText(/Finished: Server A session/).first()).toBeVisible({ timeout: 20_000 });

  await goToTab(page, 'Settings');
  await addConnection(page, { name: 'Server A', url: serverA });
  await expectConnectedTo(page, new URL(serverA).port);

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
  await expect(page.getByTestId('chat-model-picker-trigger')).toHaveAccessibleName('Auto · OpenRouter');

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
    // Both catalogs stay in V2's mixed list; model selection remains scoped to A.
    await goToTab(page, 'Settings');
    await connectToSavedConnection(page, 'Server A');
    await expectConnectedTo(page, new URL(serverA).port);
    await goToTab(page, 'Chat');
    await expect(page.getByTestId('chat-model-picker-trigger')).toHaveAccessibleName('Auto · OpenRouter', { timeout: 15_000 });
    await openChatLibrary(page);
    await expect(page.getByTestId('chat-library').getByRole('button', { name: 'Open Server A session' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('chat-library').getByRole('button', { name: 'Open Server B session' })).toBeVisible();
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
