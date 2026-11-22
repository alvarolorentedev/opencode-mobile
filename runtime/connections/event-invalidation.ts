import type { QueryClient } from '@tanstack/react-query';

import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import { isServerConnectedEvent, serverDataResources } from '@/shared/protocol/opencode/server-data-events';
import type { QueryIdentity } from '@/shared/server-data/keys';

export function createEventInvalidation(queryClient: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let initialEnvelope = false;
  const dirty = new Map<string, Set<string>>();

  return {
    receive(event: OpencodeEvent, identity: QueryIdentity) {
      if (isServerConnectedEvent(event) && !initialEnvelope) {
        initialEnvelope = true;
        return;
      }
      const resources = serverDataResources(event);
      if (!resources.length) return;
      const directory = event.location?.directory ?? '';
      const pending = dirty.get(directory) ?? new Set<string>();
      resources.forEach((resource) => pending.add(resource));
      dirty.set(directory, pending);
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const changes = new Map(dirty);
        dirty.clear();
        void queryClient.invalidateQueries({ predicate: ({ queryKey: key }) => {
          if (key[0] !== 'opencode' || key[1] !== identity.connectionId || key[2] !== identity.connectionScope || key[3] !== identity.authRevision) return false;
          const resource = String(key[key[5] === 'server' ? 6 : 7]);
          return key[5] === 'server' ? [...changes.values()].some((items) => items.has(resource))
            : changes.get(String(key[6]))?.has(resource) === true || changes.get('')?.has(resource) === true;
        } });
      }, 250);
    },
    reset() {
      clearTimeout(timer);
      timer = undefined;
      initialEnvelope = false;
      dirty.clear();
    },
  };
}
