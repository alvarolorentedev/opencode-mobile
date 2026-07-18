import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

export async function findFiles(client: OpencodeClient, query: string, includeDirectories = false) {
  return requireData((await client.find.files({ query, dirs: includeDirectories ? 'true' : 'false' })).data, 'file search');
}

export async function readFile(client: OpencodeClient, path: string) {
  return requireData((await client.file.read({ path })).data, 'file read');
}

export async function getFileStatus(client: OpencodeClient) {
  return requireData((await client.file.status()).data, 'file status');
}

export async function getVcsInfo(client: OpencodeClient) {
  return requireData((await client.vcs.get()).data, 'VCS request');
}
