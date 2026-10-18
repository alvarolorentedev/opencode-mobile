import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, it } from 'vitest';

// Migrated from the standalone tests/usage.test.mjs Node script.
describe('session usage aggregation', () => {
  it('aggregates steps, resolves authoritative totals, and reports context fill', async () => {
    const source = await readFile(new URL('../../lib/opencode/usage.ts', import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
    const { aggregateSessionUsage, formatEstimatedCost, formatTokenCount, getLatestAssistantTurnUsage, getLatestContextTokens, addUsageSteps, aggregateUsageSteps, getSessionUsage } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

    const pricing = { 'anthropic/sonnet': { input: 0.000003, output: 0.000015, cache: { read: 0.0000003, write: 0.00000375 } } };

    function step(id: string, cost = 0.043, tokens = { input: 842, output: 100, reasoning: 9, cache: { read: 20, write: 2 } }) {
      return { id, messageID: 'message-1', sessionID: 'session-1', type: 'step-finish', reason: 'stop', cost, tokens };
    }

    function assistant(parts: unknown[], providerID = 'anthropic', modelID = 'sonnet') {
      return { info: { id: 'message-1', sessionID: 'session-1', role: 'assistant', providerID, modelID }, parts };
    }

    const single = aggregateSessionUsage([assistant([step('step-1')])], pricing);
    assert.equal(single.cost, 0.043);
    assert.equal(single.completedSteps, 1);
    assert.equal(single.inputTokens, 842);
    assert.equal(single.reasoningTokens, 9);
    assert.equal(single.cacheWriteTokens, 2);
    const authoritative = getSessionUsage({ cost: 40, tokens: { input: 4000, output: 800, reasoning: 40, cache: { read: 100, write: 20 } } }, single, false);
    assert.equal(authoritative.cost, 40, 'Server totals replace the loaded tail rather than adding to it.');
    assert.equal(authoritative.inputTokens, 4000);
    assert.equal(authoritative.completedSteps, 1);
    assert.deepEqual(authoritative.completeness, { cost: true, tokens: true, breakdown: false });
    assert.deepEqual(getSessionUsage(undefined, single, false).completeness, { cost: false, tokens: false, breakdown: false });
    assert.equal(getSessionUsage({ cost: 0 }, single, false).cost, 0, 'A recorded zero is authoritative.');
    assert.deepEqual(getSessionUsage({ cost: NaN }, single, true).completeness, { cost: true, tokens: true, breakdown: true });
    assert.equal(getSessionUsage({ tokens: { input: 10 } }, single, false).inputTokens, single.inputTokens, 'Malformed server totals fall back to observed usage without crashing.');

    const toolLoop = aggregateSessionUsage([assistant([step('step-1'), { id: 'tool-1', type: 'tool', state: { status: 'completed' } }, step('step-2', 0.02)])], pricing);
    assert.equal(toolLoop.completedSteps, 2);
    assert.equal(toolLoop.cost, 0.063);

    const multiProvider = aggregateSessionUsage([assistant([step('step-1')]), assistant([step('step-2', 0.02)], 'openai', 'gpt')], pricing);
    assert.equal(multiProvider.providers.length, 2);
    assert.equal(multiProvider.providers.find((provider: any) => provider.providerId === 'openai').models[0].modelId, 'gpt');
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

    // Context fill is the last step's prompt plus reply, not the sum across steps or turns.
    const multiStep = [
      assistant([step('s1', 0, { input: 1000, output: 50, reasoning: 0, cache: { read: 0, write: 0 } })]),
      { info: { id: 'message-2', sessionID: 'session-1', role: 'user' }, parts: [] },
      assistant([
        step('s2', 0, { input: 200, output: 10, reasoning: 0, cache: { read: 1500, write: 100 } }),
        step('s3', 0, { input: 300, output: 10, reasoning: 0, cache: { read: 1800, write: 0 } }),
      ]),
    ];
    assert.equal(getLatestContextTokens(multiStep), 2110);
    assert.equal(getLatestContextTokens([]), undefined);
    assert.equal(getLatestContextTokens([{ info: { id: 'u', sessionID: 'session-1', role: 'user' }, parts: [] }]), undefined);

    // Zero usage cannot displace the latest completed context read.
    const streaming = [
      assistant([step('s1', 0, { input: 1000, output: 50, reasoning: 0, cache: { read: 800, write: 100 } })]),
      { info: { id: 'message-2', sessionID: 'session-1', role: 'user' }, parts: [] },
      assistant([{ id: 'message-3-step-finish', sessionID: 'session-1', messageID: 'message-3', type: 'step-finish', reason: 'stop', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }]),
    ];
    assert.equal(getLatestContextTokens(streaming), 1950);
    assert.equal(getLatestContextTokens([assistant([step('zero-step', 0, { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })])]), undefined);
    assert.equal(getLatestContextTokens([assistant([{ id: 'in-flight', type: 'step-finish', tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }])]), undefined);

    const ledger = new Map();
    assert.equal(addUsageSteps(ledger, [assistant([step('updating', 0)])]), true);
    assert.equal(addUsageSteps(ledger, [assistant([step('updating', 0)])]), false);
    assert.equal(addUsageSteps(ledger, [assistant([step('updating', 0.1, { input: 1000, output: 300, reasoning: 0, cache: { read: 0, write: 0 } })])]), true);
    assert.equal(ledger.size, 1);
    assert.equal(aggregateUsageSteps(ledger.values()).cost, 0.1);
    assert.equal(aggregateUsageSteps(ledger.values()).outputTokens, 300);
  });
});
