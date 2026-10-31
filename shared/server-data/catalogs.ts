import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { RawSkillInfo } from '@/shared/protocol/opencode/extensions/types';
import { createServerAdapter } from '@/shared/protocol/opencode/contracts/server-adapter';

import { listCommands } from '@/shared/protocol/services/session-service';
import { queryOptions } from '@tanstack/react-query';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';
export function commandsOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'commands'),
    queryFn: ({ signal }) => listCommands(withReadSignal(client, signal)) });
}

export function configurationOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'configuration'),
    queryFn: ({ signal }) => createServerAdapter(withReadSignal(client, signal)).capabilities.configuration() });
}
export function skillsOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'skills'),
    queryFn: async ({ signal }) => {
      const details = await createServerAdapter(withReadSignal(client, signal)).capabilities.skillDetails();
      return { items: details.map(({ id, name, description }) => ({ id, name, description })), details: details as RawSkillInfo[] | undefined };
    } });
}
export function referencesOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'references'),
    queryFn: ({ signal }) => createServerAdapter(withReadSignal(client, signal)).capabilities.references() });
}
