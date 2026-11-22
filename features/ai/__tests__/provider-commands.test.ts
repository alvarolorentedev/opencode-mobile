import { QueryClient } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { projectQueryKey } from '@/shared/server-data/keys';

import { createProviderCommands } from '../services/provider-commands';

vi.mock('@/features/ai/services/capabilities-service', () => ({}));

it('writes provider accounts only while the selected credential generation is current', async () => {
  const cache = new QueryClient();
  const activate = vi.fn(async () => {});
  const client = { __opencode: { contract: 'v2', directory: '/repo' }, accounts: { activate } } as unknown as ScopedOpencodeClient;
  const identity = { connectionId: 'server', connectionScope: 'account', authRevision: 2 };
  let current = true;
  let finishCancellation!: () => void;
  const cancel = vi.spyOn(cache, 'cancelQueries').mockImplementationOnce(
    () => new Promise<void>((resolve) => { finishCancellation = resolve; }),
  );
  const { providerAccounts } = createProviderCommands(cache, { identity, client, isCurrentClient: () => current, queryActive: false });

  const stale = providerAccounts.activate('id');
  current = false;
  finishCancellation();
  await expect(stale).rejects.toThrow('The connection changed');
  expect(activate).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledWith({ queryKey: ['opencode', 'server', 'account', 2, 'v2'] });

  const selected = projectQueryKey(identity, client, 'capabilities');
  const previous = projectQueryKey({ ...identity, authRevision: 1 }, client, 'capabilities');
  cache.setQueryData(selected, []);
  cache.setQueryData(previous, []);
  current = true;
  await providerAccounts.activate('id');
  expect(activate).toHaveBeenCalledWith('id');
  expect(cache.getQueryState(selected)?.isInvalidated).toBe(true);
  expect(cache.getQueryState(previous)?.isInvalidated).toBe(false);
  cache.clear();
});
