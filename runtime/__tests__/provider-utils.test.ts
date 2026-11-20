import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { getConfiguredProviderIds, getEffectiveSessionModel, getInitialMode, getSelectedModelVariant, reconcileEnabledModelIds, recordRecentModelId, resolveConfigModelId } from '@/features/ai/model/opencode-model-selection';
import { areSessionListsEqual, areSessionStatusMapsEqual, collectDescendantSessionIds, mergeSessionStatuses, RETRY_STATUS_STALE_MS } from '@/features/sessions/model/session-utils';
import { buildOpencodeProjects, resolveActiveProject } from '@/features/projects/model/project-utils';
import type { ModelOption } from '@/shared/contracts/model-options';
import type { SessionStatus } from '@/shared/protocol/opencode/types';

const model = (id: string, providerID: string, modelID: string, overrides: Partial<ModelOption> = {}): ModelOption => ({
  id, label: id, providerID, providerLabel: providerID, modelID, variants: [],
  supportsReasoning: false, supportsAttachments: false, inputModalities: ['text'], supportsToolCalls: false, ...overrides,
});

// Migrated from the standalone tests/provider-utils.test.mjs Node script.
describe('provider model selection utilities', () => {
  it('resolves server models and session variants and merges session status maps safely', async () => {
    const models = [model('openai/gpt', 'openai', 'gpt')];

    assert.deepEqual([...getConfiguredProviderIds({ enabled_providers: ['openai'] }, [], models)], ['openai']);
    assert.deepEqual([...getConfiguredProviderIds({ disabled_providers: ['openai'], enabled_providers: ['openai'], provider: { openai: {} } }, ['openai'], models)], []);

    assert.deepEqual(recordRecentModelId([], 'a/b'), ['a/b']);
    assert.deepEqual(recordRecentModelId(['a/b', 'c/d'], 'c/d'), ['c/d', 'a/b']);
    assert.deepEqual(recordRecentModelId(['a', 'b', 'c', 'd'], 'e'), ['e', 'a', 'b', 'c']);
    assert.deepEqual(recordRecentModelId(['a/b']), ['a/b']);

    assert.equal(resolveConfigModelId(models, 'openai/gpt'), 'openai/gpt');
    assert.equal(resolveConfigModelId(models, 'openrouter/blocked'), undefined);

    const variantModel = model('opencode/deepseek', 'opencode', 'deepseek', { variants: [{ id: 'low' }, { id: 'max' }] });
    const sessionModel = { providerID: 'opencode', id: 'deepseek', variant: 'max' };
    assert.equal(getSelectedModelVariant(sessionModel, [variantModel]), 'max');
    assert.equal(getSelectedModelVariant({ ...sessionModel, id: variantModel.id }, [variantModel]), 'max');
    assert.equal(getSelectedModelVariant({ ...sessionModel, variant: 'removed' }, [variantModel]), undefined);
    assert.equal(getSelectedModelVariant({ ...sessionModel, providerID: 'openai' }, [variantModel]), undefined);

    const agents = [{ id: 'build', label: 'Build', mode: 'primary' as const, model: { providerID: 'openai', modelID: 'gpt', variant: 'low' } }];
    assert.deepEqual(getEffectiveSessionModel(models, { model: 'opencode/deepseek' }, agents, { agent: 'build' }), {
      providerID: 'openai', id: 'gpt', variant: 'low',
    });
    assert.deepEqual(getEffectiveSessionModel(models, { model: 'openai/gpt' }, agents, { agent: 'build', model: sessionModel }), sessionModel);
    assert.deepEqual(getEffectiveSessionModel([variantModel], undefined, [], { model: { ...sessionModel, id: variantModel.id } }), sessionModel);
    assert.deepEqual(getEffectiveSessionModel(models, { model: 'openai/gpt' }, [], undefined), { providerID: 'openai', id: 'gpt' });
    assert.deepEqual(getEffectiveSessionModel(models, undefined, [
      ...agents,
      { id: 'plan', label: 'Plan', mode: 'primary' as const, model: { providerID: 'opencode', modelID: 'deepseek', variant: 'max' } },
    ], { agent: 'build' }, 'plan'), { providerID: 'opencode', id: 'deepseek', variant: 'max' });

    // Variant-qualified server values (e.g. `openrouter/~group/model`) still
    // resolve to the catalog entry and mark its provider configured.
    const variantModels = [model('openrouter/deepseek-chat', 'openrouter', 'deepseek-chat')];
    assert.equal(resolveConfigModelId(variantModels, 'openrouter/~group/deepseek-chat'), 'openrouter/deepseek-chat');
    assert.deepEqual([...getConfiguredProviderIds({ enabled_providers: [] }, [], variantModels.map((model) => ({ ...model, id: model.id })))], []);
    assert.deepEqual(
      [...getConfiguredProviderIds({ enabled_providers: [], model: 'openrouter/~group/deepseek-chat' }, [], variantModels)],
      ['openrouter'],
    );

    const now = 1_000_000;

    // The picker mirrors the web client: the server catalog is the list, split
    // into Used (opened on this device + connection) and Other.
    const remoteProjects = [{ id: 'p1', worktree: '/repo', name: 'Repo display', time: { created: 1, updated: 5 } }, { id: 'p2', worktree: '/remote', name: 'Remote display', time: { created: 1, updated: 4 } }];
    assert.deepEqual(buildOpencodeProjects(remoteProjects).map((project) => ({ path: project.path, label: project.label, id: project.id })), [
      { path: '/repo', label: 'Repo display', id: 'p1' },
      { path: '/remote', label: 'Remote display', id: 'p2' },
    ]);
    const listedProjects = buildOpencodeProjects(remoteProjects);
    // A worktree is labeled by its owning project and only while the worktree
    // catalog resolves it.
    const worktreeCatalog = { entries: [{ directory: '/worktrees/task', name: 'task' }], project: { id: 'p1', root: '/repo', label: 'Repo display' }, loading: false };
    assert.equal(resolveActiveProject(listedProjects, '/worktrees/task', worktreeCatalog)?.label, 'Repo display');
    assert.equal(resolveActiveProject(listedProjects, '/elsewhere', worktreeCatalog), undefined);
    const retry: SessionStatus = { type: 'retry', attempt: 2, message: 'provider failed', next: now + 5_000 };
    const staleRetry: SessionStatus = { type: 'retry', attempt: 2, message: 'provider failed', next: now - RETRY_STATUS_STALE_MS - 1 };
    // A list refresh cannot express retry, so an event-derived retry must survive it.
    assert.deepEqual(mergeSessionStatuses({ s: retry }, { s: { type: 'idle' } }, now), { s: retry });
    // A server-confirmed running status wins over the local retry.
    assert.deepEqual(mergeSessionStatuses({ s: retry }, { s: { type: 'busy' } }, now), { s: { type: 'busy' } });
    // A fresh retry replaces a previously idle session.
    assert.deepEqual(mergeSessionStatuses({ s: { type: 'idle' } }, { s: retry }, now), { s: retry });
    // Sessions absent from the fetched list are dropped.
    assert.deepEqual(mergeSessionStatuses({ a: retry, b: { type: 'idle' } }, { b: { type: 'idle' } }, now), { b: { type: 'idle' } });
    // A retry whose scheduled attempt is long past without any new signal clears.
    assert.deepEqual(mergeSessionStatuses({ s: staleRetry }, { s: { type: 'idle' } }, now), { s: { type: 'idle' } });

    // A subagent permission carries a child session id, so the active chat must be
    // able to walk the parentID tree from its root to every descendant blocker.
    const tree = [
      { id: 'root' },
      { id: 'child', parentID: 'root' },
      { id: 'grandchild', parentID: 'child' },
      { id: 'sibling', parentID: 'other-root' },
      { id: 'unrelated' },
    ];
    assert.deepEqual([...collectDescendantSessionIds(tree, ['root'])], ['root', 'child', 'grandchild']);
    assert.deepEqual([...collectDescendantSessionIds(tree, [undefined, 'child'])], ['child', 'grandchild']);
    assert.deepEqual([...collectDescendantSessionIds([{ id: 'a', parentID: 'b' }, { id: 'b', parentID: 'a' }], ['a'])], ['a', 'b']);

    // Equality guards keep the previous identity when a poll refresh is a no-op.
    const sessionAt = (id: string, updated: number) => ({ id, title: id, time: { created: 0, updated } });
    assert.equal(areSessionListsEqual([sessionAt('a', 1)], [sessionAt('a', 1)]), true);
    assert.equal(areSessionListsEqual([{ ...sessionAt('a', 1), cost: 1 }], [{ ...sessionAt('a', 1), cost: 2 }]), false, 'Authoritative usage updates even when updated timestamps are unchanged.');
    assert.equal(areSessionListsEqual([{ ...sessionAt('a', 1), tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }], [{ ...sessionAt('a', 1), tokens: { input: 2, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }]), false);
    assert.equal(areSessionListsEqual([sessionAt('a', 1)], [{ ...sessionAt('a', 1), revert: { messageID: 'm' } }]), false, 'Revert checkpoints must update even within the same server timestamp.');
    assert.equal(areSessionListsEqual([{ ...sessionAt('a', 1), revert: { messageID: 'm' } }], [sessionAt('a', 1)]), false);
    assert.equal(areSessionListsEqual([sessionAt('a', 1)], [sessionAt('a', 2)]), false);
    assert.equal(areSessionListsEqual([sessionAt('a', 1)], [sessionAt('a', 1), sessionAt('b', 1)]), false);
    assert.equal(areSessionStatusMapsEqual({ a: { type: 'idle' } }, { a: { type: 'idle' } }), true);
    assert.equal(areSessionStatusMapsEqual({ a: { type: 'idle' } }, { a: { type: 'busy' } }), false);
    assert.equal(areSessionStatusMapsEqual({ a: { type: 'idle' } }, {}), false);
    assert.equal(areSessionStatusMapsEqual({ a: retry }, { a: { type: 'retry', attempt: 3, message: 'provider failed', next: retry.next } }), false);
  });

  it('keeps catalog choices through empty reads and leaves server model defaults unmodified', () => {
    const models = [model('openai/gpt', 'openai', 'gpt'), model('opencode/deepseek', 'opencode', 'deepseek')];
    const agents = [{ id: 'build', label: 'Build', mode: 'primary' as const }];

    // Reconnect reads can be empty before the server has loaded providers and
    // agents. The stored choices must survive until a complete read arrives.
    assert.equal(getInitialMode([], undefined, 'general'), undefined);
    assert.equal(getInitialMode([], undefined, undefined), undefined);
    assert.equal(getInitialMode(agents, undefined, 'general'), 'build');
    assert.deepEqual(reconcileEnabledModelIds([], ['opencode/deepseek']), { enabledModelIds: ['opencode/deepseek'], knownModelIds: [] });
    assert.deepEqual(reconcileEnabledModelIds([], undefined), { enabledModelIds: [], knownModelIds: [] });

    // Legacy selections treat their first resolvable catalog as known, while
    // a catalog with no matching stored IDs keeps the existing full-catalog fallback.
    assert.deepEqual(reconcileEnabledModelIds(models, []), {
      enabledModelIds: ['openai/gpt', 'opencode/deepseek'], knownModelIds: ['openai/gpt', 'opencode/deepseek'],
    });
    assert.deepEqual(reconcileEnabledModelIds(models, ['opencode/deepseek']), {
      enabledModelIds: ['opencode/deepseek'], knownModelIds: ['openai/gpt', 'opencode/deepseek'],
    });
    assert.deepEqual(reconcileEnabledModelIds([models[0]], ['openai/gpt', 'opencode/deepseek'], models.map(({ id }) => id)), {
      enabledModelIds: ['openai/gpt', 'opencode/deepseek'], knownModelIds: ['openai/gpt', 'opencode/deepseek'],
    });
    assert.deepEqual(reconcileEnabledModelIds([models[0]], ['opencode/deepseek'], models.map(({ id }) => id)), {
      enabledModelIds: ['openai/gpt'], knownModelIds: ['openai/gpt', 'opencode/deepseek'],
    });
    assert.deepEqual(reconcileEnabledModelIds(models, ['opencode/deepseek', 'opencode/deepseek'], models.map(({ id }) => id)), {
      enabledModelIds: ['opencode/deepseek'], knownModelIds: ['openai/gpt', 'opencode/deepseek'],
    });
  });
});
