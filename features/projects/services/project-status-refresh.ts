import type { QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { commandsOptions } from '@/shared/server-data/catalogs';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { fileStatusOptions, vcsInfoOptions } from './queries/status';

export async function refreshProjectFeatures(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient, active: boolean) {
  const commands = commandsOptions(identity, client);
  if (!active) {
    await cache.invalidateQueries({ queryKey: commands.queryKey.slice(0, -1), refetchType: 'none' });
    return;
  }
  await Promise.all([
    cache.fetchQuery(commands),
    cache.fetchQuery(fileStatusOptions(identity, client)),
    cache.fetchQuery(vcsInfoOptions(identity, client)),
  ]);
}
