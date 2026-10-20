import { expect, test } from '@playwright/test';

import { connectToServer, getFreePort, openChatLibrary, openReadyChat, resetScenario, seedOnboarding, sendPrompt, spawnV1Server, spawnV2Server, waitForServer } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

test('polling fallback still finishes the flow when SSE is unavailable', async ({ page, request }) => {
  await resetScenario(request, 'stream-disconnect');
  await openReadyChat(page);

  await sendPrompt(page, 'Finish through polling fallback');

  await expect(page.getByText(/Finished: Finish through polling fallback/).first()).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('chat-changes-chip').click();
  await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible({ timeout: 40_000 });
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


for (const protocol of ['v1', 'v2']) {
  test(`${protocol} silently stalled event stream is re-established and reconciles a missed blocker`, async ({ page, request }) => {
    const port = await getFreePort();
    const server = protocol === 'v2' ? spawnV2Server(port, 'question') : spawnV1Server(port, 'question');
    const origin = `http://127.0.0.1:${port}`;
    try {
      await resetScenario(request, 'happy-path');
      await waitForServer(request, `${origin}${protocol === 'v2' ? '/api/info' : '/path'}`);
      await openReadyChat(page);
      await connectToServer(page, origin);
      const control = `${origin}/__control/event-stream`;
      await expect.poll(async () => (await (await request.post(control, { data: { suppress: true, stall: true } })).json()).data.clients).toBeGreaterThan(0);
      // Create a pending interaction outside the selected chat. The stream is
      // open but silent, so only the liveness watchdog can re-establish it.
      const sessionsPath = protocol === 'v2' ? '/api/session' : '/session';
      const created = await (await request.post(`${origin}${sessionsPath}`, { data: { title: 'Stalled question' } })).json();
      const session = protocol === 'v2' ? created.data : created;
      await request.post(`${origin}${sessionsPath}/${session.id}/${protocol === 'v2' ? 'prompt' : 'prompt_async'}`, {
        data: protocol === 'v2' ? { text: 'Ask an implementation question' } : { parts: [{ type: 'text', text: 'Ask an implementation question' }] },
      });
      const pendingPath = protocol === 'v2' ? '/api/form?location[directory]=/workspace/demo-project' : '/question?directory=/workspace/demo-project';
      await expect.poll(async () => {
        const payload = await (await request.get(`${origin}${pendingPath}`)).json();
        return (protocol === 'v2' ? payload.data : payload).length;
      }).toBe(1);
      await expect.poll(async () => {
        const outcome = await (await request.post(control, { data: { suppress: true, stall: true } })).json();
        return outcome.data.subscribes;
      }, { timeout: 20_000 }).toBeGreaterThan(1);
      const snapshot = page.waitForResponse((response) => response.url().startsWith(`${origin}${sessionsPath}?`) && response.request().method() === 'GET');
      await request.post(control, { data: { suppress: false, stall: false } });
      await snapshot;
      await openChatLibrary(page);
      await page.getByText('Stalled question', { exact: true }).first().click();
      await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
    } finally {
      server.kill('SIGTERM');
    }
  });
}

test('v2 network drop recovers the retained session without replaying the prompt', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port, 'retry');
  const origin = `http://127.0.0.1:${port}`;
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `${origin}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, origin);
    await sendPrompt(page, 'Network drop recovery');
    await expect(page.getByText(/retrying \(attempt 2\)/)).toBeVisible({ timeout: 15_000 });
    await page.context().setOffline(true);
    await page.waitForTimeout(1500);
    await page.context().setOffline(false);
    await expect(page.getByText(/Recovered: Network drop recovery/).first()).toBeVisible({ timeout: 30_000 });
    const state = await (await request.get(`${origin}/__control/state`)).json();
    const prompts = Object.values(state.messagesBySession).flat()
      .filter((record) => record.type === 'user' && record.text === 'Network drop recovery');
    expect(prompts).toHaveLength(1);
  } finally {
    server.kill('SIGTERM');
  }
});
