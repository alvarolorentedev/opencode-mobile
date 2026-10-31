import { expect, test } from './helpers/fixtures.mjs';

import { respondToConfirmation, backendOrigin, goToTab, openReadyChat, resetScenario, seedOnboarding } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

async function openExtensions(page) {
  await goToTab(page, 'Settings');
  await page.getByText('Extensions', { exact: true }).click();
  await expect(page.getByText('Manage MCP servers, plugins, skills and slash commands for this server.')).toBeVisible();
}

async function configFor(page, request, directory) {
  return (await request.get(`${backendOrigin()}/api/config?location[directory]=${encodeURIComponent(directory)}`)).json();
}

test('project extensions add plugins, skills and slash commands', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await openExtensions(page);

  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByTestId('settings-extension-plugin-target').fill('opencode-example');
  await page.getByTestId('settings-extension-plugin-add').click();
  await expect(page.getByText('opencode-example', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await page.getByTestId('settings-extension-skill-name').fill('Review Helper');
  await page.getByTestId('settings-extension-skill-id').fill('review-helper');
  await page.getByTestId('settings-extension-skill-description').fill('Review a change');
  await page.getByTestId('settings-extension-skill-instructions').fill('Read the diff and report risks.');
  await page.getByTestId('settings-extension-skill-add').click();
  await expect(page.getByText('review-helper', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Commands', exact: true }).click();
  await page.getByTestId('settings-extension-command-name').fill('summarize');
  await page.getByTestId('settings-extension-command-description').fill('Summarize an argument');
  await page.getByTestId('settings-extension-command-template').fill('Summarize $ARGUMENTS.');
  await page.getByTestId('settings-extension-command-save').click();
  await expect(page.getByText('/summarize', { exact: true })).toBeVisible();

  const entries = await configFor(page, request, '/workspace/demo-project');
  const project = entries.find((entry) => entry.type === 'document' && entry.path?.endsWith('/demo-project/opencode.jsonc'));
  expect(project.info.plugins).toContain('opencode-example');
  expect(project.info.commands.summarize.template).toBe('Summarize $ARGUMENTS.');

  await goToTab(page, 'Chat');
  await page.getByPlaceholder('Ask anything...').fill('/summ');
  await expect(page.getByTestId('composer-suggestion-command-summarize')).toBeVisible();
});

test('project extensions can be removed and leave no active entries', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await openExtensions(page);

  await page.getByText('Remote', { exact: true }).click();
  await page.getByTestId('settings-extension-mcp-name').fill('removable');
  await page.getByTestId('settings-extension-mcp-target').fill('https://example.test/removable');
  await page.getByTestId('settings-extension-mcp-add').click();
  await expect(page.getByText('removable', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-mcp-remove-removable').click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('removable', { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByTestId('settings-extension-plugin-target').fill('remove-me');
  await page.getByTestId('settings-extension-plugin-add').click();
  await expect(page.getByText('remove-me', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-plugin-remove-remove-me').click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('remove-me', { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await page.getByTestId('settings-extension-skill-id').fill('remove-me-skill');
  await page.getByTestId('settings-extension-skill-name').fill('Remove me skill');
  await page.getByTestId('settings-extension-skill-instructions').fill('Temporary instructions.');
  await page.getByTestId('settings-extension-skill-add').click();
  await expect(page.getByText('remove-me-skill', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-skill-remove-remove-me-skill').click();
  await respondToConfirmation(page, true);
  await expect.poll(async () => {
    const skills = await (await request.get(`${backendOrigin()}/api/skill?location[directory]=${encodeURIComponent('/workspace/demo-project')}`)).json();
    return skills.data.some((skill) => skill.id === 'remove-me-skill');
  }).toBe(false);

  await page.getByRole('tab', { name: 'Commands', exact: true }).click();
  await page.getByTestId('settings-extension-command-name').fill('remove-me');
  await page.getByTestId('settings-extension-command-template').fill('Do nothing.');
  await page.getByTestId('settings-extension-command-save').click();
  await expect(page.getByText('/remove-me', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-command-remove-remove-me').click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('/remove-me', { exact: true })).toHaveCount(0);

  const commands = await (await request.get(`${backendOrigin()}/api/command?location[directory]=${encodeURIComponent('/workspace/demo-project')}`)).json();
  expect(commands.data.some((command) => command.name === 'remove-me')).toBe(false);
});

test('general extensions are shared with the project and can be restored from backup', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await openExtensions(page);

  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByTestId('settings-extension-plugin-target').fill('global-plugin');
  await page.getByTestId('settings-extension-plugin-add').click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('global-plugin', { exact: true })).toBeVisible();

  const entries = await configFor(page, request, '/workspace/demo-project');
  const global = entries.find((entry) => entry.type === 'document' && entry.path?.endsWith('/workspace/opencode.jsonc'));
  expect(global.info.plugins).toContain('global-plugin');

  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await expect(page.getByText('Shared with all projects', { exact: true })).toBeVisible();
  await expect(page.getByText('global-plugin', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('button', { name: 'Restore last backup', exact: true }).click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('global-plugin', { exact: true })).toHaveCount(0);
});
