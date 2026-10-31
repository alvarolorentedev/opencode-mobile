import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

import { getErrorMessage } from '@/shared/utilities/error-message';
import { requireData } from '@/shared/protocol/opencode/require-data';

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

export function loadHealth(client: OpencodeClient) {
  return optionalDiagnostic(async () => requireData((await client.global.health()).data, 'health diagnostic'));
}
