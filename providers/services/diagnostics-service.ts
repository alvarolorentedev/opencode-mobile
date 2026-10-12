import type { FormatterStatus, LspStatus, McpStatus } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';

import { loadDiagnostics as loadLegacyDiagnostics } from '@/lib/opencode/compat/v1/diagnostics';
import { getMcpStatus } from './mcp-service';

type OptionalDiagnostic<T> =
  | { available: true; data: T }
  | { available: false; error: string };

export type Diagnostics = Awaited<ReturnType<typeof loadDiagnostics>>;

function diagnosticError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function optionalDiagnostic<T>(load: () => Promise<T>): Promise<OptionalDiagnostic<T>> {
  try {
    return { available: true, data: await load() };
  } catch (error) {
    return { available: false, error: diagnosticError(error) };
  }
}

export async function loadDiagnostics(client: ScopedOpencodeClient) {
  if (client.compatibility) return loadLegacyDiagnostics(client.compatibility);
  const [health, mcp, lsp, formatter] = await Promise.all([
    optionalDiagnostic(async () => ({ healthy: true, version: (await client.api!.server.info()).version })),
    optionalDiagnostic<Record<string, McpStatus>>(async () =>
      getMcpStatus(client)),
    optionalDiagnostic<LspStatus[]>(async () =>
      Promise.reject(new Error('Language servers are unavailable on OpenCode 2.'))),
    optionalDiagnostic<FormatterStatus[]>(async () =>
      Promise.reject(new Error('Formatters are unavailable on OpenCode 2.'))),
  ]);

  return { health, mcp, lsp, formatter };
}
