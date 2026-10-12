// Canonical native v2 records. Compatibility fixtures project these at their boundary.
export const models = [{
  id: 'openai/gpt-4.1-mini',
  modelID: 'gpt-4.1-mini',
  providerID: 'openai',
  name: 'GPT-4.1 mini',
  capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
  variants: [],
  time: { released: 0 },
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  status: 'active',
  enabled: true,
  limit: { context: 128000, output: 4096 },
}];

export const providerCatalog = [
  { id: 'openai', name: 'OpenAI', activation: 'auto', integrationID: 'openai', package: 'aisdk:@ai-sdk/openai' },
  { id: 'openrouter', name: 'OpenRouter', activation: 'auto', integrationID: 'openrouter', package: 'aisdk:@openrouter/ai-sdk-provider' },
  { id: 'opencode-go', name: 'OpenCode Go', activation: 'auto', integrationID: 'opencode-go', package: 'aisdk:@ai-sdk/openai-compatible' },
];

export function modelCatalog(state) {
  return [models[0], ...providerCatalog.slice(1).map((provider) => ({
    ...models[0], id: `${provider.id}/auto`, modelID: 'auto',
    providerID: provider.id, name: 'Auto',
    enabled: state.configuredProviderIds.has(provider.id),
  }))];
}

export function completedTask(previous, promptText = '') {
    const diff = previous === 0 ? [{ file: 'app/(tabs)/index.tsx', additions: 6, deletions: 1, status: 'modified', patch: '@@ -1,1 +1,3 @@\n-export default function OldScreen() {}\n+export default function ChatLandingScreen() {\n+  return null;\n+}' }] : [{ file: 'src/feature.ts', additions: 1, deletions: 1, status: 'modified', patch: '@@ -1,3 +1,3 @@\n export function feature() {\n-  return false;\n+  return true;\n }' }];
    const todos = [{ content: 'Validate session transcript', status: 'completed', priority: 'high' }, { content: 'Confirm fake server integration', status: 'completed', priority: 'medium' }];
    const markdownFixture = promptText === 'Render markdown regression fixture'
      ? '\n\n| Tool | Status | Notes | BuildVersion | ArtifactPath | Verification |\n| :---- | :----: | ----: | :------------ | :------------: | -------------: |\n| build | OK | 12s | 1.0.32 | artifacts/android-development-build.apk | passed-on-390px-viewport |\n| test | FAIL | flaky | 1.0.32 | tests/e2e/flows.spec.mjs | retried-after-failure |\n\n1. Verify the table formatting.\n2. Open the [Markdown reference](https://example.com/markdown-reference).\n\nInline code: `<text>`.'
      : '';
    const text = `Finished: ${promptText || 'task complete'}. Flow stayed stable against the fake OpenCode server.${markdownFixture}`;
  return { diff, todos, text };
}

export function permissionRequest(id, sessionID) {
  return { id: id, sessionID, action: 'edit_file', resources: ['app/(tabs)/index.tsx'], save: ['app/(tabs)/*'], metadata: { source: 'fake-opencode' } };
}

export function questionForm(id, sessionID, multiple = false) {
  return { id: id, sessionID, title: 'Approach', fields: [{ key: 'approach', type: 'string', title: 'Approach', description: 'Which implementation should be used?', options: [{ label: 'Minimal', value: 'minimal', description: 'Make the smallest safe change.' }, { label: 'Expanded', value: 'expanded', description: 'Include broader improvements.' }], custom: true }, ...(multiple ? [{ key: 'areas', type: 'multiselect', title: 'Areas', description: 'Which areas should change?', options: [{ label: 'Chat', value: 'chat' }, { label: 'Settings', value: 'settings' }], custom: true }, { key: 'reason', type: 'string', title: 'Reason', description: 'Why choose the expanded approach?', required: true, when: [{ key: 'approach', op: 'eq', value: 'expanded' }] }] : [])] };
}
