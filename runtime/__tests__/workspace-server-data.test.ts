// @vitest-environment happy-dom

import { cloudLinkPlatform as device } from '../../tests/helpers/cloud-link-platform';
import { focusManager, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fetchProjectCatalog, locationOptions } from '@/features/projects/services/queries/catalog';
import { useProjectCatalogReads } from '@/features/projects/state/use-project-inventory';
import { sessionCatalogOptions } from '@/features/sessions/services/queries';
import { useSessionCatalog } from '@/features/sessions/state/use-session-catalog';
import { useWorkspaceServerData } from '@/runtime/workspace/use-workspace-server-data';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { capabilitiesCacheKey } from '@/shared/storage/keys';
import { deferred } from '../../tests/helpers/controlled-clock';
import { renderHook } from '../../tests/helpers/render-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';

vi.mock('expo-router', () => ({ usePathname: () => '/' }));

function queryFixture() {
  const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: 30_000, retry: false } } });
  function wrapper({ children }: { children?: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: cache }, children);
  }
  onTestFinished(() => cache.clear());
  return { cache, wrapper };
}

const identity = { connectionId: 'a', connectionScope: 'scope-a', authRevision: 0 };
function catalog() {
  const projects = vi.fn(async () => []);
  const location = vi.fn(async () => ({ directory: '/repo', project: { id: 'p', canonical: '/repo', directory: '/repo' } }));
  return { projects, location, api: { project: { list: projects }, location: { get: location } } };
}
function scoped(directory: string, api: object = {}) {
  return { __opencode: { contract: 'v2', directory }, api } as ScopedOpencodeClient;
}
afterEach(() => { focusManager.setFocused(undefined); vi.restoreAllMocks(); device.preferences.clear(); });

describe('retained workspace query demand', () => {
  it('keeps the connection catalog refetch available when project views subscribe', async () => {
    const { cache, wrapper } = queryFixture();
    const client = scoped('');
    const catalogKey = sessionCatalogOptions(identity, client).queryKey;
    const readCatalog = vi.fn(async () => ({ sessions: [], statuses: {} }));
    const owner = new QueryObserver(cache, { queryKey: catalogKey, queryFn: readCatalog });
    const stop = owner.subscribe(() => {});
    onTestFinished(stop);
    await owner.refetch();
    readCatalog.mockClear();
    const driver = renderHook(() => useSessionCatalog(identity, client), undefined, wrapper);
    await act(async () => { await cache.refetchQueries({ queryKey: catalogKey, type: 'active' }); });
    expect(readCatalog).toHaveBeenCalledOnce();
    driver.unmount();
  });

  it('reuses the probe location on activation and isolates simultaneous connections', async () => {
    const { cache } = queryFixture();
    const { projects, location, api } = catalog();
    const client = scoped('', api);
    await Promise.all([fetchProjectCatalog(cache, identity, client), fetchProjectCatalog(cache, identity, client)]);
    const project = scoped('/repo', api);
    await cache.fetchQuery(locationOptions(identity, project));
    expect(location).toHaveBeenCalledOnce(); expect(projects).toHaveBeenCalledOnce();
    expect(cache.getQueryState(locationOptions(identity, project).queryKey)?.dataUpdatedAt)
      .toBe(cache.getQueryState(locationOptions(identity, client).queryKey)?.dataUpdatedAt);
    await fetchProjectCatalog(cache, { ...identity, connectionId: 'b' }, client);
    expect(location).toHaveBeenCalledTimes(2); expect(projects).toHaveBeenCalledTimes(2);
  });

  it('shares reads, ignores background invalidations, and rejects late disk hydration', async () => {
    const { cache, wrapper } = queryFixture();
    focusManager.setFocused(true);
    const { projects, location, api } = catalog();
    const discovery = vi.fn(async () => ({ data: [{ id: 'fixture', name: 'Fixture' }] }));
    const configuration = vi.fn(async () => []);
    const emptyData = () => vi.fn(async () => ({ data: [] }));
    const agents = emptyData(), skills = emptyData(), references = emptyData(), commands = emptyData(), statuses = emptyData();
    const vcs = vi.fn(async () => ({ data: {} }));
    const client = scoped('/repo', {
      ...api, provider: { list: discovery }, integration: { list: emptyData() },
      model: { list: async () => ({ data: [{ providerID: 'fixture', id: 'live', name: 'Live', enabled: true, capabilities: { input: ['text'], tools: true }, limit: { context: 16000, output: 4000 } }] }),
        default: async () => ({ data: null }) },
      config: { get: configuration }, agent: { list: agents }, skill: { list: skills },
      reference: { list: references }, command: { list: commands }, vcs: { status: statuses, get: vcs },
    });
    const reads = [discovery, configuration, agents, skills, references, projects, location, commands, statuses, vcs];
    const disk = deferred<string | null>();
    const getItem = AsyncStorage.getItem;
    vi.spyOn(AsyncStorage, 'getItem').mockImplementation((key) =>
      key === capabilitiesCacheKey(identity.connectionScope, '/repo') ? disk.promise : getItem(key));
    const current = () => true;
    const driver = renderHook<boolean, ReturnType<typeof useWorkspaceServerData>>((active) => {
      useProjectCatalogReads({ identity, client, connected: true, queryActive: active } as Parameters<typeof useProjectCatalogReads>[0]);
      return useWorkspaceServerData(identity, client, true, current, active);
    }, true, wrapper);
    await act(async () => {
      await vi.waitFor(() => expect(cache.isFetching()).toBe(0));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(driver.result.current.availableModels.map((model) => model.id)).toEqual(['fixture/live']);
    expect(reads.map((read) => read.mock.calls.length)).toEqual(reads.map(() => 1));
    await act(async () => { disk.resolve(JSON.stringify({ providers: [], models: [{ id: 'disk' }], connected: [],
      agents: [], providerAuthMethodsById: {}, cachedAt: Date.now() - 123 })); });
    expect(driver.result.current.availableModels.map((model) => model.id)).toEqual(['fixture/live']);
    driver.rerender(false);
    expect(driver.result.current.availableModels).toEqual([]);
    await act(async () => { await cache.invalidateQueries({ queryKey: ['opencode', 'a'] }); });
    expect(reads.map((read) => read.mock.calls.length)).toEqual(reads.map(() => 1));
    const backgroundObserved = cache.getQueryCache().getAll().filter((query) => query.getObserversCount() > 0);
    expect(backgroundObserved).toHaveLength(2);
    expect(backgroundObserved.every((query) => query.queryKey.includes('projects') || query.queryKey.at(-1) === 'location')).toBe(true);
    driver.rerender(true);
    await act(async () => {
      await vi.waitFor(() => expect(cache.isFetching()).toBe(0));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(reads.map((read) => read.mock.calls.length)).toEqual(reads.map(() => 2));
    driver.unmount();
  });
});
