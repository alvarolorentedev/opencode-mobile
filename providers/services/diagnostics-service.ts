import type { FormatterStatus, LspStatus, McpStatus } from '@opencode-ai/sdk/client';

import { requestOpenCodeApi, type ScopedOpencodeClient } from '@/lib/opencode/client';

export type HealthInfo = {
  healthy: true;
  version: string;
};

export type OptionalDiagnostic<T> =
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

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

export async function loadDiagnostics(client: ScopedOpencodeClient) {
  const [health, mcp, lsp, formatter] = await Promise.all([
    optionalDiagnostic(() => requestOpenCodeApi<HealthInfo>(client, '/global/health')),
    optionalDiagnostic<Record<string, McpStatus>>(async () =>
      requireData((await client.mcp.status()).data, 'MCP diagnostic')),
    optionalDiagnostic<LspStatus[]>(async () =>
      requireData((await client.lsp.status()).data, 'LSP diagnostic')),
    optionalDiagnostic<FormatterStatus[]>(async () =>
      requireData((await client.formatter.status()).data, 'formatter diagnostic')),
  ]);

  return { health, mcp, lsp, formatter };
}
