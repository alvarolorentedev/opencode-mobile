import type { OpencodeClient } from '@opencode-ai/sdk/client';

export async function findFiles(client: OpencodeClient, query: string, includeDirectories = false) {
  return (await client.find.files({ query: { query, dirs: includeDirectories ? 'true' : 'false' } })).data;
}

export async function readFile(client: OpencodeClient, path: string) {
  return (await client.file.read({ query: { path } })).data;
}

export async function getFileStatus(client: OpencodeClient) {
  return (await client.file.status()).data;
}

export async function getVcsInfo(client: OpencodeClient) {
  return (await client.vcs.get()).data;
}
