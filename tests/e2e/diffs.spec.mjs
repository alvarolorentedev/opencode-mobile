import { expect, test } from './helpers/fixtures.mjs';

import { chooseDiffSource, connectToServer, getFreePort, goToTab, openReadyChat, resetScenario, seedOnboarding, sendPrompt, spawnV2Server, waitForServer } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

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
  // Diff reconciliation may follow completion text on the five-second fallback.
  await expect(page.getByText('src/feature.ts', { exact: true })).toBeVisible({ timeout: 20_000 });
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

test('v1 compatibility renders diff lines from before/after contents', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Create a v1 compatibility diff');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 40_000 });

  await page.getByTestId('chat-changes-chip').click();
  const overlay = page.getByTestId('changes-overlay');
  await expect(overlay.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible();

  // V1 serves whole-file `before`/`after` contents instead of a unified patch.
  // The expanded preview must show the changed lines rather than a filename
  // with an empty body.
  await overlay.getByRole('button', { name: /app\/\(tabs\)\/index\.tsx/ }).click();
  await expect(overlay.getByText('export default function OldScreen() {}', { exact: true })).toBeVisible();
  await expect(overlay.getByText('export default function ChatLandingScreen() {', { exact: true })).toBeVisible();
  await expect(overlay.getByText('  return null;', { exact: true })).toBeVisible();
  await expect(overlay.getByText('No line changes available.', { exact: true })).toHaveCount(0);
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
    // request must carry location[directory] for the project diff to show.
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

test('project shows changed files, deleted scope, search states and failure recovery', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await page.route('**/api/vcs/status?**', (route) => route.fulfill({ json: { location: { directory: '/workspace/demo-project' }, data: [
    { file: 'src/demo.ts', status: 'modified', additions: 2, deletions: 1 },
    { file: 'README.md', status: 'added', additions: 1, deletions: 0 },
    { file: 'removed.ts', status: 'deleted', additions: 0, deletions: 1 },
  ] } }));
  await openReadyChat(page);
  await goToTab(page, 'Projects');
  await expect(page.getByText('Deleted file content is unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
  await page.getByText('src/demo.ts', { exact: true }).click();
  await expect(page.getByText(/OpenCode 1\.18\.3/)).toBeVisible();
  await page.getByLabel('Close file').click();
  await expect(page.getByLabel('Close file')).toHaveCount(0);
  const search = page.getByTestId('project-file-search');
  await search.fill('no-match-zz');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
  await expect(search).toBeFocused();
  await search.press('Enter');
  await expect(page.getByText('No files match “no-match-zz”.')).toBeVisible();
  await page.route('**/api/fs/find?**', (route) => route.fulfill({ status: 500, json: { message: 'Search unavailable' } }));
  await search.fill('demo');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/Search unavailable|500|search project files/i).first()).toBeVisible();
  await page.unroute('**/api/fs/find?**');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Results for “demo”')).toBeVisible();
});
