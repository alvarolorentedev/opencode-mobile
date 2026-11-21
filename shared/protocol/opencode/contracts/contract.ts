import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

// Contract selection belongs to the protocol boundary. Feature state can ask
// whether native V2 reads are available without branching on client properties.
export function isV2Client(client: ScopedOpencodeClient) {
  return !client.compatibility;
}
