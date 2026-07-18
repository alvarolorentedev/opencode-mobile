import type { FormatterStatus, LspStatus, McpStatus, OpencodeClient } from '@opencode-ai/sdk/v2/client';

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

export async function loadDiagnostics(client: OpencodeClient) {
  const [health, mcp, lsp, formatter] = await Promise.all([
    optionalDiagnostic(async () => requireData((await client.global.health()).data, 'health diagnostic')),
    optionalDiagnostic<Record<string, McpStatus>>(async () =>
      requireData((await client.mcp.status()).data, 'MCP diagnostic')),
    optionalDiagnostic<LspStatus[]>(async () =>
      requireData((await client.lsp.status()).data, 'LSP diagnostic')),
    optionalDiagnostic<FormatterStatus[]>(async () =>
      requireData((await client.formatter.status()).data, 'formatter diagnostic')),
  ]);

  return { health, mcp, lsp, formatter };
}
