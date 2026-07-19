import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/opencode/usage.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { aggregateSessionUsage, formatEstimatedCost, formatTokenCount, getLatestAssistantTurnUsage } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

const pricing = { 'anthropic/sonnet': { input: 0.000003, output: 0.000015, cache: { read: 0.0000003, write: 0.00000375 } } };

function step(id, cost = 0.043, tokens = { input: 842, output: 100, reasoning: 9, cache: { read: 20, write: 2 } }) {
  return { id, messageID: 'message-1', sessionID: 'session-1', type: 'step-finish', reason: 'stop', cost, tokens };
}

function assistant(parts, providerID = 'anthropic', modelID = 'sonnet') {
  return { info: { id: 'message-1', sessionID: 'session-1', role: 'assistant', providerID, modelID }, parts };
}

const single = aggregateSessionUsage([assistant([step('step-1')])], pricing);
assert.equal(single.cost, 0.043);
assert.equal(single.completedSteps, 1);
assert.equal(single.inputTokens, 842);
assert.equal(single.reasoningTokens, 9);
assert.equal(single.cacheWriteTokens, 2);

const toolLoop = aggregateSessionUsage([assistant([step('step-1'), { id: 'tool-1', type: 'tool', state: { status: 'completed' } }, step('step-2', 0.02)])], pricing);
assert.equal(toolLoop.completedSteps, 2);
assert.equal(toolLoop.cost, 0.063);

const multiProvider = aggregateSessionUsage([assistant([step('step-1')]), assistant([step('step-2', 0.02)], 'openai', 'gpt')], pricing);
assert.equal(multiProvider.providers.length, 2);
assert.equal(multiProvider.providers.find((provider) => provider.providerId === 'openai').models[0].modelId, 'gpt');
assert.equal(aggregateSessionUsage([assistant([step('step-7')]), assistant([step('step-8')], 'anthropic', 'haiku')], pricing).providers[0].models.length, 2);

const estimated = aggregateSessionUsage([assistant([step('step-3', 0)])], pricing);
assert.equal(estimated.costStatus, 'estimated');
assert.ok(estimated.cost > 0);
assert.equal(aggregateSessionUsage([assistant([step('step-4', 0)])]).costStatus, 'pricing-unavailable');
assert.equal(aggregateSessionUsage([assistant([step('step-4b', 0)])], { 'anthropic/sonnet': { input: 0, output: 0, cache: { read: 0, write: 0 } } }).costStatus, 'pricing-unavailable');
assert.equal(aggregateSessionUsage([assistant([step('step-5', 0, { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })])]).costStatus, 'free');

const tiered = aggregateSessionUsage([assistant([step('step-tier', 0, { input: 250_001, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })])], {
  'anthropic/sonnet': { input: 1, output: 1, cache: { read: 1, write: 1 }, tiers: [{ input: 2, output: 2, cache: { read: 2, write: 2 }, tier: { type: 'context', size: 200_000 } }] },
});
assert.equal(tiered.cost, 500_002);

const replayed = aggregateSessionUsage([assistant([step('step-6'), step('step-6')]), assistant([step('step-6')])], pricing);
assert.equal(replayed.completedSteps, 1);
assert.equal(replayed.cost, 0.043);
assert.equal(getLatestAssistantTurnUsage([assistant([{ id: 'streaming-text', type: 'text', text: 'partial' }])]), undefined);
assert.equal(aggregateSessionUsage([]).completedSteps, 0);
assert.equal(formatEstimatedCost(0.0004), '$0.0004');
assert.equal(formatEstimatedCost(0.043), '$0.043');
assert.equal(formatTokenCount(842), '842');
assert.equal(formatTokenCount(12_400), '12.4K');
assert.equal(formatTokenCount(1_800_000), '1.8M');

console.log('usage tests passed');
