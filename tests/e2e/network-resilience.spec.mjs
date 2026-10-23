import { expect, test } from '@playwright/test';

import {
  connectToServer,
  getFreePort,
  openReadyChat,
  resetScenario,
  seedOnboarding,
  sendPrompt,
  spawnV2Server,
  waitForServer,
} from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

test('4G latency keeps chat usable and completes a prompt', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port);
  const origin = `http://127.0.0.1:${port}`;
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `${origin}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, origin);
    await request.post(`${origin}/__control/network`, { data: { latencyMs: 120, jitterMs: 30 } });

    await sendPrompt(page, 'Complete over congested 4G');
    await expect(page.getByText(/Finished: Complete over congested 4G/).first()).toBeVisible({ timeout: 45_000 });
  } finally {
    await request.post(`${origin}/__control/network`, { data: {} }).catch(() => undefined);
    server.kill('SIGTERM');
  }
});

test('offline prompt is queued and delivered once after connectivity returns', async ({ page, request }) => {
  const port = await getFreePort();
  const server = spawnV2Server(port);
  const origin = `http://127.0.0.1:${port}`;
  try {
    await resetScenario(request, 'happy-path');
    await waitForServer(request, `${origin}/api/info`);
    await openReadyChat(page);
    await connectToServer(page, origin);

    await page.context().setOffline(true);
    await sendPrompt(page, 'Queued while offline');
    await expect(page.getByTestId('pending-prompts')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Queued/).first()).toBeVisible({ timeout: 15_000 });

    await page.context().setOffline(false);
    await expect(page.getByText(/Finished: Queued while offline/).first()).toBeVisible({ timeout: 45_000 });

    const state = await (await request.get(`${origin}/__control/state`)).json();
    const prompts = Object.values(state.messagesBySession).flat()
      .filter((record) => record.type === 'user' && record.text === 'Queued while offline');
    expect(prompts).toHaveLength(1);
  } finally {
    await page.context().setOffline(false).catch(() => undefined);
    server.kill('SIGTERM');
  }
});
