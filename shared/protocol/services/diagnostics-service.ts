import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { createServerAdapter, type Diagnostics } from '@/shared/protocol/opencode/contracts/server-adapter';

export type { Diagnostics } from '@/shared/protocol/opencode/contracts/server-adapter';

export function loadHealth(client: ScopedOpencodeClient): Promise<Diagnostics['health']> {
  return createServerAdapter(client).diagnostics.health();
}
