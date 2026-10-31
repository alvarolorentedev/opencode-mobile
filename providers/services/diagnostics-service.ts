import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { createServerAdapter, type Diagnostics } from '@/lib/opencode/contracts/server-adapter';

export type { Diagnostics } from '@/lib/opencode/contracts/server-adapter';

export function loadHealth(client: ScopedOpencodeClient): Promise<Diagnostics['health']> {
  return createServerAdapter(client).diagnostics.health();
}
