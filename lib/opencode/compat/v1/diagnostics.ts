import type { FormatterStatus, LspStatus, McpStatus } from '@/lib/opencode/types';
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

import { getErrorMessage } from '@/lib/error-message';
import { requireData } from '@/providers/services/require-data';

type OptionalDiagnostic<T> =
  | { available: true; data: T }
  | { available: false; error: string };

async function optionalDiagnostic<T>(load: () => Promise<T>): Promise<OptionalDiagnostic<T>> {
  try {
    return { available: true, data: await load() };
  } catch (error) {
    return { available: false, error: getErrorMessage(error) };
  }
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
