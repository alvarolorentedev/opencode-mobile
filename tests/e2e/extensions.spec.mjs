import { expect, test } from './helpers/fixtures.mjs';

import { respondToConfirmation, backendOrigin, goToTab, openReadyChat, resetScenario, seedOnboarding } from './helpers/flows.mjs';

test.beforeEach(async ({ page }, info) => {
  await seedOnboarding(page, info);
});

async function openExtensions(page) {
  await goToTab(page, 'Settings');
  await page.getByText('Extensions', { exact: true }).click();
  await expect(page.getByText('Manage MCP servers, plugins, agents, skills and slash commands for this server.')).toBeVisible();
}

async function configFor(page, request, directory) {
  return (await request.get(`${backendOrigin()}/api/config?location[directory]=${encodeURIComponent(directory)}`)).json();
}

async function writeWorkspaceFile(request, directory, path, content) {
  const response = await request.post(`${backendOrigin()}/api/experimental/fs/write?path=${encodeURIComponent(path)}&location[directory]=${encodeURIComponent(directory)}`, {
    data: content,
    headers: { 'Content-Type': 'text/plain' },
  });
  expect(response.ok()).toBe(true);
}

async function commandsFor(request, directory) {
  return (await request.get(`${backendOrigin()}/api/command?location[directory]=${encodeURIComponent(directory)}`)).json();
}

async function agentsFor(request, directory) {
  return (await request.get(`${backendOrigin()}/api/agent?location[directory]=${encodeURIComponent(directory)}`)).json();
}

