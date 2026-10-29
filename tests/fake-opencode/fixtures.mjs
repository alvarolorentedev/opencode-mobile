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

const reasoningVariantModel = {
  id: 'deepseek-v4.1-flash-free',
  modelID: 'deepseek-v4.1-flash-free',
  providerID: 'opencode',
  name: 'DeepSeek V4.1 Flash Free',
  capabilities: { tools: true, input: ['text'], output: ['text'] },
  variants: ['low', 'high', 'max'].map((id) => ({ id, settings: { reasoningEffort: id } })),
  time: { released: 0 },
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  status: 'active',
  enabled: true,
  limit: { context: 128000, output: 4096 },
};

const reasoningVariantProvider = { id: 'opencode', name: 'OpenCode', activation: 'auto', integrationID: 'opencode', package: 'aisdk:@ai-sdk/openai-compatible' };

export const providerCatalog = [
  { id: 'openai', name: 'OpenAI', activation: 'auto', integrationID: 'openai', package: 'aisdk:@ai-sdk/openai' },
  { id: 'openrouter', name: 'OpenRouter', activation: 'auto', integrationID: 'openrouter', package: 'aisdk:@openrouter/ai-sdk-provider' },
  { id: 'opencode-go', name: 'OpenCode Go', activation: 'auto', integrationID: 'opencode-go', package: 'aisdk:@ai-sdk/openai-compatible' },
];

export function providersForScenario(state) {
  return state.scenario === 'reasoning-variants' ? [...providerCatalog, reasoningVariantProvider] : providerCatalog;
}

const autoRoutingModels = [
  {
    ...models[0],
    id: 'openai/gpt-4.1-mini',
    modelID: 'gpt-4.1-mini',
    name: 'GPT-4.1 mini',
    cost: [{ input: 1, output: 2, cache: { read: 0.5, write: 1 } }],
  },
  {
    ...models[0],
    id: 'openai/gpt-4.1-nano',
    modelID: 'gpt-4.1-nano',
    name: 'GPT-4.1 nano',
    cost: [{ input: 0.1, output: 0.2, cache: { read: 0.05, write: 0.1 } }],
  },
  {
    ...models[0],
    id: 'openai/o3-mini',
    modelID: 'o3-mini',
    name: 'o3-mini',
    variants: [{ id: 'low', settings: { reasoningEffort: 'low' } }, { id: 'high', settings: { reasoningEffort: 'high' } }],
    cost: [{ input: 10, output: 20, cache: { read: 5, write: 10 } }],
    limit: { context: 200000, output: 100000 },
  },
];

export function modelCatalog(state) {
  if (state.scenario === 'auto-routing') {
    return autoRoutingModels;
  }
  return [models[0], ...(state.scenario === 'reasoning-variants' ? [reasoningVariantModel] : []), ...providersForScenario(state).slice(1).map((provider) => ({
    ...models[0], id: `${provider.id}/auto`, modelID: 'auto',
    providerID: provider.id, name: 'Auto',
    enabled: state.configuredProviderIds.has(provider.id),
  }))];
}

// Whole-file fixtures behind each turn's diff. V2 serves the unified patch; V1
// serves `before`/`after` contents, so each contract projects its own shape at
// its boundary instead of sharing one.
const diffFixtures = [
  {
    file: 'app/(tabs)/index.tsx',
    status: 'modified',
    additions: 6,
    deletions: 1,
    patch: '@@ -1,1 +1,3 @@\n-export default function OldScreen() {}\n+export default function ChatLandingScreen() {\n+  return null;\n}',
    before: 'export default function OldScreen() {}\n',
    after: 'export default function ChatLandingScreen() {\n  return null;\n}\n',
  },
  {
    file: 'src/feature.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: '@@ -1,3 +1,3 @@\n export function feature() {\n-  return false;\n+  return true;\n}',
    before: 'export function feature() {\n  return false;\n}\n',
    after: 'export function feature() {\n  return true;\n}\n',
  },
];

export function toNativeFileDiffs(fixtures) {
  return fixtures.map(({ file, patch, additions, deletions, status }) => ({ file, patch, additions, deletions, status }));
}

export function toLegacyFileDiffs(fixtures) {
  return fixtures.map(({ file, before, after, additions, deletions, status }) => ({ file, before, after, additions, deletions, status }));
}

export function completedTask(previous, promptText = '') {
    const source = diffFixtures[previous === 0 ? 0 : 1];
    const todos = [{ content: 'Validate session transcript', status: 'completed', priority: 'high' }, { content: 'Confirm fake server integration', status: 'completed', priority: 'medium' }];
    const markdownFixture = promptText === 'Render markdown regression fixture'
      ? '\n\n| Tool | Status | Notes | BuildVersion | ArtifactPath | Verification |\n| :---- | :----: | ----: | :------------ | :------------: | -------------: |\n| build | OK | 12s | 1.0.32 | artifacts/android-development-build.apk | passed-on-390px-viewport |\n| test | FAIL | flaky | 1.0.32 | tests/e2e/flows.spec.mjs | retried-after-failure |\n\n1. Verify the table formatting.\n2. Open the [Markdown reference](https://example.com/markdown-reference).\n\nInline code: `<text>`.'
      : '';
    const text = `Finished: ${promptText || 'task complete'}. Flow stayed stable against the fake OpenCode server.${markdownFixture}`;
  return { source, todos, text };
}

export function permissionRequest(id, sessionID) {
  return { id: id, sessionID, action: 'edit_file', resources: ['app/(tabs)/index.tsx'], save: ['app/(tabs)/*'], metadata: { source: 'fake-opencode' } };
}

export function questionForm(id, sessionID, multiple = false) {
  return { id: id, sessionID, title: 'Approach', fields: [{ key: 'approach', type: 'string', title: 'Approach', description: 'Which implementation should be used?', options: [{ label: 'Minimal', value: 'minimal', description: 'Make the smallest safe change.' }, { label: 'Expanded', value: 'expanded', description: 'Include broader improvements.' }], custom: true }, ...(multiple ? [{ key: 'areas', type: 'multiselect', title: 'Areas', description: 'Which areas should change?', options: [{ label: 'Chat', value: 'chat' }, { label: 'Settings', value: 'settings' }], custom: true }, { key: 'reason', type: 'string', title: 'Reason', description: 'Why choose the expanded approach?', required: true, when: [{ key: 'approach', op: 'eq', value: 'expanded' }] }] : [])] };
}
