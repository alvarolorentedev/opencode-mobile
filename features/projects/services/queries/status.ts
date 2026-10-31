import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import { getFileStatus, getVcsInfo } from '@/features/projects/services/project-service';

import { queryOptions } from '@tanstack/react-query';

import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export function fileStatusOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'file-status'), staleTime: 0,
    queryFn: ({ signal }) => getFileStatus(withReadSignal(client, signal)) });
}

export function vcsInfoOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'vcs'), staleTime: 0,
    queryFn: ({ signal }) => getVcsInfo(withReadSignal(client, signal)) });
}
