import type { McpStatus } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';

import { getErrorMessage } from '@/lib/error-message';
import { loadDiagnostics as loadLegacyDiagnostics } from '@/lib/opencode/compat/v1/diagnostics';
import { getMcpStatus } from './mcp-service';

type OptionalDiagnostic<T> =
  | { available: true; data: T }
  | { available: false; error: string };

export type Diagnostics = Awaited<ReturnType<typeof loadDiagnostics>>;

async function optionalDiagnostic<T>(load: () => Promise<T>): Promise<OptionalDiagnostic<T>> {
  try {
    return { available: true, data: await load() };
  } catch (error) {
    return { available: false, error: getErrorMessage(error) };
  }
}

export async function loadDiagnostics(client: ScopedOpencodeClient) {
  if (client.compatibility) return loadLegacyDiagnostics(client.compatibility);
  const [health, mcp] = await Promise.all([
    optionalDiagnostic(async () => ({ healthy: true, version: (await client.api!.server.info()).version })),
    optionalDiagnostic<Record<string, McpStatus>>(async () =>
      getMcpStatus(client)),
  ]);

  return { health, mcp };
}