test('project extensions add plugins, skills and slash commands', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  const projectDirectory = '/workspace/demo-project';
  await writeWorkspaceFile(request, projectDirectory, `${projectDirectory}/.opencode/commands/existing-md.md`, '---\ndescription: Existing Markdown\n---\n\nUse $ARGUMENTS.\n');
  await openReadyChat(page);
  await goToTab(page, 'Settings');
  const beforePreferences = await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences'));
  await page.getByTestId('settings-search').fill('Custom model ID');
  await page.getByRole('button', { name: /^Custom model ID\./ }).click();
  await expect(page.getByTestId('settings-search-destination').getByRole('textbox')).toBeVisible();
  await expect(page.getByTestId('settings-extension-agent-model')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('opencode-mobile.chat-preferences'))).toBe(beforePreferences);
  await page.getByRole('button', { name: 'Back to extensions', exact: true }).click();
  await page.getByTestId('settings-section-overlay').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('settings-search').fill('');
  await openExtensions(page);

  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByTestId('settings-extension-plugin-open').click();
  await page.getByTestId('settings-extension-plugin-target').fill('opencode-example');
  await page.getByTestId('settings-extension-plugin-add').click();
  await expect(page.getByText('opencode-example', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await page.getByTestId('settings-extension-skill-open').click();
  await page.getByTestId('settings-extension-skill-name').fill('Review Helper');
  await page.getByTestId('settings-extension-skill-id').fill('review-helper');
  await page.getByTestId('settings-extension-skill-description').fill('Review a change');
  await page.getByRole('button', { name: 'Back to extensions', exact: true }).click();
  await respondToConfirmation(page, false);
  await expect(page.getByTestId('settings-extension-skill-name')).toHaveValue('Review Helper');
  await page.getByRole('tab', { name: 'Instructions', exact: true }).click();
  await page.getByTestId('settings-extension-skill-instructions').fill('Read the diff and report risks.');
  await page.getByTestId('settings-extension-skill-add').click();
  await expect(page.getByText('review-helper', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Commands', exact: true }).click();
  await expect(page.getByText('/existing-md', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-command-edit-existing-md').click();
  await page.getByTestId('settings-extension-command-description').fill('Updated Markdown');
  await page.getByTestId('settings-extension-command-save').click();
  await expect.poll(async () => (await commandsFor(request, projectDirectory)).data.find((command) => command.name === 'existing-md')?.description).toBe('Updated Markdown');
  await expect(page.getByText('Add slash command', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-command-open').click();
  await page.getByTestId('settings-extension-command-name').fill('summarize');
  await page.getByTestId('settings-extension-command-description').fill('Summarize an argument');
  await page.getByTestId('settings-extension-command-save').click();
  await expect(page.getByRole('tab', { name: 'Instructions', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Instructions', exact: true }).click();
  await page.getByTestId('settings-extension-command-template').fill('Summarize $ARGUMENTS.');
  await page.getByTestId('settings-extension-command-save').click();
  await expect(page.getByText('/summarize', { exact: true })).toBeVisible();

  const entries = await configFor(page, request, projectDirectory);
  const project = entries.find((entry) => entry.type === 'document' && entry.path?.endsWith('/demo-project/opencode.jsonc'));
  expect(project.info.plugins).toContain('opencode-example');
  expect(project.info.commands?.summarize).toBeUndefined();
  await expect.poll(async () => (await commandsFor(request, projectDirectory)).data.some((command) => command.name === 'summarize')).toBe(true);

  await goToTab(page, 'Chat');
  await page.getByPlaceholder('Ask anything...').fill('/summ');
  await expect(page.getByTestId('composer-suggestion-command-summarize')).toBeVisible();
});

test('project extensions can be removed and leave no active entries', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await resetScenario(request, 'happy-path');
  const projectDirectory = '/workspace/demo-project';
  const projectConfigPath = `${projectDirectory}/opencode.jsonc`;
  await writeWorkspaceFile(request, projectDirectory, projectConfigPath, JSON.stringify({
    commands: { 'legacy-cmd': { description: 'Legacy command', template: 'Legacy $ARGUMENTS.' } },
    agents: { 'legacy-agent': { description: 'Legacy agent', mode: 'subagent', system: 'Legacy instructions.' } },
  }, null, 2));
  await openReadyChat(page);
  await openExtensions(page);

  await page.getByRole('tab', { name: 'Commands', exact: true }).click();
  await expect(page.getByText('/legacy-cmd', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-command-edit-legacy-cmd').click();
  await page.getByTestId('settings-extension-command-description').fill('Legacy updated');
  await page.getByTestId('settings-extension-command-save').click();
  await expect.poll(async () => {
    const entries = await configFor(page, request, projectDirectory);
    const project = entries.find((entry) => entry.type === 'document' && entry.path?.endsWith('/demo-project/opencode.jsonc'));
    return project?.info.commands?.['legacy-cmd']?.description;
  }).toBe('Legacy updated');

  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(page.getByText('legacy-agent', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-agent-edit-legacy-agent').click();
  await page.getByTestId('settings-extension-agent-description').fill('Legacy agent updated');
  await page.getByTestId('settings-extension-agent-save').click();
  await expect.poll(async () => {
    const entries = await configFor(page, request, projectDirectory);
    const project = entries.find((entry) => entry.type === 'document' && entry.path?.endsWith('/demo-project/opencode.jsonc'));
    return project?.info.agents?.['legacy-agent']?.description;
  }).toBe('Legacy agent updated');

  await page.getByRole('tab', { name: 'MCPs', exact: true }).click();
  await page.getByTestId('settings-extension-mcp-open').click();
  await page.getByRole('button', { name: 'Connection type. Command on server', exact: true }).click();
  await page.getByRole('option', { name: 'Remote server', exact: true }).click();
  await page.getByTestId('settings-extension-mcp-name').fill('removable');
  await page.getByTestId('settings-extension-mcp-target').fill('https://example.test/removable');
  await page.getByTestId('settings-extension-mcp-add').click();
  await expect(page.getByText('removable', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-mcp-remove-removable').click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('removable', { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByTestId('settings-extension-plugin-open').click();
  await page.getByTestId('settings-extension-plugin-target').fill('remove-me');
  await page.getByTestId('settings-extension-plugin-add').click();
  await expect(page.getByText('remove-me', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-plugin-remove-remove-me').click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('remove-me', { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await page.getByTestId('settings-extension-skill-open').click();
  await page.getByTestId('settings-extension-skill-id').fill('remove-me-skill');
  await page.getByTestId('settings-extension-skill-name').fill('Remove me skill');
  await page.getByRole('tab', { name: 'Instructions', exact: true }).click();
  await page.getByTestId('settings-extension-skill-instructions').fill('Temporary instructions.');
  await page.getByTestId('settings-extension-skill-add').click();
  await expect(page.getByText('remove-me-skill', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-skill-remove-remove-me-skill').click();
  await respondToConfirmation(page, true);
  await expect.poll(async () => {
    const skills = await (await request.get(`${backendOrigin()}/api/skill?location[directory]=${encodeURIComponent('/workspace/demo-project')}`)).json();
    return skills.data.some((skill) => skill.id === 'remove-me-skill');
  }).toBe(false);

  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('settings-extension-agent-open').click();
  await page.getByTestId('settings-extension-agent-id').fill('remove-me-agent');
  await page.getByTestId('settings-extension-agent-description').fill('Remove me agent');
  await page.getByTestId('extension-agent-model-picker-trigger').click();
  await page.getByTestId('extension-agent-model-picker-search').fill('gpt-4.1-mini');
  await page.screenshot({ path: '/tmp/opencode-extension-model-picker.png' });
  await page.getByRole('button', { name: /GPT-4.1 mini/i }).click();
  await page.getByRole('tab', { name: 'Instructions', exact: true }).click();
  await page.getByTestId('settings-extension-agent-instructions').fill('Temporary agent instructions.');
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  await expect(page.getByTestId('settings-extension-agent-id')).toHaveValue('remove-me-agent');
  await expect(page.getByTestId('extension-agent-model-picker-trigger')).toHaveAccessibleName(/GPT-4.1 mini/);
  await page.getByTestId('extension-agent-model-picker-trigger').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/opencode-extension-agent-setup.png' });
  await page.getByRole('tab', { name: 'Instructions', exact: true }).click();
  await expect(page.getByTestId('settings-extension-agent-instructions')).toHaveValue('Temporary agent instructions.');
  await page.getByTestId('settings-extension-agent-save').click();
  await expect(page.getByText('remove-me-agent', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-agent-edit-remove-me-agent').click();
  await page.getByTestId('settings-extension-agent-description').fill('Edited agent');
  await page.getByTestId('settings-extension-agent-save').click();
  await expect.poll(async () => (await agentsFor(request, projectDirectory)).data.find((agent) => agent.id === 'remove-me-agent')?.description).toBe('Edited agent');
  await page.getByTestId('settings-extension-agent-remove-remove-me-agent').click();
  await respondToConfirmation(page, true);
  await expect.poll(async () => (await agentsFor(request, projectDirectory)).data.some((agent) => agent.id === 'remove-me-agent')).toBe(false);

  await page.getByRole('tab', { name: 'Commands', exact: true }).click();
  await page.getByTestId('settings-extension-command-open').click();
  await page.getByTestId('settings-extension-command-name').fill('remove-me');
  await page.getByRole('tab', { name: 'Instructions', exact: true }).click();
  await page.getByTestId('settings-extension-command-template').fill('Do nothing.');
  await page.getByTestId('settings-extension-command-save').click();
  await expect(page.getByText('/remove-me', { exact: true })).toBeVisible();
  await page.getByTestId('settings-extension-command-remove-remove-me').click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('/remove-me', { exact: true })).toHaveCount(0);

  const commands = await commandsFor(request, projectDirectory);
  expect(commands.data.some((command) => command.name === 'remove-me')).toBe(false);
});

test('general extensions are shared with the project and can be restored from backup', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await openExtensions(page);

  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByTestId('settings-extension-plugin-open').click();
  await page.getByTestId('settings-extension-plugin-target').fill('global-plugin');
  await page.getByTestId('settings-extension-plugin-add').click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('global-plugin', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.getByTestId('settings-extension-agent-open').click();
  await page.getByTestId('settings-extension-agent-id').fill('global-reviewer');
  await page.getByTestId('settings-extension-agent-description').fill('Global review agent');
  await page.getByRole('tab', { name: 'Instructions', exact: true }).click();
  await page.getByTestId('settings-extension-agent-instructions').fill('Review every project.');
  await page.getByTestId('settings-extension-agent-save').click();
  // General-scope writes confirm once per scope visit: the plugin add above
  // already confirmed, so the agent save proceeds without another dialog.
  await expect(page.getByText('global-reviewer', { exact: true })).toBeVisible();

  const entries = await configFor(page, request, '/workspace/demo-project');
  const global = entries.find((entry) => entry.type === 'document' && entry.path?.endsWith('/workspace/opencode.jsonc'));
  expect(global.info.plugins).toContain('global-plugin');

  await page.getByRole('button', { name: 'This project', exact: true }).click();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await expect(page.getByText('Shared with all projects', { exact: true })).toBeVisible();
  await expect(page.getByText('global-plugin', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(page.getByText('global-reviewer', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.getByRole('button', { name: 'Configuration details', exact: true }).click();
  await page.getByRole('button', { name: 'Restore last backup', exact: true }).click();
  await respondToConfirmation(page, true);
  await expect(page.getByText('global-plugin', { exact: true })).toHaveCount(0);
});
