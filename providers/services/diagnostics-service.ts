import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { createServerAdapter, type Diagnostics } from '@/lib/opencode/contracts/server-adapter';

export type { Diagnostics } from '@/lib/opencode/contracts/server-adapter';

export function loadDiagnostics(client: ScopedOpencodeClient): Promise<Diagnostics> {
  return createServerAdapter(client).diagnostics.load();
}
