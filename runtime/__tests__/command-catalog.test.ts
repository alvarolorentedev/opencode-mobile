import { describe, expect, it } from 'vitest';
import * as query from '@tanstack/react-query';
import { loadTs } from '../../tests/helpers/runtime.mjs';

const identity = { connectionId: 'a', connectionScope: 'server-a', authRevision: 0 };
const client = (directory = '/repo') => ({ __opencode: { contract: 'v2', directory } });

async function catalog(read: (client: unknown) => Promise<unknown>) {
  return loadTs('shared/server-data/catalogs.ts', {
    '@tanstack/react-query': query,
    '@/shared/protocol/opencode/client': { withReadSignal: (client: unknown) => client },
    '@/shared/protocol/opencode/contracts/server-adapter': {},
    '@/shared/protocol/services/session-service': { listCommands: read },
  });
}

describe('command catalog lifecycle', () => {
  it('revalidates a fresh retained catalog on project/foreground activation without polling', async () => {
    let reads = 0;
    const { commandsOptions } = await catalog(async () => [{ name: `command-${++reads}` }]);
    const cache = new query.QueryClient({ defaultOptions: { queries: { staleTime: 60_000, gcTime: Infinity, retry: false, refetchInterval: false } } });
    const options = commandsOptions(identity, client());
    await cache.fetchQuery(options);
    const observer = new query.QueryObserver(cache, options);
    const unsubscribe = observer.subscribe(() => {});
    await cache.refetchQueries({ queryKey: options.queryKey }, { cancelRefetch: false });
    expect(reads).toBe(2);
    expect(observer.getCurrentResult().data).toEqual([{ name: 'command-2' }]);
    unsubscribe();
    await cache.invalidateQueries({ queryKey: options.queryKey });
    expect(reads).toBe(2);
    const resumed = new query.QueryObserver(cache, options);
    const stop = resumed.subscribe(() => {});
    await cache.refetchQueries({ queryKey: options.queryKey }, { cancelRefetch: false });
    expect(reads).toBe(3);
    expect(resumed.getCurrentResult().data).toEqual([{ name: 'command-3' }]);
    expect(cache.getDefaultOptions().queries?.refetchInterval).toBe(false);
    stop(); cache.clear();
  });

  it('isolates a late response from a newer server, project and credential partition', async () => {
    let finish!: (commands: object[]) => void;
    const oldClient = client();
    const { commandsOptions } = await catalog(async (candidate) => candidate === oldClient
      ? new Promise((resolve) => { finish = resolve; }) : [{ name: 'new' }, { name: 'New' }]);
    const cache = new query.QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const old = commandsOptions(identity, oldClient);
    const pending = cache.fetchQuery(old);
    const replacements = [
      commandsOptions({ ...identity, connectionId: 'b', connectionScope: 'server-b' }, client()),
      commandsOptions(identity, client('/other')),
      commandsOptions({ ...identity, authRevision: 1 }, client()),
    ];
    await Promise.all(replacements.map((options) => cache.fetchQuery(options)));
    finish([{ name: 'old' }]); await pending;
    for (const options of replacements) expect(cache.getQueryData(options.queryKey)).toEqual([{ name: 'new' }, { name: 'New' }]);
    cache.clear();
  });
});
