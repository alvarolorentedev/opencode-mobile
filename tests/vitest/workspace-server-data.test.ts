import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';
import { queryRuntime } from '../helpers/query-runtime.mjs';

describe('retained workspace query demand', () => {
  it('reuses the probe location on activation and isolates simultaneous connections', async () => {
    const driver = hookRuntime();
    const cache = queryRuntime(driver.react).useQueryClient() as QueryClient;
    const projects = vi.fn(async () => []);
    const location = vi.fn(async () => ({ currentProjectPath: '/repo', project: { id: 'p', worktree: '/repo' } }));
    const queries = await loadTs('providers/queries/catalogs.ts', {
      react: driver.react,
      '@/lib/opencode/client': {},
      '@/providers/services/capabilities-service': {},
      '@/providers/services/project-service': {},
      '@/lib/opencode/contracts/server-adapter': {},
      '@/providers/opencode-model-selection': {},
      '@/providers/services/session-service': { listServerProjects: projects, readCatalogLocation: location,
        combineProjectCatalog: (_: unknown, serverProjects: unknown[], value: object) => ({ ...value, serverProjects }) },
    });
    const identity = { connectionId: 'a', connectionScope: 'scope-a', authRevision: 0 };
    const client = { __opencode: { contract: 'v2' } };
    await Promise.all([queries.fetchProjectCatalog(cache, identity, client), queries.fetchProjectCatalog(cache, identity, client)]);
    const scoped = { __opencode: { contract: 'v2', directory: '/repo' } };
    await cache.fetchQuery(queries.locationOptions(identity, scoped));
    expect(location).toHaveBeenCalledOnce(); expect(projects).toHaveBeenCalledOnce();
    expect(cache.getQueryState(queries.locationOptions(identity, scoped).queryKey)?.dataUpdatedAt)
      .toBe(cache.getQueryState(queries.locationOptions(identity, client).queryKey)?.dataUpdatedAt);
    await queries.fetchProjectCatalog(cache, { ...identity, connectionId: 'b' }, client);
    expect(location).toHaveBeenCalledTimes(2); expect(projects).toHaveBeenCalledTimes(2);
    cache.clear();
  });
  it('shares reads, ignores background invalidations, and rejects late disk hydration', async () => {
    const driver = hookRuntime();
    const identity = { connectionId: 'a', connectionScope: 'scope-a', authRevision: 0 };
    const client = { __opencode: { contract: 'v2', directory: '/repo' } };
    const discovery = vi.fn(async () => ({ providers: [], models: [{ id: 'live' }], connected: [], providerAuthMethodsById: {} }));
    const configuration = vi.fn(async () => ({ config: {} }));
    const agents = vi.fn(async () => []);
    const skills = vi.fn(async () => []);
    const references = vi.fn(async () => []);
    const projects = vi.fn(async () => []);
    const location = vi.fn(async () => ({ project: { id: 'p', worktree: '/repo' }, currentProjectPath: '/repo' }));
    const commands = vi.fn(async () => []);
    const statuses = vi.fn(async () => []);
    const vcs = vi.fn(async () => ({}));
    const reads = [discovery, configuration, agents, skills, references, projects, location, commands, statuses, vcs];
    let active = true;
    let restore!: (value: any, timestamp: number) => void;
    const cache = queryRuntime(driver.react).useQueryClient() as QueryClient;
    const { useWorkspaceServerData } = await loadTs('providers/use-workspace-server-data.ts', {
      react: driver.react,
      '@/providers/queries/client': { useQueryIdentity: () => identity, useQueryActivity: () => active },
      '@/providers/opencode-model-selection': { toAgentOption: (value: unknown) => value, getConfiguredProviderIds: () => new Set() },
      '@/providers/services/capabilities-service': { discoverProviderCapabilities: discovery },
      '@/providers/services/session-service': { listServerProjects: projects, readCatalogLocation: location, listCommands: commands,
        combineProjectCatalog: (_: unknown, serverProjects: unknown[], value: object) => ({ ...value, serverProjects }) },
      '@/providers/services/project-service': { getFileStatus: statuses, getVcsInfo: vcs },
      '@/lib/opencode/contracts/server-adapter': { createServerAdapter: () => ({ capabilities: { configuration, agents, skillDetails: skills, references } }) },
      '@/providers/capabilities-snapshot': {
        hydrateCapabilitiesSnapshot: async (_scope: string, _path: string, apply: typeof restore) => { restore = apply; },
        persistCapabilitiesSnapshot: async () => {},
      },
    });
    const current = () => true;
    driver.mount(() => useWorkspaceServerData(client, true, current), {});
    await driver.settle();
    expect(reads.map((read) => read.mock.calls.length)).toEqual(reads.map(() => 1));
    restore({ providers: [], models: [{ id: 'disk' }], connected: [], agents: [], providerAuthMethodsById: {} }, 123);
    await driver.settle();
    expect(driver.value.availableModels).toEqual([{ id: 'live' }]);
    active = false; driver.flush();
    expect(driver.value.availableModels).toEqual([]);
    await cache.invalidateQueries({ queryKey: ['opencode', 'a'] });
    await driver.settle();
    expect(reads.map((read) => read.mock.calls.length)).toEqual(reads.map(() => 1));
    expect(cache.getQueryCache().getAll().every((query) => query.getObserversCount() === 0)).toBe(true);
    active = true; driver.flush(); await driver.settle();
    expect(reads.map((read) => read.mock.calls.length)).toEqual(reads.map(() => 2));
    driver.unmount(); cache.clear();
  });
});
