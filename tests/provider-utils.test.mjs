import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../providers/opencode-provider-utils.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { getConfiguredProviderIds, getInitialModelId, getInitialProviderId, getModelIdForProvider, recordRecentModelId, resolveConfigModelId } = await import(`data:text/javascript,${encodeURIComponent(output)}`);
const models = [{ id: 'openai/gpt', modelID: 'gpt', providerID: 'openai' }];

assert.deepEqual([...getConfiguredProviderIds({ enabled_providers: ['openai'] }, [], models)], ['openai']);
assert.deepEqual([...getConfiguredProviderIds({ disabled_providers: ['openai'], enabled_providers: ['openai'], provider: { openai: {} } }, ['openai'], models)], []);

assert.deepEqual(recordRecentModelId([], 'a/b'), ['a/b']);
assert.deepEqual(recordRecentModelId(['a/b', 'c/d'], 'c/d'), ['c/d', 'a/b']);
assert.deepEqual(recordRecentModelId(['a', 'b', 'c', 'd'], 'e'), ['e', 'a', 'b', 'c']);
assert.deepEqual(recordRecentModelId(['a/b']), ['a/b']);

// Default model follows the server config; with no stored or server match
// nothing is auto-picked so prompts fall through to the server default.
assert.equal(getInitialModelId(models, { model: 'openai/gpt' }, undefined), 'openai/gpt');
assert.equal(getInitialModelId(models, { model: 'openai/gpt' }, 'openai/gpt'), 'openai/gpt');
assert.equal(getInitialModelId(models, { model: 'openrouter/blocked' }, undefined), undefined);
assert.equal(getInitialModelId(models, undefined, undefined), undefined);
assert.equal(getInitialProviderId(models, { model: 'openai/gpt' }, undefined, undefined), 'openai');
assert.equal(getInitialProviderId(models, { model: 'openrouter/blocked' }, undefined, undefined), undefined);
assert.equal(getModelIdForProvider(models, 'openai', undefined, undefined), undefined);
assert.equal(getModelIdForProvider(models, 'openai', 'openai/gpt', undefined), 'openai/gpt');

// Variant-qualified server values (e.g. `openrouter/~group/model`) still
// resolve to the catalog entry and mark its provider configured.
const variantModels = [{ id: 'openrouter/deepseek-chat', modelID: 'deepseek-chat', providerID: 'openrouter' }];
assert.equal(resolveConfigModelId(variantModels, 'openrouter/~group/deepseek-chat'), 'openrouter/deepseek-chat');
assert.deepEqual([...getConfiguredProviderIds({ enabled_providers: [] }, [], variantModels.map((model) => ({ ...model, id: model.id })))], []);
assert.deepEqual(
  [...getConfiguredProviderIds({ enabled_providers: [], model: 'openrouter/~group/deepseek-chat' }, [], variantModels)],
  ['openrouter'],
);

console.log('provider utility tests passed');
