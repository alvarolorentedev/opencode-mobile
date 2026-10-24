import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, it } from 'vitest';

// Migrated from the standalone tests/provider-utils.test.mjs Node script.
describe('provider model selection utilities', () => {
  it('selects initial models/providers and merges session status maps safely', async () => {
    // Stub the preferences alias so the data-URL import does not need the whole
    // preferences module (getInitialMode falls back to the default mode).
    const preferencesStubUri = `data:text/javascript,${encodeURIComponent('export const defaultChatPreferences = { mode: "build" };')}`;
    const source = await readFile(new URL('../../providers/opencode-model-selection.ts', import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
      .outputText.replace(/from '@\/providers\/opencode-preferences'/g, `from "${preferencesStubUri}"`);
    const { getConfiguredProviderIds, getInitialModelId, getInitialProviderId, getModelIdForProvider, getSelectedModelVariant, recordRecentModelId, resolveConfigModelId } = await import(`data:text/javascript,${encodeURIComponent(output)}`);
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

    const variantModel = { id: 'opencode/deepseek', providerID: 'opencode', modelID: 'deepseek', variants: [{ id: 'low' }, { id: 'max' }] };
    const sessionModel = { providerID: 'opencode', id: 'deepseek', variant: 'max' };
    assert.equal(getSelectedModelVariant(variantModel.id, {}, [variantModel], sessionModel), 'max');
    assert.equal(getSelectedModelVariant(variantModel.id, { [variantModel.id]: 'low' }, [variantModel], sessionModel), 'low');
    assert.equal(getSelectedModelVariant(variantModel.id, { [variantModel.id]: null }, [variantModel], sessionModel), undefined);
    assert.equal(getSelectedModelVariant(variantModel.id, { [variantModel.id]: 'removed' }, [variantModel], sessionModel), undefined);
    assert.equal(getSelectedModelVariant(variantModel.id, {}, [variantModel], { ...sessionModel, providerID: 'openai' }), undefined);

    // Variant-qualified server values (e.g. `openrouter/~group/model`) still
    // resolve to the catalog entry and mark its provider configured.
    const variantModels = [{ id: 'openrouter/deepseek-chat', modelID: 'deepseek-chat', providerID: 'openrouter' }];
    assert.equal(resolveConfigModelId(variantModels, 'openrouter/~group/deepseek-chat'), 'openrouter/deepseek-chat');
    assert.deepEqual([...getConfiguredProviderIds({ enabled_providers: [] }, [], variantModels.map((model) => ({ ...model, id: model.id })))], []);
    assert.deepEqual(
      [...getConfiguredProviderIds({ enabled_providers: [], model: 'openrouter/~group/deepseek-chat' }, [], variantModels)],
      ['openrouter'],
    );

    const providerUtilsSource = await readFile(new URL('../../providers/opencode-provider-utils.ts', import.meta.url), 'utf8');
    const providerUtilsOutput = ts.transpileModule(providerUtilsSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
    const { mergeSessionStatuses, RETRY_STATUS_STALE_MS, collectDescendantSessionIds, areSessionListsEqual, areSessionStatusMapsEqual, buildOpencodeProjects, resolveActiveProject } = await import(`data:text/javascript,${encodeURIComponent(providerUtilsOutput)}`);
    const now = 1_000_000;

    // The picker renders only the projects opened on this connection and
    // enriches them with the server's project metadata.
    const remoteProjects = [{ id: 'p1', worktree: '/repo', name: 'Repo display', time: { created: 1, updated: 5 } }];
    const listedProjects = buildOpencodeProjects(['/repo', '/unlisted'], remoteProjects);
    assert.deepEqual(listedProjects.map((project) => ({ path: project.path, label: project.label, id: project.id })), [
      { path: '/repo', label: 'Repo display', id: 'p1' },
      { path: '/unlisted', label: 'unlisted', id: undefined },
    ]);
    assert.deepEqual(buildOpencodeProjects([], remoteProjects), []);
    // A worktree is labeled by its owning project and only while the worktree
    // catalog resolves it.
    const worktreeCatalog = { entries: [{ directory: '/worktrees/task', name: 'task' }], project: { id: 'p1', root: '/repo', label: 'Repo display' }, loading: false };
    assert.equal(resolveActiveProject(listedProjects, '/worktrees/task', worktreeCatalog)?.label, 'Repo display');
    assert.equal(resolveActiveProject(listedProjects, '/elsewhere', worktreeCatalog), undefined);
    const retry = { type: 'retry', attempt: 2, message: 'provider failed', next: now + 5_000 };
    const staleRetry = { type: 'retry', attempt: 2, message: 'provider failed', next: now - RETRY_STATUS_STALE_MS - 1 };
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
    assert.equal(areSessionListsEqual([{ ...sessionAt('a', 1), tokens: { input: 1 } }], [{ ...sessionAt('a', 1), tokens: { input: 2 } }]), false);
    assert.equal(areSessionListsEqual([sessionAt('a', 1)], [sessionAt('a', 2)]), false);
    assert.equal(areSessionListsEqual([sessionAt('a', 1)], [sessionAt('a', 1), sessionAt('b', 1)]), false);
    assert.equal(areSessionStatusMapsEqual({ a: { type: 'idle' } }, { a: { type: 'idle' } }), true);
    assert.equal(areSessionStatusMapsEqual({ a: { type: 'idle' } }, { a: { type: 'busy' } }), false);
    assert.equal(areSessionStatusMapsEqual({ a: { type: 'idle' } }, {}), false);
    assert.equal(areSessionStatusMapsEqual({ a: retry }, { a: { type: 'retry', attempt: 3, message: 'provider failed', next: retry.next } }), false);
  });
});
