# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: flows.spec.mjs >> happy path keeps the main chat flow stable
- Location: tests/e2e/flows.spec.mjs:28:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('tab', { name: '2 Todos' })

```

# Page snapshot

```yaml
- generic [ref=e10]:
  - generic [ref=e11]:
    - generic [ref=e15]:
      - generic [ref=e17]:
        - generic [ref=e20] [cursor=pointer]:
          - generic [ref=e22]: Stabilize the chat flow
          - generic [ref=e23]: 󰅀
        - generic [ref=e24]:
          - button [ref=e26] [cursor=pointer]:
            - generic [ref=e28]:
              - img: 󰐕
          - button [ref=e30] [cursor=pointer]:
            - generic [ref=e32]:
              - img: 󰋎
      - generic [ref=e33]:
        - generic [ref=e36] [cursor=pointer]: Session
        - generic [ref=e39] [cursor=pointer]: 1 Files Changed
      - generic [ref=e42]:
        - generic [ref=e45] [cursor=pointer]:
          - generic [ref=e46]:
            - generic [ref=e47]: You
            - generic [ref=e49]: Apr 19, 2026, 12:07 AM
          - generic [ref=e51]: Stabilize the chat flow against the fake server
        - generic [ref=e54] [cursor=pointer]:
          - generic [ref=e55]:
            - generic [ref=e56]: OpenCode
            - generic [ref=e57]:
              - button [ref=e59]:
                - img: 󰕾
              - generic [ref=e60]: Apr 19, 2026, 12:07 AM
          - generic [ref=e62]: "Finished: Stabilize the chat flow against the fake server. Flow stayed stable against the fake OpenCode server."
          - generic [ref=e64]:
            - button "Updated 1 patch" [disabled]:
              - generic [ref=e66]: Updated 1 patch
      - generic [ref=e67]:
        - generic [ref=e68]:
          - generic [ref=e70] [cursor=pointer]:
            - generic [ref=e71]: 󱙺
            - generic [ref=e72]: Build
          - generic [ref=e74] [cursor=pointer]:
            - img [ref=e76]
            - generic [ref=e77]: GPT-4.1 mini
          - generic [ref=e79] [cursor=pointer]:
            - generic [ref=e80]: 󰧑
            - generic [ref=e81]: default
          - generic [ref=e84] [cursor=pointer]: 󰯄
          - generic [ref=e87] [cursor=pointer]: 󰏢
        - generic [ref=e89]:
          - textbox "Ask anything..." [ref=e93]
          - button [ref=e95] [cursor=pointer]:
            - img: 󰍬
          - generic [ref=e96]:
            - button [disabled]:
              - img: 󰒊
    - generic [ref=e102]:
      - generic [ref=e103]:
        - generic [ref=e104]: Workspaces
        - generic [ref=e105]: Connected to /workspace/demo-project
        - generic [ref=e106]:
          - button [ref=e108] [cursor=pointer]:
            - generic [ref=e110]: Sync
          - button [ref=e112] [cursor=pointer]:
            - generic [ref=e114]: Refresh
      - generic [ref=e116]:
        - generic [ref=e118]:
          - generic [ref=e119]: Projects
          - generic [ref=e120]: Pick the workspace that should back the chat.
        - generic [ref=e124] [cursor=pointer]:
          - generic [ref=e125]:
            - generic [ref=e126]: demo-project
            - generic [ref=e127]: /workspace/demo-project
          - generic [ref=e128]: Active
      - generic [ref=e130]:
        - generic [ref=e131]:
          - generic [ref=e132]:
            - generic [ref=e133]: Chats
            - generic [ref=e134]: Showing chats for demo-project
          - button [ref=e137] [cursor=pointer]:
            - generic [ref=e139]: New
        - generic [ref=e140]:
          - button [ref=e143] [cursor=pointer]:
            - generic [ref=e145]: Show archived
          - generic [ref=e148] [cursor=pointer]:
            - generic [ref=e149]:
              - generic [ref=e150]: Stabilize the chat flow
              - generic [ref=e151]: "Finished: Stabilize the chat flow against the fake server. Flow stayed stable against the fake OpenCode server."
            - generic [ref=e152]:
              - generic [ref=e153]: just now
              - generic [ref=e154]: idle
              - button [ref=e156]:
                - generic [ref=e158]: Archive
  - tablist [ref=e160]:
    - tab "  Chat" [selected] [ref=e162] [cursor=pointer]:
      - generic [ref=e163]:
        - generic [ref=e165]: 
        - generic [ref=e167]: 
      - generic [ref=e168]: Chat
    - tab "  Workspace" [ref=e170] [cursor=pointer]:
      - generic [ref=e171]:
        - generic [ref=e173]: 
        - generic [ref=e175]: 
      - generic [ref=e176]: Workspace
    - tab "  Settings" [ref=e178] [cursor=pointer]:
      - generic [ref=e179]:
        - generic [ref=e181]: 
        - generic [ref=e183]: 
      - generic [ref=e184]: Settings
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | 
  3  | async function resetScenario(request, scenario) {
  4  |   const response = await request.post('http://127.0.0.1:44096/__control/reset', {
  5  |     data: { scenario },
  6  |   });
  7  | 
  8  |   expect(response.ok()).toBeTruthy();
  9  | }
  10 | 
  11 | async function openReadyChat(page) {
  12 |   await page.goto('/', { waitUntil: 'domcontentloaded' });
  13 |   if (await page.getByText('Choose a workspace').isVisible().catch(() => false)) {
  14 |     await page.getByRole('tab', { name: 'Workspace' }).click();
  15 |     await expect(page.getByText('Projects', { exact: true })).toBeVisible();
  16 |     await page.getByText('demo-project', { exact: true }).click();
  17 |     await page.getByRole('tab', { name: 'Chat' }).click();
  18 |   }
  19 |   await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
  20 |   await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
  21 | }
  22 | 
  23 | async function sendPrompt(page, prompt) {
  24 |   await page.getByPlaceholder('Ask anything...').fill(prompt);
  25 |   await page.getByTestId('chat-send-button').click();
  26 | }
  27 | 
  28 | test('happy path keeps the main chat flow stable', async ({ page, request }) => {
  29 |   await resetScenario(request, 'happy-path');
  30 |   await openReadyChat(page);
  31 | 
  32 |   await sendPrompt(page, 'Stabilize the chat flow against the fake server');
  33 | 
  34 |   await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  35 |   await expect(page.getByText(/Flow stayed stable against the fake OpenCode server/).first()).toBeVisible();
> 36 |   await page.getByRole('tab', { name: '2 Todos' }).click();
     |                                                    ^ Error: locator.click: Test timeout of 60000ms exceeded.
  37 |   await expect(page.getByText('Todo list', { exact: true })).toBeVisible();
  38 |   await expect(page.getByText('Validate session transcript', { exact: true })).toBeVisible();
  39 |   await expect(page.getByText('Confirm fake server integration', { exact: true })).toBeVisible();
  40 |   await page.getByRole('tab', { name: 'Workspace' }).click();
  41 |   await expect(page.getByText('Chats', { exact: true })).toBeVisible();
  42 |   await expect(page.getByText('Stabilize the chat flow', { exact: true }).last()).toBeVisible();
  43 |   await expect(page.getByText('Archive', { exact: true })).toBeVisible();
  44 | });
  45 | 
  46 | test('permission requests unblock the agent flow', async ({ page, request }) => {
  47 |   await resetScenario(request, 'permission');
  48 |   await openReadyChat(page);
  49 | 
  50 |   await sendPrompt(page, 'Trigger a permission request');
  51 | 
  52 |   await expect(page.getByText('Permission request', { exact: true })).toBeVisible({ timeout: 15_000 });
  53 |   await page.getByText('Allow once').click();
  54 |   await expect(page.getByText(/permission resolved/).first()).toBeVisible({ timeout: 20_000 });
  55 | });
  56 | 
  57 | test('question requests unblock the agent flow', async ({ page, request }) => {
  58 |   await resetScenario(request, 'question');
  59 |   await openReadyChat(page);
  60 | 
  61 |   await sendPrompt(page, 'Trigger a question request');
  62 | 
  63 |   await expect(page.getByText('Question', { exact: true })).toBeVisible({ timeout: 15_000 });
  64 |   await page.getByText('Chat flow').click();
  65 |   await page.getByText('Submit').click();
  66 |   await expect(page.getByText(/question resolved/).first()).toBeVisible({ timeout: 20_000 });
  67 | });
  68 | 
  69 | test('settings can configure an additional provider against the fake server', async ({ page, request }) => {
  70 |   await resetScenario(request, 'happy-path');
  71 |   await openReadyChat(page);
  72 | 
  73 |   await page.getByRole('tab', { name: 'Settings' }).click();
  74 |   await expect(page.getByText('AI defaults')).toBeVisible();
  75 |   await page.getByTestId('settings-add-provider-button').click();
  76 |   await expect(page.getByRole('menuitem', { name: 'OpenRouter', exact: true })).toBeVisible();
  77 |   await page.getByRole('menuitem', { name: 'OpenRouter', exact: true }).click();
  78 |   await expect(page.getByText('Configure OpenRouter')).toBeVisible();
  79 |   await page.getByPlaceholder('Paste your API key').fill('sk-test-openrouter');
  80 |   await page.getByTestId('settings-provider-save-button').click();
  81 |   await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  82 |   await expect(page.getByRole('button', { name: 'OpenRouter', exact: true })).toBeVisible();
  83 | });
  84 | 
  85 | test('polling fallback still finishes the flow when SSE is unavailable', async ({ page, request }) => {
  86 |   await resetScenario(request, 'stream-disconnect');
  87 |   await openReadyChat(page);
  88 | 
  89 |   await sendPrompt(page, 'Finish through polling fallback');
  90 | 
  91 |   await page.getByRole('tab', { name: 'Workspace' }).click();
  92 |   await expect(page.getByText('Finish through polling fallback', { exact: true }).last()).toBeVisible({ timeout: 40_000 });
  93 |   await expect(page.getByText('idle', { exact: true })).toBeVisible({ timeout: 40_000 });
  94 | });
  95 | 
```